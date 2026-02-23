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
      getSystemEnabled: vi.fn().mockResolvedValue(true),
      setSystemEnabled: vi.fn().mockResolvedValue(undefined),
      getUnitDelay: vi.fn().mockResolvedValue(null),
      setUnitDelay: vi.fn(),
    },
    analytics: {
      trackSensorEvent: vi.fn().mockResolvedValue(undefined),
      trackHvacCommand: vi.fn().mockResolvedValue(undefined),
      trackHvacStateEvent: vi.fn().mockResolvedValue(undefined),
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
        getSystemEnabled: vi.fn().mockRejectedValue(new Error("Redis down")),
        setSystemEnabled: vi.fn(),
        getUnitDelay: vi.fn(),
        setUnitDelay: vi.fn(),
      },
    });
    const req = new Request("https://example.com/api/system-toggle", { method: "GET" });
    const res = await handleSystemToggle(req, deps);
    expect(res.status).toBe(500);
  });
});
