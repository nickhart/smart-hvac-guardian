import { describe, it, expect, vi } from "vitest";
import { handleSystemToggle } from "../../api/system-toggle";
import type { Dependencies } from "@/handlers/dependencies";
import type { Logger } from "@/utils/logger";

const mockLogger: Logger = {
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
};

function createMockDeps(overrides?: Partial<Dependencies>): Dependencies {
  return {
    sensor: { getState: vi.fn() },
    hvac: { turnOff: vi.fn() },
    scheduler: {
      scheduleDelayedCheck: vi.fn(),
      scheduleTurnOff: vi.fn(),
      scheduleUnitTurnOff: vi.fn(),
    },
    stateStore: {
      setSensorState: vi.fn(),
      getAllSensorStates: vi.fn().mockResolvedValue(new Map()),
      setTimerToken: vi.fn(),
      getTimerToken: vi.fn(),
      deleteTimerToken: vi.fn(),
      getActiveTimerUnitIds: vi.fn().mockResolvedValue([]),
      getTurnedOffUnitIds: vi.fn().mockResolvedValue([]),
      markTurnedOff: vi.fn().mockResolvedValue(undefined),
      clearTurnedOff: vi.fn().mockResolvedValue(undefined),
      getSystemEnabled: vi.fn().mockResolvedValue(true),
      setSystemEnabled: vi.fn().mockResolvedValue(undefined),
      getUnitDelay: vi.fn().mockResolvedValue(null),
      setUnitDelay: vi.fn(),
      isCircuitOpen: vi.fn().mockResolvedValue(false),
      openCircuit: vi.fn().mockResolvedValue(undefined),
      recordCircuitFailure: vi.fn().mockResolvedValue(1),
      resetCircuit: vi.fn().mockResolvedValue(undefined),
    },
    analytics: {
      trackSensorEvent: vi.fn().mockResolvedValue(undefined),
      trackHvacCommand: vi.fn().mockResolvedValue(undefined),
      trackHvacStateEvent: vi.fn().mockResolvedValue(undefined),
      trackProviderEvent: vi.fn().mockResolvedValue(undefined),
      trackSensorStateDrift: vi.fn().mockResolvedValue(undefined),
    },
    qstashReceiver: { verify: vi.fn() } as never,
    config: {
      zones: {},
      sensorDelays: {},
      sensorNames: {},
      sensorDefaults: {},
      hvacUnits: {},
      yolink: { baseUrl: "https://api.yosmart.com/open/yolink/v2/api" },
      turnOffUrl: "https://example.com/api/hvac-turn-off",
    },
    logger: mockLogger,
    ...overrides,
  };
}

describe("system-toggle handler", () => {
  it("returns 405 for unsupported method", async () => {
    const req = new Request("https://example.com/api/system-toggle", { method: "PUT" });
    const res = await handleSystemToggle(req, createMockDeps());
    expect(res.status).toBe(405);
  });

  it("GET returns current enabled state", async () => {
    const deps = createMockDeps();
    const req = new Request("https://example.com/api/system-toggle", { method: "GET" });
    const res = await handleSystemToggle(req, deps);
    const body = (await res.json()) as Record<string, unknown>;

    expect(res.status).toBe(200);
    expect(body.enabled).toBe(true);
  });

  it("POST sets enabled state", async () => {
    const deps = createMockDeps();
    const req = new Request("https://example.com/api/system-toggle", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled: false }),
    });
    const res = await handleSystemToggle(req, deps);
    const body = (await res.json()) as Record<string, unknown>;

    expect(res.status).toBe(200);
    expect(body.enabled).toBe(false);
    expect(deps.stateStore.setSystemEnabled).toHaveBeenCalledWith(false);
  });

  it("returns 400 for invalid payload", async () => {
    const req = new Request("https://example.com/api/system-toggle", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ bad: "data" }),
    });
    const res = await handleSystemToggle(req, createMockDeps());
    expect(res.status).toBe(400);
  });

  it("returns 500 on state store failure", async () => {
    const deps = createMockDeps({
      stateStore: {
        setSensorState: vi.fn(),
        getAllSensorStates: vi.fn(),
        setTimerToken: vi.fn(),
        getTimerToken: vi.fn(),
        deleteTimerToken: vi.fn(),
        getActiveTimerUnitIds: vi.fn(),
        getTurnedOffUnitIds: vi.fn().mockResolvedValue([]),
        markTurnedOff: vi.fn().mockResolvedValue(undefined),
        clearTurnedOff: vi.fn().mockResolvedValue(undefined),
        getSystemEnabled: vi.fn().mockRejectedValue(new Error("Redis down")),
        setSystemEnabled: vi.fn(),
        getUnitDelay: vi.fn(),
        setUnitDelay: vi.fn(),
        isCircuitOpen: vi.fn().mockResolvedValue(false),
        openCircuit: vi.fn().mockResolvedValue(undefined),
        recordCircuitFailure: vi.fn().mockResolvedValue(1),
        resetCircuit: vi.fn().mockResolvedValue(undefined),
      },
    });
    const req = new Request("https://example.com/api/system-toggle", { method: "GET" });
    const res = await handleSystemToggle(req, deps);
    expect(res.status).toBe(500);
  });
});

