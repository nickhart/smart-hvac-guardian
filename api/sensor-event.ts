export const config = { runtime: "edge" };

import { z } from "zod";
import { loadConfig, loadEnvSecrets } from "../src/config/index.js";
import { createDependencies } from "../src/handlers/dependencies.js";
import type { Dependencies } from "../src/handlers/dependencies.js";
import { extractTenantIdFromUrl } from "../src/middleware/extractTenant.js";
import { resolveTenantFromWebhook } from "../src/middleware/tenant.js";
import { createLogger } from "../src/utils/logger.js";
import { jsonResponse, errorResponse } from "../src/utils/response.js";
import { evaluateZoneGraph } from "../src/zone-graph/index.js";
import { computeTimerActions } from "../src/zone-graph/index.js";
import type { SensorState } from "../src/zone-graph/index.js";
import { getDelayForUnit } from "../src/utils/delay.js";

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

    // Resolve dependencies: multi-tenant (URL path) or legacy (env vars)
    let d: Dependencies;
    if (deps) {
      d = deps;
    } else {
      const tenantId = extractTenantIdFromUrl(request);
      if (tenantId && process.env.DATABASE_URL) {
        const ctx = await resolveTenantFromWebhook(tenantId, request);
        if (!ctx) {
          logger.warn("Unknown or suspended tenant", { requestId, tenantId });
          return errorResponse("Unknown tenant", 404);
        }
        d = createDependencies(ctx.config, ctx.envSecrets, logger, {
          tenantId: ctx.tenantId,
          tenantSecrets: ctx.tenantSecrets,
        });
      } else {
        d = createDependencies(loadConfig(), loadEnvSecrets(), logger);
      }
    }

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

    if (!systemEnabled) {
      logger.info("System disabled, skipping zone evaluation", { requestId });
      await d.analytics.trackSensorEvent({
        requestId,
        sensorId,
        event,
        exposedUnits: [],
        unexposedUnits: [],
        timersScheduled: [],
        timersCancelled: [],
      });
      return jsonResponse({ status: "ok", action: "system_disabled" });
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

    // 5. Compute timer actions
    const { schedule, cancel } = computeTimerActions(previouslyExposed, exposedUnits);
    logger.info("Timer actions computed", { requestId, schedule, cancel });

    // 6. Schedule new timers for newly exposed units
    for (const unitId of schedule) {
      const delaySeconds = await getDelayForUnit(unitId, d.stateStore, d.config);
      const token = crypto.randomUUID();
      const ttl = delaySeconds + 60; // buffer for QStash delivery

      await d.stateStore.setTimerToken(unitId, token, ttl);

      const window = Math.floor(Date.now() / (10 * 60 * 1000));
      const dedupId = `turnoff-${unitId}-${window}`;
      await d.scheduler.scheduleUnitTurnOff(unitId, token, delaySeconds, dedupId);

      logger.info("Timer scheduled for unit", { requestId, unitId, delaySeconds, token, dedupId });
    }

    // 7. Cancel timers for units no longer exposed
    for (const unitId of cancel) {
      await d.stateStore.deleteTimerToken(unitId);
      logger.info("Timer cancelled for unit", { requestId, unitId });
    }

    // 8. Track analytics
    await d.analytics.trackSensorEvent({
      requestId,
      sensorId,
      event,
      exposedUnits: [...exposedUnits],
      unexposedUnits: [...unexposedUnits],
      timersScheduled: schedule,
      timersCancelled: cancel,
    });

    return jsonResponse({
      status: "ok",
      action: schedule.length > 0 || cancel.length > 0 ? "updated" : "none",
      scheduled: schedule,
      cancelled: cancel,
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
