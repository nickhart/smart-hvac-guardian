import { describe, it, expect, vi } from "vitest";
import { verifyExposureStillHolds } from "@/handlers/verify-exposure.js";
import type { AnalyticsProvider, SensorProvider, StateStore } from "@/providers/types.js";
import type { AppConfig } from "@/config/index.js";
import type { Logger } from "@/utils/logger.js";
import { UnknownDeviceError } from "@/utils/errors.js";

const logger: Logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };

function makeAnalytics() {
  return {
    trackSensorEvent: vi.fn().mockResolvedValue(undefined),
    trackHvacCommand: vi.fn().mockResolvedValue(undefined),
    trackHvacStateEvent: vi.fn().mockResolvedValue(undefined),
    trackProviderEvent: vi.fn().mockResolvedValue(undefined),
    trackSensorStateDrift: vi.fn().mockResolvedValue(undefined),
  };
}

/** One zone, one unit, one door. Enough to make exposure turn on one sensor. */
const config = {
  zones: {
    living_room: { minisplits: ["ac_living"], exteriorOpenings: ["front_door"], interiorDoors: [] },
  },
  sensorDelays: { front_door: 600, side_door: 600 },
  sensorDefaults: {},
  hvacUnits: { ac_living: { name: "Living Room", iftttEvent: "turn_off_ac", delaySeconds: 600 } },
  sensorNames: {},
  yolink: { baseUrl: "https://example.com" },
  turnOffUrl: "https://example.com/api/hvac-turn-off",
} as unknown as AppConfig;

function makeStateStore(states: Record<string, string>) {
  return {
    getAllSensorStates: vi.fn().mockResolvedValue(new Map(Object.entries(states))),
    setSensorState: vi.fn().mockResolvedValue(undefined),
  } as unknown as StateStore;
}

function run(options: {
  states: Record<string, string>;
  sensor: SensorProvider;
  stateStore?: StateStore;
  analytics?: ReturnType<typeof makeAnalytics>;
}) {
  return verifyExposureStillHolds({
    hvacUnitId: "ac_living",
    config,
    stateStore: options.stateStore ?? makeStateStore(options.states),
    sensor: options.sensor,
    analytics: (options.analytics ?? makeAnalytics()) as unknown as AnalyticsProvider,
    logger,
    requestId: "req1",
  });
}

describe("verifyExposureStillHolds", () => {
  /**
   * The case this exists for. A close webhook was dropped, so we are ten
   * minutes into a timer for a door that shut long ago — and from inside the
   * system the decision looks perfectly correct.
   */
  it("aborts when the door we are acting on is really closed", async () => {
    const result = await run({
      states: { front_door: "open", side_door: "closed" },
      sensor: { getState: vi.fn().mockResolvedValue("closed") },
    });

    expect(result.stillExposed).toBe(false);
    expect(result.drifted).toEqual([
      { sensorId: "front_door", believed: "open", actual: "closed" },
    ]);
  });

  // The ordinary case, and the one that must not regress: a genuinely open door
  // still gets its shutoff.
  it("proceeds when the door really is open", async () => {
    const result = await run({
      states: { front_door: "open", side_door: "closed" },
      sensor: { getState: vi.fn().mockResolvedValue("open") },
    });

    expect(result.stillExposed).toBe(true);
    expect(result.drifted).toEqual([]);
  });

  /**
   * Fails open. Refusing to act on an unreachable device would let a YoLink
   * outage silently disable every shutoff in the system.
   */
  it("proceeds when the device cannot be reached", async () => {
    const result = await run({
      states: { front_door: "open", side_door: "closed" },
      sensor: { getState: vi.fn().mockRejectedValue(new Error("YoLink down")) },
    });

    expect(result.stillExposed).toBe(true);
    expect(result.unavailable).toEqual(["front_door"]);
    expect(result.corrected).toEqual([]);
  });

  // "unknown" is an absence of an answer, not an answer. Treating it as closed
  // would cancel a legitimate shutoff on a flaky reading.
  it("does not treat an unknown reading as a correction", async () => {
    const stateStore = makeStateStore({ front_door: "open", side_door: "closed" });
    const result = await run({
      states: { front_door: "open", side_door: "closed" },
      sensor: { getState: vi.fn().mockResolvedValue("unknown") },
      stateStore,
    });

    expect(result.stillExposed).toBe(true);
    expect(result.corrected).toEqual([]);
    expect(stateStore.setSensorState).not.toHaveBeenCalled();
  });

  // Only the sensors holding the justification up. A door we think is closed
  // would argue for shutting off, which is what we are already doing.
  it("only queries sensors believed to be open", async () => {
    const getState = vi.fn().mockResolvedValue("open");
    await run({
      states: { front_door: "open", side_door: "closed" },
      sensor: { getState },
    });

    expect(getState).toHaveBeenCalledTimes(1);
    expect(getState).toHaveBeenCalledWith("front_door");
  });

  it("skips the round trip entirely when nothing is believed open", async () => {
    const getState = vi.fn();
    const result = await run({
      states: { front_door: "closed", side_door: "closed" },
      sensor: { getState },
    });

    expect(getState).not.toHaveBeenCalled();
    expect(result.stillExposed).toBe(false);
  });

  // Otherwise the system stays wrong until the next webhook — which, if
  // webhooks are being dropped, may be a long time.
  it("writes the corrected state back so the system heals", async () => {
    const stateStore = makeStateStore({ front_door: "open", side_door: "closed" });
    const result = await run({
      states: { front_door: "open", side_door: "closed" },
      sensor: { getState: vi.fn().mockResolvedValue("closed") },
      stateStore,
    });

    expect(stateStore.setSensorState).toHaveBeenCalledWith("front_door", "closed");
    expect(result.corrected).toEqual(["front_door"]);
  });

  it("still returns a decision when the correction cannot be persisted", async () => {
    const stateStore = makeStateStore({ front_door: "open", side_door: "closed" });
    vi.mocked(stateStore.setSensorState).mockRejectedValue(new Error("Redis down"));

    const result = await run({
      states: { front_door: "open", side_door: "closed" },
      sensor: { getState: vi.fn().mockResolvedValue("closed") },
      stateStore,
    });

    expect(result.stillExposed).toBe(false);
  });

  it("records the comparison to analytics", async () => {
    const analytics = makeAnalytics();
    await run({
      states: { front_door: "open", side_door: "closed" },
      sensor: { getState: vi.fn().mockResolvedValue("closed") },
      analytics,
    });

    expect(analytics.trackSensorStateDrift).toHaveBeenCalledWith(
      expect.objectContaining({ sensorId: "front_door", agreed: false, actualState: "closed" }),
    );
  });

  /**
   * A device the account does not have cannot confirm or deny the exposure, so
   * the shutoff proceeds — same fail-open rule as an outage. It is reported
   * separately because the remedy is different: someone has to fix the config.
   */
  it("proceeds, but flags a configured sensor the provider does not have", async () => {
    const result = await run({
      states: { front_door: "open", side_door: "closed" },
      sensor: {
        getState: vi.fn().mockRejectedValue(new UnknownDeviceError("YoLink", "front_door")),
      },
    });

    expect(result.stillExposed).toBe(true);
    expect(result.unknownDevices).toEqual(["front_door"]);
    expect(result.corrected).toEqual([]);
  });
});