// Without a database this used to fall back to APP_CONFIG and let anyone
// switch the whole system on or off, with no session check.
describe("system-toggle without a database", () => {
  it("refuses instead of running unauthenticated", async () => {
    vi.stubEnv("DATABASE_URL", "");
    try {
      const res = await handleSystemToggle(
        new Request("https://example.com/api/system-toggle", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ enabled: false }),
        }),
      );
      expect(res.status).toBe(503);
    } finally {
      vi.unstubAllEnvs();
    }
  });
});

// While disabled, timers still fire in shadow mode and mark their unit as turned
// off, though nothing was switched off. Re-enabling must not trust those marks,
// or an exposed unit keeps running until a mark expires and another door moves.
describe("system-toggle re-enable with a unit marked as turned off", () => {
  function depsWithMarkedUnit() {
    const base = createMockDeps();
    return createMockDeps({
      // The base config is empty; this test needs two exposed units.
      config: {
        ...base.config,
        zones: {
          living_room: {
            minisplits: ["ac_living", "ac_den"],
            exteriorOpenings: ["front_door"],
            interiorDoors: [],
          },
        },
        sensorDelays: { front_door: 90 },
        hvacUnits: {
          ac_living: { name: "Living Room AC", iftttEvent: "turn_off_ac_living", delaySeconds: 90 },
          ac_den: { name: "Den AC", iftttEvent: "turn_off_ac_den", delaySeconds: 90 },
        },
      },
      stateStore: {
        ...base.stateStore,
        getAllSensorStates: vi.fn().mockResolvedValue(new Map([["front_door", "open"]])),
        getTurnedOffUnitIds: vi.fn(async (ids: string[]) => ids.filter((id) => id === "ac_living")),
      },
    });
  }

  function enable(deps: Dependencies) {
    return handleSystemToggle(
      new Request("https://example.com/api/system-toggle", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: true }),
      }),
      deps,
    );
  }

  it("schedules it anyway", async () => {
    const deps = depsWithMarkedUnit();

    const body = (await (await enable(deps)).json()) as { scheduled: string[] };

    expect([...body.scheduled].sort()).toEqual(["ac_den", "ac_living"]);
    expect(deps.scheduler.scheduleUnitTurnOff).toHaveBeenCalledWith(
      "ac_living",
      expect.any(String),
      90,
    );
  });

  it("clears every unit's mark, so later door events don't skip it either", async () => {
    const deps = depsWithMarkedUnit();

    await enable(deps);

    expect(deps.stateStore.clearTurnedOff).toHaveBeenCalledWith(["ac_living", "ac_den"]);
  });

  it("still schedules if the marks can't be cleared", async () => {
    const deps = depsWithMarkedUnit();
    vi.mocked(deps.stateStore.clearTurnedOff).mockRejectedValue(new Error("Redis down"));

    const body = (await (await enable(deps)).json()) as { scheduled: string[] };

    expect([...body.scheduled].sort()).toEqual(["ac_den", "ac_living"]);
  });
});
