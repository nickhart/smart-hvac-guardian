import { describe, it, expect, vi } from "vitest";
import { handleCheckState } from "../../api/check-state";
import type { Dependencies } from "@/handlers/dependencies";
import type { Logger } from "@/utils/logger";
import type { SensorState } from "@/providers/types";

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
      getSystemEnabled: vi.fn().mockResolvedValue(true),
      setSystemEnabled: vi.fn().mockResolvedValue(undefined),
      getUnitDelay: vi.fn().mockResolvedValue(null),
      setUnitDelay: vi.fn().mockResolvedValue(undefined),
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
        ac_living: { name: "Living Room AC", iftttEvent: "turn_off_ac_living", delaySeconds: 90 },
        ac_bedroom: { name: "Bedroom AC", iftttEvent: "turn_off_ac_bedroom", delaySeconds: 120 },
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
    expect(body.sensorNames).toEqual({});
    expect(body.unitNames).toEqual({
      ac_living: "Living Room AC",
      ac_bedroom: "Bedroom AC",
    });
    expect(body.unitDelays).toEqual({
      ac_living: 90,
      ac_bedroom: 120,
    });
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
        getSystemEnabled: vi.fn(),
        setSystemEnabled: vi.fn(),
        getUnitDelay: vi.fn().mockResolvedValue(null),
        setUnitDelay: vi.fn(),
        isCircuitOpen: vi.fn().mockResolvedValue(false),
        openCircuit: vi.fn().mockResolvedValue(undefined),
        recordCircuitFailure: vi.fn().mockResolvedValue(1),
        resetCircuit: vi.fn().mockResolvedValue(undefined),
      },
    });
    const req = new Request("https://example.com/api/check-state", { method: "GET" });
    const res = await handleCheckState(req, deps);
    expect(res.status).toBe(500);
  });

  /**
   * The states check-state normally reports come from Redis, which is only as
   * good as the webhooks that reached us. Asking the devices costs a round trip
   * per sensor, so it is opt-in — but when a close webhook is dropped, this is
   * the only thing that notices.
   */
  describe("?verify=yolink", () => {
    it("does not touch the devices unless asked", async () => {
      const deps = createMockDeps();
      const req = new Request("https://example.com/api/check-state", { method: "GET" });

      const res = await handleCheckState(req, deps);
      const body = (await res.json()) as {
        sensorStates: Record<string, string>;
        verification?: {
          checked: number;
          agreed: number;
          drifted: Array<{ sensorId: string; believed: string; actual: string }>;
          unavailable: string[];
        };
      };

      expect(deps.sensor.getState).not.toHaveBeenCalled();
      expect(body.verification).toBeUndefined();
    });

    it("reports a sensor whose real state contradicts ours", async () => {
      const deps = createMockDeps({
        // Redis says front_door is open; the door itself has been shut all along.
        sensor: { getState: vi.fn(async (): Promise<SensorState> => "closed") },
      });
      const req = new Request("https://example.com/api/check-state?verify=yolink", {
        method: "GET",
      });

      const res = await handleCheckState(req, deps);
      const body = (await res.json()) as {
        sensorStates: Record<string, string>;
        verification?: {
          checked: number;
          agreed: number;
          drifted: Array<{ sensorId: string; believed: string; actual: string }>;
          unavailable: string[];
        };
      };

      expect(res.status).toBe(200);
      expect(body.verification!.drifted).toEqual([
        { sensorId: "front_door", believed: "open", actual: "closed" },
      ]);
      expect(body.verification!.checked).toBe(2);
      expect(body.verification!.agreed).toBe(1);
    });

    it("still returns the state report when the devices are unreachable", async () => {
      const deps = createMockDeps({
        sensor: { getState: vi.fn().mockRejectedValue(new Error("YoLink down")) },
      });
      const req = new Request("https://example.com/api/check-state?verify=yolink", {
        method: "GET",
      });

      const res = await handleCheckState(req, deps);
      const body = (await res.json()) as {
        sensorStates: Record<string, string>;
        verification?: {
          checked: number;
          agreed: number;
          drifted: Array<{ sensorId: string; believed: string; actual: string }>;
          unavailable: string[];
        };
      };

      expect(res.status).toBe(200);
      expect(body.sensorStates).toEqual({ front_door: "open", bedroom_window: "closed" });
      expect(body.verification!.unavailable).toEqual(["front_door", "bedroom_window"]);
      expect(body.verification!.drifted).toEqual([]);
    });
  });
});
