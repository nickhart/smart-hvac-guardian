export const config = { runtime: "edge" };

import { z } from "zod";
import type { Dependencies } from "../src/handlers/dependencies.js";
import { extractTenantIdFromUrl } from "../src/middleware/extractTenant.js";
import { dependenciesForTenant } from "../src/middleware/resolve-dependencies.js";
import { createLogger } from "../src/utils/logger.js";
import { jsonResponse, errorResponse } from "../src/utils/response.js";
import { evaluateZoneGraph } from "../src/zone-graph/index.js";
import { computeTimerActions } from "../src/zone-graph/index.js";
import type { SensorState } from "../src/zone-graph/index.js";
import { getDelayForUnit, TIMER_TOKEN_BUFFER_SECONDS } from "../src/utils/delay.js";
import { clearTurnedOff, skipUnitsAlreadyOff } from "../src/handlers/turned-off.js";

const SensorEventPayload = z.object({
  sensorId: z.string().min(1),
  event: z.enum(["open", "close"]),
});

export async function handleSensorEvent(request: Request, deps?: Dependencies): Promise<Response> {
  const logger = deps?.logger ?? createLogger();
  const requestId = crypto.randomUUID().slice(0, 8);

  try {
    if (request.method !== "POST") {
      return errorResponse("Method not allowed", 405);
    }

    const body = await request.json().catch(() => null);
    const parsed = SensorEventPayload.safeParse(body);

    if (!parsed.success) {
      logger.warn("Invalid sensor event payload", { requestId, errors: parsed.error.flatten() });
      return errorResponse("Invalid payload", 400);
    }

    const { sensorId, event } = parsed.data;
    logger.info("Received sensor event", { requestId, sensorId, event });

    const d =
      deps ??
      (await dependenciesForTenant(extractTenantIdFromUrl(request), logger, requestId, request));
    if (d instanceof Response) return d;

    // Validate sensor exists in config
    if (!(sensorId in d.config.sensorDelays)) {
      logger.warn("Unknown sensor ID", { requestId, sensorId });
      return errorResponse("Unknown sensor", 404);
    }

    // 0. Check if system is enabled
    const systemEnabled = await d.stateStore.getSystemEnabled();

    // 1. Write sensor state to Redis (always, even when disabled)
    const state: SensorState = event === "open" ? "open" : "closed";
    await d.stateStore.setSensorState(sensorId, state);
    logger.info("Sensor state written to Redis", { requestId, sensorId, state });

    // When the system is disabled the evaluation still runs and timers are
    // still scheduled — "shadow mode". The turn-off handler is what refuses to
    // call IFTTT while disabled, so nothing reaches the HVAC, but every
    // decision the system would have made is recorded. That is what makes it
    // possible to watch the system behave for a while before trusting it.
    if (!systemEnabled) {
      logger.info("System disabled — evaluating in shadow mode", { requestId });
    }

    // 2. Read all sensor states from Redis, applying defaults for sensors without state
    const allSensorIds = Object.keys(d.config.sensorDelays);
    const sensorStates = await d.stateStore.getAllSensorStates(allSensorIds);
    for (const [id, defaultState] of Object.entries(d.config.sensorDefaults)) {
      if (!sensorStates.has(id)) {
        sensorStates.set(id, defaultState);
      }
    }

    // 2b. Treat offline/unknown sensors as "closed" (safe default: AC stays on)
    const offlineSensorIds: string[] = [];
    for (const id of allSensorIds) {
      if (!sensorStates.has(id)) {
        sensorStates.set(id, "closed");
        offlineSensorIds.push(id);
      }
    }
    if (offlineSensorIds.length > 0) {
      logger.warn("Sensors offline, defaulting to closed", { requestId, offlineSensorIds });
    }

    // 3. Run evaluateZoneGraph
    const { exposedUnits, unexposedUnits } = evaluateZoneGraph(d.config.zones, sensorStates);
    logger.info("Zone graph evaluated", {
      requestId,
      exposedUnits: [...exposedUnits],
      unexposedUnits: [...unexposedUnits],
    });

    // 4. Read active timer tokens from Redis (units with pending timers)
    const activeTimerUnitIds = await d.stateStore.getActiveTimerUnitIds();
    const previouslyExposed = new Set(activeTimerUnitIds);

    // 5. Compute timer actions. A unit with no timer is "newly exposed" to the
    // diff, which is also true of one whose turn-off already went through —
    // so drop those, or every door event re-issues the turn-off.
    const actions = computeTimerActions(previouslyExposed, exposedUnits);
    const { cancel } = actions;
    const { schedule, alreadyOff } = await skipUnitsAlreadyOff(
      actions.schedule,
      d.stateStore,
      logger,
      requestId,
    );
    logger.info("Timer actions computed", { requestId, schedule, cancel, alreadyOff });

    // The exposure is over for these units, and with it the reason to hold
    // back: the next time a door exposes them, they get a turn-off again.
    await clearTurnedOff([...unexposedUnits], d.stateStore, logger, requestId);

    // 6. Schedule new timers for newly exposed units.
    //
    // Across units in parallel; ordered within one. A door exposing four units
    // used to cost twelve serial round trips — a Redis read, a Redis write and
    // a QStash publish each — before the awaited analytics write. IFTTT gives
    // up on a slow webhook and retries, which is where the duplicate events
    // 5-6 seconds apart came from, and a retry it abandons is an event lost.
    //
    // It also means one unit failing no longer leaves the rest unscheduled:
    // every unit is attempted, and the first rejection still surfaces.
    await Promise.all(
      schedule.map(async (unitId) => {
        const delaySeconds = await getDelayForUnit(unitId, d.stateStore, d.config);
        const token = crypto.randomUUID();
        const ttl = delaySeconds + TIMER_TOKEN_BUFFER_SECONDS;

        await d.stateStore.setTimerToken(unitId, token, ttl);
        await d.scheduler.scheduleUnitTurnOff(unitId, token, delaySeconds);

        logger.info("Timer scheduled for unit", { requestId, unitId, delaySeconds, token });
      }),
    );

    // 7. Cancel timers for units no longer exposed
    await Promise.all(
      cancel.map(async (unitId) => {
        await d.stateStore.deleteTimerToken(unitId);
        logger.info("Timer cancelled for unit", { requestId, unitId });
      }),
    );

    // 8. Track analytics. Each skip is recorded, so the data shows how many
    // turn-offs the marker held back — the number this exists to reduce.
    await Promise.all(
      alreadyOff.map((unitId) =>
        d.analytics.trackHvacCommand({
          requestId,
          hvacUnitId: unitId,
          unitName: d.config.hvacUnits[unitId]?.name ?? unitId,
          action: "skipped_already_off",
          triggerSource: "sensor_open",
          shutoffEnabled: systemEnabled,
        }),
      ),
    );
    await d.analytics.trackSensorEvent({
      requestId,
      sensorId,
      event,
      exposedUnits: [...exposedUnits],
      unexposedUnits: [...unexposedUnits],
      timersScheduled: schedule,
      timersCancelled: cancel,
      shutoffEnabled: systemEnabled,
    });

    return jsonResponse({
      status: "ok",
      action: schedule.length > 0 || cancel.length > 0 ? "updated" : "none",
      scheduled: schedule,
      cancelled: cancel,
      skippedAlreadyOff: alreadyOff,
      shutoffEnabled: systemEnabled,
    });
  } catch (error) {
    logger.error("sensor-event handler error", {
      requestId,
      error: error instanceof Error ? error.message : String(error),
    });
    return errorResponse("Internal server error", 500);
  }
}

export default async function handler(request: Request): Promise<Response> {
  return handleSensorEvent(request);
}
