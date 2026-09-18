import type { AppConfig } from "../config/index.js";
import type { AnalyticsProvider, SensorProvider, StateStore } from "../providers/types.js";
import type { Logger } from "../utils/logger.js";
import { evaluateZoneGraph } from "../zone-graph/index.js";
import type { SensorState } from "../zone-graph/evaluate.js";
import { verifySensorStates, type SensorDrift } from "./verify-sensors.js";

/**
 * Tighter than the diagnostic's budget. This runs on the control path, where a
 * hang costs a function timeout, which QStash reads as a failure and retries —
 * firing the duplicate turn-off we are trying to avoid in the first place.
 */
export const SHUTOFF_VERIFY_DEADLINE_MS = 3000;

export interface ExposureCheck {
  /** False only when the devices positively say the exposure is over. */
  stillExposed: boolean;
  /** Sensors whose real state contradicted ours. */
  drifted: SensorDrift[];
  /** Sensors we could not reach, so whose believed state still stands. */
  unavailable: string[];
  /** Configured sensors the provider does not have. A config error, not an outage. */
  unknownDevices: string[];
  /** Sensors whose Redis state we corrected from what the device reported. */
  corrected: string[];
}

/**
 * Re-check, at the moment of acting, that the reason for acting still holds.
 *
 * A turn-off is scheduled because a door was open. If the close webhook for
 * that door never arrived, we shut off a guest's AC for a door that has been
 * shut for ten minutes — the most expensive way this system can be wrong, and
 * one the data cannot show us, because from inside the system the decision
 * looks perfectly correct.
 *
 * Only sensors we believe are **open** are checked. They are the ones holding
 * the justification up: a door we think is closed but is really open would
 * argue *for* shutting off, which is what we are already doing. That keeps the
 * check to one or two devices instead of all of them.
 *
 * Fails open. Proceeding on a YoLink outage preserves the behaviour this system
 * had before the check existed; refusing to act would let an outage silently
 * disable every shutoff. (A *sustained* outage should disable the system — that
 * is the roadmap's "Service outage auto-disable", a different timescale and a
 * deliberate decision rather than an accident of one unreachable call.)
 */
export async function verifyExposureStillHolds(options: {
  hvacUnitId: string;
  config: AppConfig;
  stateStore: StateStore;
  sensor: SensorProvider;
  analytics: AnalyticsProvider;
  logger: Logger;
  requestId: string;
  deadlineMs?: number;
}): Promise<ExposureCheck> {
  const { hvacUnitId, config, stateStore, sensor, analytics, logger, requestId } = options;

  const allSensorIds = Object.keys(config.sensorDelays);
  const sensorStates = await stateStore.getAllSensorStates(allSensorIds);
  for (const [id, defaultState] of Object.entries(config.sensorDefaults)) {
    if (!sensorStates.has(id)) {
      sensorStates.set(id, defaultState);
    }
  }
  for (const id of allSensorIds) {
    if (!sensorStates.has(id)) {
      sensorStates.set(id, "closed");
    }
  }

  const believedOpen = [...sensorStates].filter(([, state]) => state === "open").map(([id]) => id);

  // Nothing is believed open, so there is no device reading that could change
  // the answer. Skip the round trip and let the zone graph speak.
  if (believedOpen.length === 0) {
    const { exposedUnits } = evaluateZoneGraph(config.zones, sensorStates);
    return {
      stillExposed: exposedUnits.has(hvacUnitId),
      drifted: [],
      unavailable: [],
      unknownDevices: [],
      corrected: [],
    };
  }

  const verification = await verifySensorStates({
    sensorIds: believedOpen,
    believed: sensorStates,
    sensor,
    analytics,
    logger,
    requestId,
    deadlineMs: options.deadlineMs ?? SHUTOFF_VERIFY_DEADLINE_MS,
  });

  // Apply what the devices told us. Only sensors that answered appear in
  // `drifted`, so an unreachable one keeps its believed state and the exposure
  // stands — the fail-open path.
  const corrected: string[] = [];
  for (const drift of verification.drifted) {
    if (drift.actual !== "open" && drift.actual !== "closed") {
      continue; // "unknown" is not a correction, it is an absence of one
    }
    sensorStates.set(drift.sensorId, drift.actual as SensorState);
    corrected.push(drift.sensorId);

    // Write it back so the system heals instead of staying wrong until the next
    // webhook — which, if webhooks are being dropped, may be a long time.
    try {
      await stateStore.setSensorState(drift.sensorId, drift.actual as SensorState);
    } catch (error) {
      logger.warn("Could not persist corrected sensor state", {
        requestId,
        sensorId: drift.sensorId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  const { exposedUnits } = evaluateZoneGraph(config.zones, sensorStates);

  return {
    stillExposed: exposedUnits.has(hvacUnitId),
    drifted: verification.drifted,
    unavailable: verification.unavailable,
    unknownDevices: verification.unknownDevices,
    corrected,
  };
}
