import { describe, it, expect, vi } from "vitest";
import { handleUnitDelay } from "../../api/unit-delay";
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
      setUnitDelay: vi.fn().mockResolvedValue(undefined),
    },
    analytics: {
      trackSensorEvent: vi.fn().mockResolvedValue(undefined),
      trackHvacCommand: vi.fn().mockResolvedValue(undefined),
      trackHvacStateEvent: vi.fn().mockResolvedValue(undefined),
    },
    qstashReceiver: { verify: vi.fn() } as never,
    config: {
      zones: {
        living_room: {
          minisplits: ["ac_living"],
          exteriorOpenings: ["front_door"],
          interiorDoors: [],
        },
      },
      sensorDelays: { front_door: 90 },
      sensorNames: {},
      sensorDefaults: {},
      hvacUnits: {
        ac_living: { name: "Living Room AC", iftttEvent: "turn_off_ac_living", delaySeconds: 90 },
      },
      yolink: { baseUrl: "https://api.yosmart.com/open/yolink/v2/api" },
      turnOffUrl: "https://example.com/api/hvac-turn-off",
    },
    logger: mockLogger,
    ...overrides,
  };
}

describe("unit-delay handler", () => {
  it("returns 405 for unsupported method", async () => {
    const req = new Request("https://example.com/api/unit-delay", { method: "PUT" });
    const res = await handleUnitDelay(req, createMockDeps());
    expect(res.status).toBe(405);
  });

  it("GET returns config delay when no override", async () => {
    const req = new Request("https://example.com/api/unit-delay?unitId=ac_living", {
      method: "GET",
    });
    const deps = createMockDeps();
    const res = await handleUnitDelay(req, deps);
    const body = (await res.json()) as Record<string, unknown>;

    expect(res.status).toBe(200);
    expect(body.unitId).toBe("ac_living");
    expect(body.delaySeconds).toBe(90);
    expect(body.source).toBe("config");
  });

  it("GET returns override delay when set", async () => {
    const deps = createMockDeps({
      stateStore: {
        ...createMockDeps().stateStore,
        getUnitDelay: vi.fn().mockResolvedValue(120),
      },
    });
    const req = new Request("https://example.com/api/unit-delay?unitId=ac_living", {
      method: "GET",
    });
    const res = await handleUnitDelay(req, deps);
    const body = (await res.json()) as Record<string, unknown>;

    expect(res.status).toBe(200);
    expect(body.delaySeconds).toBe(120);
    expect(body.source).toBe("override");
  });

  it("GET returns 400 for missing unitId", async () => {
    const req = new Request("https://example.com/api/unit-delay", { method: "GET" });
    const res = await handleUnitDelay(req, createMockDeps());
    expect(res.status).toBe(400);
  });

  it("GET returns 400 for unknown unitId", async () => {
    const req = new Request("https://example.com/api/unit-delay?unitId=unknown", {
      method: "GET",
    });
    const res = await handleUnitDelay(req, createMockDeps());
    expect(res.status).toBe(400);
  });

  it("POST stores delay override", async () => {
    const deps = createMockDeps();
    const req = new Request("https://example.com/api/unit-delay", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ unitId: "ac_living", delaySeconds: 180 }),
    });
    const res = await handleUnitDelay(req, deps);
    const body = (await res.json()) as Record<string, unknown>;

    expect(res.status).toBe(200);
    expect(body.status).toBe("ok");
    expect(body.unitId).toBe("ac_living");
    expect(body.delaySeconds).toBe(180);
    expect(deps.stateStore.setUnitDelay).toHaveBeenCalledWith("ac_living", 180);
  });

  it("POST returns 404 for unknown unitId", async () => {
    const req = new Request("https://example.com/api/unit-delay", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ unitId: "unknown", delaySeconds: 180 }),
    });
    const res = await handleUnitDelay(req, createMockDeps());
    expect(res.status).toBe(404);
  });

  it("POST returns 400 for invalid payload", async () => {
    const req = new Request("https://example.com/api/unit-delay", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ unitId: "ac_living", delaySeconds: -5 }),
    });
    const res = await handleUnitDelay(req, createMockDeps());
    expect(res.status).toBe(400);
  });
});
