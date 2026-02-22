import { describe, it, expect, vi } from "vitest";
import { handleHvacEvent } from "../../api/hvac-event";
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
      scheduleDelayedCheck: vi.fn().mockResolvedValue(undefined),
      scheduleTurnOff: vi.fn().mockResolvedValue(undefined),
      scheduleUnitTurnOff: vi.fn().mockResolvedValue(undefined),
    },
    stateStore: {
      setSensorState: vi.fn(),
      getAllSensorStates: vi.fn().mockResolvedValue(
        new Map([
          ["front_door", "closed"],
          ["bedroom_window", "closed"],
          ["door_bedroom", "closed"],
        ]),
      ),
      setTimerToken: vi.fn().mockResolvedValue(undefined),
      getTimerToken: vi.fn().mockResolvedValue(null),
      deleteTimerToken: vi.fn(),
      getActiveTimerUnitIds: vi.fn().mockResolvedValue([]),
      getSystemEnabled: vi.fn().mockResolvedValue(true),
      setSystemEnabled: vi.fn().mockResolvedValue(undefined),
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
          interiorDoors: [{ id: "door_bedroom", connectsTo: "bedroom" }],
        },
        bedroom: {
          minisplits: ["ac_bedroom"],
          exteriorOpenings: ["bedroom_window"],
          interiorDoors: [{ id: "door_bedroom", connectsTo: "living_room" }],
        },
      },
      sensorDelays: {
        front_door: 90,
        bedroom_window: 120,
        door_bedroom: 0,
      },
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

function makeRequest(body: unknown, method = "POST"): Request {
  return new Request("https://example.com/api/hvac-event", {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("hvac-event handler", () => {
  it("returns 405 for non-POST", async () => {
    const req = new Request("https://example.com/api/hvac-event", { method: "GET" });
    const res = await handleHvacEvent(req, createMockDeps());
    expect(res.status).toBe(405);
  });

  it("returns 400 for invalid payload", async () => {
    const res = await handleHvacEvent(makeRequest({ bad: "data" }), createMockDeps());
    expect(res.status).toBe(400);
  });

  it("returns ok with no action on off event", async () => {
    const deps = createMockDeps();
    const res = await handleHvacEvent(makeRequest({ hvacId: "ac_living", event: "off" }), deps);
    const body = (await res.json()) as Record<string, unknown>;

    expect(res.status).toBe(200);
    expect(body.action).toBe("none");
  });

  it("returns no action when HVAC unit is not in exposed zone", async () => {
    const deps = createMockDeps(); // all sensors closed → no exposure
    const res = await handleHvacEvent(makeRequest({ hvacId: "ac_living", event: "on" }), deps);
    const body = (await res.json()) as Record<string, unknown>;

    expect(res.status).toBe(200);
    expect(body.action).toBe("none");
    expect(deps.scheduler.scheduleUnitTurnOff).not.toHaveBeenCalled();
  });

  it("schedules turn-off when HVAC unit is in exposed zone", async () => {
    const deps = createMockDeps({
      stateStore: {
        setSensorState: vi.fn(),
        getAllSensorStates: vi.fn().mockResolvedValue(
          new Map([
            ["front_door", "open"],
            ["bedroom_window", "closed"],
            ["door_bedroom", "closed"],
          ]),
        ),
        setTimerToken: vi.fn().mockResolvedValue(undefined),
        getTimerToken: vi.fn().mockResolvedValue(null),
        deleteTimerToken: vi.fn(),
        getActiveTimerUnitIds: vi.fn().mockResolvedValue([]),
        getSystemEnabled: vi.fn().mockResolvedValue(true),
        setSystemEnabled: vi.fn().mockResolvedValue(undefined),
      },
    });

    const res = await handleHvacEvent(makeRequest({ hvacId: "ac_living", event: "on" }), deps);
    const body = (await res.json()) as Record<string, unknown>;

    expect(res.status).toBe(200);
    expect(body.action).toBe("scheduled");
    expect(body.hvacUnitId).toBe("ac_living");
    expect(body.delaySeconds).toBe(90);
    expect(deps.scheduler.scheduleUnitTurnOff).toHaveBeenCalledWith(
      "ac_living",
      expect.any(String),
      90,
      expect.stringContaining("turnoff-ac_living-"),
    );
    expect(deps.stateStore.setTimerToken).toHaveBeenCalledWith(
      "ac_living",
      expect.any(String),
      150,
    );
  });

  it("returns system_disabled when system is disabled", async () => {
    const deps = createMockDeps({
      stateStore: {
        setSensorState: vi.fn(),
        getAllSensorStates: vi.fn().mockResolvedValue(
          new Map([
            ["front_door", "open"],
            ["bedroom_window", "closed"],
            ["door_bedroom", "closed"],
          ]),
        ),
        setTimerToken: vi.fn(),
        getTimerToken: vi.fn(),
        deleteTimerToken: vi.fn(),
        getActiveTimerUnitIds: vi.fn(),
        getSystemEnabled: vi.fn().mockResolvedValue(false),
        setSystemEnabled: vi.fn(),
      },
    });

    const res = await handleHvacEvent(makeRequest({ hvacId: "ac_living", event: "on" }), deps);
    const body = (await res.json()) as Record<string, unknown>;

    expect(res.status).toBe(200);
    expect(body.action).toBe("system_disabled");
    expect(deps.scheduler.scheduleUnitTurnOff).not.toHaveBeenCalled();
  });

  it("returns 404 for unknown hvacId", async () => {
    const deps = createMockDeps();
    const res = await handleHvacEvent(makeRequest({ hvacId: "unknown", event: "on" }), deps);
    expect(res.status).toBe(404);
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
        getSystemEnabled: vi.fn().mockResolvedValue(true),
        setSystemEnabled: vi.fn(),
      },
    });
    const res = await handleHvacEvent(makeRequest({ hvacId: "ac_living", event: "on" }), deps);
    expect(res.status).toBe(500);
  });
});
