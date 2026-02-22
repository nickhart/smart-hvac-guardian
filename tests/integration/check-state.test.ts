import { describe, it, expect, vi } from "vitest";
import { handleCheckState } from "../../api/check-state";
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
      getAllSensorStates: vi.fn().mockResolvedValue(
        new Map([
          ["front_door", "open"],
          ["bedroom_window", "closed"],
        ]),
      ),
      setTimerToken: vi.fn(),
      getTimerToken: vi.fn(),
      deleteTimerToken: vi.fn(),
      getActiveTimerUnitIds: vi.fn().mockResolvedValue(["ac_living"]),
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
        bedroom: {
          minisplits: ["ac_bedroom"],
          exteriorOpenings: ["bedroom_window"],
          interiorDoors: [],
        },
      },
      sensorDelays: { front_door: 90, bedroom_window: 120 },
      hvacUnits: {
        ac_living: { name: "Living Room AC", iftttEvent: "turn_off_ac_living" },
        ac_bedroom: { name: "Bedroom AC", iftttEvent: "turn_off_ac_bedroom" },
      },
      sensorDefaults: {},
      yolink: { baseUrl: "https://api.yosmart.com/open/yolink/v2/api" },
      turnOffUrl: "https://example.com/api/hvac-turn-off",
    },
    logger: mockLogger,
    ...overrides,
  };
}

describe("check-state diagnostic handler", () => {
  it("returns 405 for non-GET", async () => {
    const req = new Request("https://example.com/api/check-state", { method: "POST" });
    const res = await handleCheckState(req, createMockDeps());
    expect(res.status).toBe(405);
  });

  it("returns diagnostic state on GET", async () => {
    const req = new Request("https://example.com/api/check-state", { method: "GET" });
    const deps = createMockDeps();
    const res = await handleCheckState(req, deps);
    const body = (await res.json()) as Record<string, unknown>;

    expect(res.status).toBe(200);
    expect(body.status).toBe("ok");
    expect(body.sensorStates).toEqual({ front_door: "open", bedroom_window: "closed" });
    expect(body.exposedUnits).toEqual(["ac_living"]);
    expect(body.unexposedUnits).toEqual(["ac_bedroom"]);
    expect(body.activeTimers).toEqual(["ac_living"]);
  });

  it("returns 500 on state store failure", async () => {
    const deps = createMockDeps({
      stateStore: {
        setSensorState: vi.fn(),
        getAllSensorStates: vi.fn().mockRejectedValue(new Error("Redis down")),
        setTimerToken: vi.fn(),
        getTimerToken: vi.fn(),
        deleteTimerToken: vi.fn(),
        getActiveTimerUnitIds: vi.fn(),
      },
    });
    const req = new Request("https://example.com/api/check-state", { method: "GET" });
    const res = await handleCheckState(req, deps);
    expect(res.status).toBe(500);
  });
});
