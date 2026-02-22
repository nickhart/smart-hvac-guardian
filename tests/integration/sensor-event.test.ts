import { describe, it, expect, vi } from "vitest";
import { handleSensorEvent } from "../../api/sensor-event";
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
      setSensorState: vi.fn().mockResolvedValue(undefined),
      getAllSensorStates: vi.fn().mockResolvedValue(
        new Map([
          ["front_door", "closed"],
          ["bedroom_window", "closed"],
          ["door_bedroom", "closed"],
        ]),
      ),
      setTimerToken: vi.fn().mockResolvedValue(undefined),
      getTimerToken: vi.fn().mockResolvedValue(null),
      deleteTimerToken: vi.fn().mockResolvedValue(undefined),
      getActiveTimerUnitIds: vi.fn().mockResolvedValue([]),
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
  return new Request("https://example.com/api/sensor-event", {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("sensor-event handler", () => {
  it("returns 405 for non-POST", async () => {
    const req = new Request("https://example.com/api/sensor-event", { method: "GET" });
    const res = await handleSensorEvent(req, createMockDeps());
    expect(res.status).toBe(405);
  });

  it("returns 400 for invalid payload", async () => {
    const res = await handleSensorEvent(makeRequest({ bad: "data" }), createMockDeps());
    expect(res.status).toBe(400);
  });

  it("writes sensor state to Redis on close event and evaluates graph", async () => {
    const deps = createMockDeps();
    const res = await handleSensorEvent(
      makeRequest({ sensorId: "front_door", event: "close" }),
      deps,
    );
    const body = (await res.json()) as Record<string, unknown>;

    expect(res.status).toBe(200);
    expect(deps.stateStore.setSensorState).toHaveBeenCalledWith("front_door", "closed");
  });

  it("schedules per-unit timers when exterior sensor opens and zone is exposed", async () => {
    const deps = createMockDeps({
      stateStore: {
        setSensorState: vi.fn().mockResolvedValue(undefined),
        getAllSensorStates: vi.fn().mockResolvedValue(
          new Map([
            ["front_door", "open"],
            ["bedroom_window", "closed"],
            ["door_bedroom", "closed"],
          ]),
        ),
        setTimerToken: vi.fn().mockResolvedValue(undefined),
        getTimerToken: vi.fn().mockResolvedValue(null),
        deleteTimerToken: vi.fn().mockResolvedValue(undefined),
        getActiveTimerUnitIds: vi.fn().mockResolvedValue([]),
      },
    });

    const res = await handleSensorEvent(
      makeRequest({ sensorId: "front_door", event: "open" }),
      deps,
    );
    const body = (await res.json()) as Record<string, unknown>;

    expect(res.status).toBe(200);
    expect(body.action).toBe("updated");
    expect(body.scheduled).toEqual(["ac_living"]);
    expect(deps.stateStore.setTimerToken).toHaveBeenCalledWith(
      "ac_living",
      expect.any(String),
      150, // 90 + 60 buffer
    );
    expect(deps.scheduler.scheduleUnitTurnOff).toHaveBeenCalledWith(
      "ac_living",
      expect.any(String),
      90,
      expect.stringContaining("turnoff-ac_living-"),
    );
  });

  it("cancels timers when zones become safe", async () => {
    const deps = createMockDeps({
      stateStore: {
        setSensorState: vi.fn().mockResolvedValue(undefined),
        getAllSensorStates: vi.fn().mockResolvedValue(
          new Map([
            ["front_door", "closed"],
            ["bedroom_window", "closed"],
            ["door_bedroom", "closed"],
          ]),
        ),
        setTimerToken: vi.fn().mockResolvedValue(undefined),
        getTimerToken: vi.fn().mockResolvedValue(null),
        deleteTimerToken: vi.fn().mockResolvedValue(undefined),
        getActiveTimerUnitIds: vi.fn().mockResolvedValue(["ac_living"]),
      },
    });

    const res = await handleSensorEvent(
      makeRequest({ sensorId: "front_door", event: "close" }),
      deps,
    );
    const body = (await res.json()) as Record<string, unknown>;

    expect(res.status).toBe(200);
    expect(body.action).toBe("updated");
    expect(body.cancelled).toEqual(["ac_living"]);
    expect(deps.stateStore.deleteTimerToken).toHaveBeenCalledWith("ac_living");
  });

  it("returns 404 for unknown sensor", async () => {
    const deps = createMockDeps();
    const res = await handleSensorEvent(makeRequest({ sensorId: "unknown", event: "open" }), deps);
    expect(res.status).toBe(404);
  });

  it("returns 500 on state store failure", async () => {
    const deps = createMockDeps({
      stateStore: {
        setSensorState: vi.fn().mockRejectedValue(new Error("Redis down")),
        getAllSensorStates: vi.fn(),
        setTimerToken: vi.fn(),
        getTimerToken: vi.fn(),
        deleteTimerToken: vi.fn(),
        getActiveTimerUnitIds: vi.fn(),
      },
    });
    const res = await handleSensorEvent(
      makeRequest({ sensorId: "front_door", event: "open" }),
      deps,
    );
    expect(res.status).toBe(500);
  });

  it("applies sensorDefaults for sensors without Redis state", async () => {
    // door_bedroom has no Redis state, but sensorDefaults says "open"
    // So when front_door opens, zones merge via the defaulted-open interior door
    const deps = createMockDeps({
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
        sensorDelays: { front_door: 90, bedroom_window: 120, door_bedroom: 0 },
        sensorDefaults: { door_bedroom: "open" },
        hvacUnits: {
          ac_living: { name: "Living Room AC", iftttEvent: "turn_off_ac_living" },
          ac_bedroom: { name: "Bedroom AC", iftttEvent: "turn_off_ac_bedroom" },
        },
        yolink: { baseUrl: "https://api.yosmart.com/open/yolink/v2/api" },
        turnOffUrl: "https://example.com/api/hvac-turn-off",
      },
      stateStore: {
        setSensorState: vi.fn().mockResolvedValue(undefined),
        getAllSensorStates: vi.fn().mockResolvedValue(
          // door_bedroom has NO entry — default "open" will be applied
          new Map([
            ["front_door", "open"],
            ["bedroom_window", "closed"],
          ]),
        ),
        setTimerToken: vi.fn().mockResolvedValue(undefined),
        getTimerToken: vi.fn().mockResolvedValue(null),
        deleteTimerToken: vi.fn().mockResolvedValue(undefined),
        getActiveTimerUnitIds: vi.fn().mockResolvedValue([]),
      },
    });

    const res = await handleSensorEvent(
      makeRequest({ sensorId: "front_door", event: "open" }),
      deps,
    );
    const body = (await res.json()) as Record<string, unknown>;

    expect(res.status).toBe(200);
    // Both units scheduled because door_bedroom defaults to open, merging zones
    expect((body.scheduled as string[]).sort()).toEqual(["ac_bedroom", "ac_living"]);
  });

  it("does not apply sensorDefaults when Redis has explicit state", async () => {
    // door_bedroom defaults to "open" but Redis says "closed" — should stay isolated
    const deps = createMockDeps({
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
        sensorDelays: { front_door: 90, bedroom_window: 120, door_bedroom: 0 },
        sensorDefaults: { door_bedroom: "open" },
        hvacUnits: {
          ac_living: { name: "Living Room AC", iftttEvent: "turn_off_ac_living" },
          ac_bedroom: { name: "Bedroom AC", iftttEvent: "turn_off_ac_bedroom" },
        },
        yolink: { baseUrl: "https://api.yosmart.com/open/yolink/v2/api" },
        turnOffUrl: "https://example.com/api/hvac-turn-off",
      },
      stateStore: {
        setSensorState: vi.fn().mockResolvedValue(undefined),
        getAllSensorStates: vi.fn().mockResolvedValue(
          new Map([
            ["front_door", "open"],
            ["bedroom_window", "closed"],
            ["door_bedroom", "closed"], // explicit Redis state overrides default
          ]),
        ),
        setTimerToken: vi.fn().mockResolvedValue(undefined),
        getTimerToken: vi.fn().mockResolvedValue(null),
        deleteTimerToken: vi.fn().mockResolvedValue(undefined),
        getActiveTimerUnitIds: vi.fn().mockResolvedValue([]),
      },
    });

    const res = await handleSensorEvent(
      makeRequest({ sensorId: "front_door", event: "open" }),
      deps,
    );
    const body = (await res.json()) as Record<string, unknown>;

    expect(res.status).toBe(200);
    // Only living room — door_bedroom is closed per Redis, overriding the default
    expect(body.scheduled).toEqual(["ac_living"]);
  });

  it("merges zones when interior door is open", async () => {
    const deps = createMockDeps({
      stateStore: {
        setSensorState: vi.fn().mockResolvedValue(undefined),
        getAllSensorStates: vi.fn().mockResolvedValue(
          new Map([
            ["front_door", "open"],
            ["bedroom_window", "closed"],
            ["door_bedroom", "open"],
          ]),
        ),
        setTimerToken: vi.fn().mockResolvedValue(undefined),
        getTimerToken: vi.fn().mockResolvedValue(null),
        deleteTimerToken: vi.fn().mockResolvedValue(undefined),
        getActiveTimerUnitIds: vi.fn().mockResolvedValue([]),
      },
    });

    const res = await handleSensorEvent(
      makeRequest({ sensorId: "front_door", event: "open" }),
      deps,
    );
    const body = (await res.json()) as Record<string, unknown>;

    expect(res.status).toBe(200);
    // Both units should be scheduled since zones are merged
    expect((body.scheduled as string[]).sort()).toEqual(["ac_bedroom", "ac_living"]);
  });
});
