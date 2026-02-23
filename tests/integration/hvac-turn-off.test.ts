import { describe, it, expect, vi } from "vitest";
import { handleHvacTurnOff } from "../../api/hvac-turn-off";
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
    hvac: { turnOff: vi.fn().mockResolvedValue(undefined) },
    scheduler: {
      scheduleDelayedCheck: vi.fn(),
      scheduleTurnOff: vi.fn(),
      scheduleUnitTurnOff: vi.fn(),
    },
    stateStore: {
      setSensorState: vi.fn(),
      getAllSensorStates: vi.fn(),
      setTimerToken: vi.fn(),
      getTimerToken: vi.fn().mockResolvedValue("valid-token"),
      deleteTimerToken: vi.fn().mockResolvedValue(undefined),
      getActiveTimerUnitIds: vi.fn(),
      getSystemEnabled: vi.fn().mockResolvedValue(true),
      setSystemEnabled: vi.fn(),
      getUnitDelay: vi.fn().mockResolvedValue(null),
      setUnitDelay: vi.fn(),
    },
    analytics: {
      trackSensorEvent: vi.fn().mockResolvedValue(undefined),
      trackHvacCommand: vi.fn().mockResolvedValue(undefined),
      trackHvacStateEvent: vi.fn().mockResolvedValue(undefined),
    },
    qstashReceiver: { verify: vi.fn().mockResolvedValue(true) } as never,
    config: {
      zones: {
        living_room: {
          minisplits: ["ac_living"],
          exteriorOpenings: ["front_door"],
          interiorDoors: [],
        },
      },
      sensorDelays: { front_door: 90 },
      hvacUnits: {
        ac_living: { name: "Living Room AC", iftttEvent: "turn_off_ac_living", delaySeconds: 90 },
      },
      sensorNames: {},
      sensorDefaults: {},
      yolink: { baseUrl: "https://api.yosmart.com/open/yolink/v2/api" },
      turnOffUrl: "https://example.com/api/hvac-turn-off",
    },
    logger: mockLogger,
    ...overrides,
  };
}

function makeRequest(body: unknown, signature = "valid-sig"): Request {
  return new Request("https://example.com/api/hvac-turn-off", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "upstash-signature": signature,
    },
    body: JSON.stringify(body),
  });
}

describe("hvac-turn-off handler", () => {
  it("returns 405 for non-POST", async () => {
    const req = new Request("https://example.com/api/hvac-turn-off", { method: "GET" });
    const res = await handleHvacTurnOff(req, createMockDeps());
    expect(res.status).toBe(405);
  });

  it("returns 401 for invalid QStash signature", async () => {
    const deps = createMockDeps({
      qstashReceiver: {
        verify: vi.fn().mockRejectedValue(new Error("bad sig")),
      } as never,
    });

    const res = await handleHvacTurnOff(
      makeRequest({ hvacUnitId: "ac_living", cancellationToken: "token123" }),
      deps,
    );
    expect(res.status).toBe(401);
  });

  it("returns 400 for invalid payload", async () => {
    const deps = createMockDeps();
    const res = await handleHvacTurnOff(makeRequest({ bad: "data" }), deps);
    expect(res.status).toBe(400);
  });

  it("turns off unit when cancellation token matches", async () => {
    const deps = createMockDeps({
      stateStore: {
        setSensorState: vi.fn(),
        getAllSensorStates: vi.fn(),
        setTimerToken: vi.fn(),
        getTimerToken: vi.fn().mockResolvedValue("valid-token"),
        deleteTimerToken: vi.fn().mockResolvedValue(undefined),
        getActiveTimerUnitIds: vi.fn(),
        getSystemEnabled: vi.fn().mockResolvedValue(true),
        setSystemEnabled: vi.fn(),
        getUnitDelay: vi.fn().mockResolvedValue(null),
        setUnitDelay: vi.fn(),
      },
    });

    const res = await handleHvacTurnOff(
      makeRequest({ hvacUnitId: "ac_living", cancellationToken: "valid-token" }),
      deps,
    );
    const body = (await res.json()) as Record<string, unknown>;

    expect(res.status).toBe(200);
    expect(body.action).toBe("turned_off");
    expect(body.hvacUnitId).toBe("ac_living");
    expect(deps.hvac.turnOff).toHaveBeenCalledWith("turn_off_ac_living");
    expect(deps.stateStore.deleteTimerToken).toHaveBeenCalledWith("ac_living");
  });

  it("skips turn-off when token is missing (cancelled)", async () => {
    const deps = createMockDeps({
      stateStore: {
        setSensorState: vi.fn(),
        getAllSensorStates: vi.fn(),
        setTimerToken: vi.fn(),
        getTimerToken: vi.fn().mockResolvedValue(null),
        deleteTimerToken: vi.fn(),
        getActiveTimerUnitIds: vi.fn(),
        getSystemEnabled: vi.fn().mockResolvedValue(true),
        setSystemEnabled: vi.fn(),
        getUnitDelay: vi.fn().mockResolvedValue(null),
        setUnitDelay: vi.fn(),
      },
    });

    const res = await handleHvacTurnOff(
      makeRequest({ hvacUnitId: "ac_living", cancellationToken: "stale-token" }),
      deps,
    );
    const body = (await res.json()) as Record<string, unknown>;

    expect(res.status).toBe(200);
    expect(body.action).toBe("cancelled");
    expect(deps.hvac.turnOff).not.toHaveBeenCalled();
  });

  it("skips turn-off when token mismatches", async () => {
    const deps = createMockDeps({
      stateStore: {
        setSensorState: vi.fn(),
        getAllSensorStates: vi.fn(),
        setTimerToken: vi.fn(),
        getTimerToken: vi.fn().mockResolvedValue("new-token"),
        deleteTimerToken: vi.fn(),
        getActiveTimerUnitIds: vi.fn(),
        getSystemEnabled: vi.fn().mockResolvedValue(true),
        setSystemEnabled: vi.fn(),
        getUnitDelay: vi.fn().mockResolvedValue(null),
        setUnitDelay: vi.fn(),
      },
    });

    const res = await handleHvacTurnOff(
      makeRequest({ hvacUnitId: "ac_living", cancellationToken: "old-token" }),
      deps,
    );
    const body = (await res.json()) as Record<string, unknown>;

    expect(res.status).toBe(200);
    expect(body.action).toBe("cancelled");
    expect(deps.hvac.turnOff).not.toHaveBeenCalled();
  });

  it("returns 404 for unknown HVAC unit (with valid token)", async () => {
    const deps = createMockDeps({
      stateStore: {
        setSensorState: vi.fn(),
        getAllSensorStates: vi.fn(),
        setTimerToken: vi.fn(),
        getTimerToken: vi.fn().mockResolvedValue("token123"),
        deleteTimerToken: vi.fn(),
        getActiveTimerUnitIds: vi.fn(),
        getSystemEnabled: vi.fn().mockResolvedValue(true),
        setSystemEnabled: vi.fn(),
        getUnitDelay: vi.fn().mockResolvedValue(null),
        setUnitDelay: vi.fn(),
      },
    });

    const res = await handleHvacTurnOff(
      makeRequest({ hvacUnitId: "nonexistent", cancellationToken: "token123" }),
      deps,
    );
    expect(res.status).toBe(404);
  });
});
