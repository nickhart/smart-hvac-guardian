import type { AnalyticsProvider, SensorProvider } from "../providers/types.js";
import { UnknownDeviceError } from "../utils/errors.js";
import type { Logger } from "../utils/logger.js";

/**
 * Total budget for querying the devices. The reconciliation is a diagnostic,
 * not part of the control path, but it still runs inside a request that has to
 * return: YoLink is an external service with no timeout of its own, and an
 * unbounded call here would hang the handler until the function times out.
 */
export const VERIFY_DEADLINE_MS = 5000;

export interface SensorDrift {
  sensorId: string;
  /** What our webhook-derived state says the sensor is doing. */
  believed: string;
  /** What the device itself reports. */
  actual: string;
}

export interface SensorVerification {
  /** Sensors the device answered for. */
  checked: number;
  agreed: number;
  drifted: SensorDrift[];
  /** Sensors the device did not answer for, in time or at all. */
  unavailable: string[];
  /**
   * Sensors the provider says it has never heard of. A configuration error, not
   * an outage: structural validation cannot catch a well-formed config that
   * names a device which no longer exists, so this is the only place it shows.
   */
  unknownDevices: string[];
  /** True when the budget ran out before every sensor was queried. */
  deadlineExceeded: boolean;
  durationMs: number;
}

/**
 * Bound a promise that has no cancellation of its own. The underlying request
 * keeps running when this rejects — it is not cancelled, only stopped from
 * holding up the response.
 */
async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`timed out after ${ms}ms`)), ms);
      }),
    ]);
  } finally {
    if (timer !== undefined) {
      clearTimeout(timer);
    }
  }
}

/**
 * Write a telemetry row without letting a telemetry failure become the
 * diagnostic's failure. The Tinybird provider already swallows its own errors;
 * this covers every other implementation.
 */
async function record(write: () => Promise<void>): Promise<void> {
  try {
    await write();
  } catch {
    // Telemetry is not the answer the caller asked for.
  }
}

/**
 * Compare what we believe each sensor is doing against what the device reports.
 *
 * Our belief comes from webhooks, so it is only as good as the events that
 * reached us, and the failure is silent in both directions: an unknown sensor
 * defaults to "closed" so a dropped open looks like a quiet door, and a dropped
 * close leaves a door open forever in our state but shut in reality.
 *
 * Every sensor the device answers for produces a row, agreeing or not, so the
 * drift rate has a denominator. A successful row is itself the record that the
 * YoLink call worked, so only failures are additionally logged as provider
 * events.
 *
 * Queries run one at a time on purpose. The YoLink client caches its access
 * token and device tokens per instance, and that cache is built by the first
 * call; firing them in parallel would have every request miss the cache and
 * re-authenticate.
 *
 * Never throws. A diagnostic that breaks the page it reports on is worse than
 * one that reports it could not reach the devices.
 */
export async function verifySensorStates(options: {
  sensorIds: string[];
  /** The effective state the system is acting on, after defaults are applied. */
  believed: Map<string, string>;
  sensor: SensorProvider;
  analytics: AnalyticsProvider;
  logger: Logger;
  requestId: string;
  deadlineMs?: number;
  now?: () => number;
}): Promise<SensorVerification> {
  const { sensorIds, believed, sensor, analytics, logger, requestId } = options;
  const deadlineMs = options.deadlineMs ?? VERIFY_DEADLINE_MS;
  const now = options.now ?? (() => Date.now());

  const started = now();
  const drifted: SensorDrift[] = [];
  const unavailable: string[] = [];
  const unknownDevices: string[] = [];
  let checked = 0;
  let agreed = 0;
  let deadlineExceeded = false;

  for (const sensorId of sensorIds) {
    const remaining = deadlineMs - (now() - started);
    if (remaining <= 0) {
      deadlineExceeded = true;
      unavailable.push(sensorId);
      continue;
    }

    const believedState = believed.get(sensorId) ?? "unknown";
    const callStarted = now();

    try {
      const actualState = await withTimeout(sensor.getState(sensorId), remaining);
      const matches = actualState === believedState;

      checked += 1;
      if (matches) {
        agreed += 1;
      } else {
        drifted.push({ sensorId, believed: believedState, actual: actualState });
        logger.warn("Sensor state drift", {
          requestId,
          sensorId,
          believed: believedState,
          actual: actualState,
        });
      }

      // Separate from the call above: the device answered, so the result
      // stands whether or not we manage to record it. Folding this into the
      // same catch would report a reachable sensor as unavailable because
      // analytics was down.
      await record(() =>
        analytics.trackSensorStateDrift({
          requestId,
          sensorId,
          believedState,
          actualState,
          agreed: matches,
        }),
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      unavailable.push(sensorId);

      if (error instanceof UnknownDeviceError) {
        // Not an outage. The provider answered and does not have this device,
        // so waiting or retrying will not help — someone has to fix the config.
        unknownDevices.push(sensorId);
        logger.error("Configured sensor does not exist at the provider", {
          requestId,
          sensorId,
        });
      } else {
        if (message.startsWith("timed out")) {
          deadlineExceeded = true;
        }
        logger.warn("Sensor verification failed", { requestId, sensorId, error: message });
      }

      await record(() =>
        analytics.trackProviderEvent({
          provider: "yolink",
          operation: `verify:${sensorId}`,
          outcome: "failed",
          durationMs: now() - callStarted,
          errorMessage: message,
          terminal: error instanceof UnknownDeviceError,
          requestId,
        }),
      );
    }
  }

  return {
    checked,
    agreed,
    drifted,
    unavailable,
    unknownDevices,
    deadlineExceeded,
    durationMs: now() - started,
  };
}
