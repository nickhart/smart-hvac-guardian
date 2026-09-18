import { describe, it, expect, vi } from "vitest";
import { verifySensorStates } from "@/handlers/verify-sensors.js";
import type { AnalyticsProvider, SensorProvider, SensorState } from "@/providers/types.js";

function makeAnalytics() {
  return {
    trackSensorEvent: vi.fn().mockResolvedValue(undefined),
    trackHvacCommand: vi.fn().mockResolvedValue(undefined),
    trackHvacStateEvent: vi.fn().mockResolvedValue(undefined),
    trackProviderEvent: vi.fn().mockResolvedValue(undefined),
    trackSensorStateDrift: vi.fn().mockResolvedValue(undefined),
  };
}

const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };

function makeSensor(states: Record<string, SensorState | Error>): SensorProvider {
  return {
    getState: vi.fn(async (id: string) => {
      const state = states[id];
      if (state instanceof Error) {
        throw state;
      }
      return state;
    }),
  };
}

function run(options: {
  sensorIds: string[];
  believed: Record<string, string>;
  sensor: SensorProvider;
  analytics?: ReturnType<typeof makeAnalytics>;
  deadlineMs?: number;
  now?: () => number;
}) {
  return verifySensorStates({
    sensorIds: options.sensorIds,
    believed: new Map(Object.entries(options.believed)),
    sensor: options.sensor,
    analytics: (options.analytics ?? makeAnalytics()) as unknown as AnalyticsProvider,
    logger,
    requestId: "req1",
    deadlineMs: options.deadlineMs,
    now: options.now,
  });
}

describe("verifySensorStates", () => {
  it("reports agreement when the device confirms what we believe", async () => {
    const result = await run({
      sensorIds: ["a", "b"],
      believed: { a: "open", b: "closed" },
      sensor: makeSensor({ a: "open", b: "closed" }),
    });

    expect(result.checked).toBe(2);
    expect(result.agreed).toBe(2);
    expect(result.drifted).toEqual([]);
    expect(result.unavailable).toEqual([]);
    expect(result.deadlineExceeded).toBe(false);
  });

  /**
   * The bug this whole thing exists for: a close webhook never arrives, so we
   * go on believing a door is open long after it shut.
   */
  it("detects a dropped close — we say open, the device says closed", async () => {
    const result = await run({
      sensorIds: ["a"],
      believed: { a: "open" },
      sensor: makeSensor({ a: "closed" }),
    });

    expect(result.drifted).toEqual([{ sensorId: "a", believed: "open", actual: "closed" }]);
    expect(result.agreed).toBe(0);
    expect(result.checked).toBe(1);
  });

  /**
   * The more dangerous direction. An unknown sensor defaults to "closed" so the
   * unit keeps running, which means a dropped open is invisible at exactly the
   * moment the system should be acting.
   */
  it("detects a dropped open — we say closed, the device says open", async () => {
    const result = await run({
      sensorIds: ["a"],
      believed: { a: "closed" },
      sensor: makeSensor({ a: "open" }),
    });

    expect(result.drifted).toEqual([{ sensorId: "a", believed: "closed", actual: "open" }]);
  });

  it("treats a sensor we have no belief about as unknown", async () => {
    const analytics = makeAnalytics();
    const result = await run({
      sensorIds: ["a"],
      believed: {},
      sensor: makeSensor({ a: "open" }),
      analytics,
    });

    expect(result.drifted).toEqual([{ sensorId: "a", believed: "unknown", actual: "open" }]);
    expect(analytics.trackSensorStateDrift).toHaveBeenCalledWith(
      expect.objectContaining({ believedState: "unknown", actualState: "open", agreed: false }),
    );
  });

  // Agreements are written too, otherwise a drift count has no denominator and
  // "no drift" is indistinguishable from "nothing was checked".
  it("records a row for every sensor the device answers for, agreeing or not", async () => {
    const analytics = makeAnalytics();
    await run({
      sensorIds: ["a", "b"],
      believed: { a: "open", b: "open" },
      sensor: makeSensor({ a: "open", b: "closed" }),
      analytics,
    });

    expect(analytics.trackSensorStateDrift).toHaveBeenCalledTimes(2);
    expect(analytics.trackSensorStateDrift).toHaveBeenCalledWith(
      expect.objectContaining({ sensorId: "a", agreed: true }),
    );
    expect(analytics.trackSensorStateDrift).toHaveBeenCalledWith(
      expect.objectContaining({ sensorId: "b", agreed: false }),
    );
  });

  it("marks a sensor unavailable when the device errors, and keeps going", async () => {
    const analytics = makeAnalytics();
    const result = await run({
      sensorIds: ["a", "b"],
      believed: { a: "open", b: "closed" },
      sensor: makeSensor({ a: new Error("device offline"), b: "closed" }),
      analytics,
    });

    expect(result.unavailable).toEqual(["a"]);
    expect(result.checked).toBe(1);
    expect(result.agreed).toBe(1);
    expect(analytics.trackProviderEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: "yolink",
        operation: "verify:a",
        outcome: "failed",
        errorMessage: "device offline",
      }),
    );
  });

  // An unreachable device must not take the diagnostic page down with it.
  it("never throws", async () => {
    await expect(
      run({
        sensorIds: ["a"],
        believed: { a: "open" },
        sensor: makeSensor({ a: new Error("boom") }),
      }),
    ).resolves.toMatchObject({ unavailable: ["a"] });
  });

  // Telemetry being down is not the same as the device being unreachable, and
  // must not be reported as though it were.
  it("still reports a state that analytics failed to record", async () => {
    const analytics = makeAnalytics();
    analytics.trackSensorStateDrift.mockRejectedValue(new Error("tinybird down"));

    const result = await run({
      sensorIds: ["a"],
      believed: { a: "open" },
      sensor: makeSensor({ a: "closed" }),
      analytics,
    });

    expect(result.unavailable).toEqual([]);
    expect(result.checked).toBe(1);
    expect(result.drifted).toEqual([{ sensorId: "a", believed: "open", actual: "closed" }]);
  });

  /**
   * YoLink has no timeout of its own, and this runs inside a request that has
   * to return. Once the budget is gone the remaining sensors are reported as
   * unavailable rather than queried.
   */
  it("stops querying once the deadline passes", async () => {
    let clock = 0;
    const sensor = makeSensor({ a: "open", b: "open", c: "open" });

    const result = await run({
      sensorIds: ["a", "b", "c"],
      believed: { a: "open", b: "open", c: "open" },
      sensor,
      deadlineMs: 100,
      now: () => {
        const value = clock;
        clock += 60; // each check burns 60ms of a 100ms budget
        return value;
      },
    });

    expect(result.deadlineExceeded).toBe(true);
    expect(result.unavailable.length).toBeGreaterThan(0);
    expect(sensor.getState).not.toHaveBeenCalledTimes(3);
  });

  it("bounds a single hanging device call", async () => {
    const sensor: SensorProvider = {
      getState: vi.fn(() => new Promise<SensorState>(() => {})), // never settles
    };

    const result = await run({
      sensorIds: ["a"],
      believed: { a: "open" },
      sensor,
      deadlineMs: 20,
    });

    expect(result.unavailable).toEqual(["a"]);
    expect(result.deadlineExceeded).toBe(true);
    expect(result.checked).toBe(0);
  });
});
