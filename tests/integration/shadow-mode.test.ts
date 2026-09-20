import { describe, it, expect, vi } from "vitest";
import { handleHvacTurnOff } from "../../api/hvac-turn-off";
import type { Dependencies } from "@/handlers/dependencies";
import type { Logger } from "@/utils/logger";

const logger: Logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };

/**
 * Shadow mode lets the system keep evaluating and scheduling while switched
 * off, so its decisions can be reviewed before it is trusted to act. The whole
 * arrangement rests on one guarantee: while disabled, the IFTTT call is never
 * reached. A regression here would turn off a guest's HVAC from a system the
 * dashboard reports as off — the one failure direction that reaches people.
 */
function createDeps(systemEnabled: boolean, overrides?: Partial<Dependencies>): Dependencies {
  return {
    sensor: { getState: vi.fn().mockResolvedValue("open") },
    hvac: { turnOff: vi.fn().mockResolvedValue(undefined) },
    scheduler: {
      scheduleDelayedCheck: vi.fn(),
      scheduleTurnOff: vi.fn(),
      scheduleUnitTurnOff: vi.fn(),
    },
    stateStore: {
      setSensorState: vi.fn(),
      getAllSensorStates: vi.fn().mockResolvedValue(new Map([["front_door", "open"]])),
      setTimerToken: vi.fn(),
      getTimerToken: vi.fn().mockResolvedValue("valid-token"),
      deleteTimerToken: vi.fn().mockResolvedValue(undefined),
      getActiveTimerUnitIds: vi.fn().mockResolvedValue([]),
      getSystemEnabled: vi.fn().mockResolvedValue(systemEnabled),
      setSystemEnabled: vi.fn(),
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
      sensorNames: {},
      sensorDefaults: {},
      hvacUnits: {
        ac_living: { name: "Living Room AC", iftttEvent: "turn_off_ac_living", delaySeconds: 600 },
      },
      yolink: { baseUrl: "https://example.com" },
      turnOffUrl: "https://example.com/api/hvac-turn-off",
    } as never,
    logger,
    ...overrides,
  };
}

function makeRequest(body: unknown): Request {
  return new Request("https://example.com/api/hvac-turn-off", {
    method: "POST",
    headers: { "Content-Type": "application/json", "upstash-signature": "sig" },
    body: JSON.stringify(body),
  });
}

describe("shadow mode never actuates the HVAC", () => {
  const payload = { hvacUnitId: "ac_living", cancellationToken: "valid-token" };

  it("does not call IFTTT when the system is disabled, even with a valid token", async () => {
    const deps = createDeps(false);
    await handleHvacTurnOff(makeRequest(payload), deps);
    expect(deps.hvac.turnOff).not.toHaveBeenCalled();
  });

  it("records the withheld turn-off so the decision is still observable", async () => {
    const deps = createDeps(false);
    await handleHvacTurnOff(makeRequest(payload), deps);

    expect(deps.analytics.trackHvacCommand).toHaveBeenCalledWith(
      expect.objectContaining({
        hvacUnitId: "ac_living",
        action: "turned_off",
        shutoffEnabled: false,
      }),
    );
  });

  it("does call IFTTT once the system is enabled", async () => {
    const deps = createDeps(true);
    await handleHvacTurnOff(makeRequest(payload), deps);

    expect(deps.hvac.turnOff).toHaveBeenCalledWith("turn_off_ac_living", expect.any(String));
    expect(deps.analytics.trackHvacCommand).toHaveBeenCalledWith(
      expect.objectContaining({ action: "turned_off", shutoffEnabled: true }),
    );
  });

  it("checks the enabled flag on every turn-off, never caching it", async () => {
    // The flag is read per request so flipping the toggle takes effect on the
    // next timer, not the next deploy.
    const deps = createDeps(false);
    await handleHvacTurnOff(makeRequest(payload), deps);
    expect(deps.stateStore.getSystemEnabled).toHaveBeenCalled();
  });
});
