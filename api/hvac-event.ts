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
import { getDelayForUnit } from "../src/utils/delay.js";

const HvacEventPayload = z.object({
  hvacId: z.string().min(1),
  event: z.enum(["on", "off"]),
});

export async function handleHvacEvent(request: Request, deps?: Dependencies): Promise<Response> {
  const logger = deps?.logger ?? createLogger();
  const requestId = crypto.randomUUID().slice(0, 8);

  try {
    if (request.method !== "POST") {
      return errorResponse("Method not allowed", 405);
    }

    const body = await request.json().catch(() => null);
    const parsed = HvacEventPayload.safeParse(body);

    if (!parsed.success) {
      logger.warn("Invalid HVAC event payload", { requestId, errors: parsed.error.flatten() });
      return errorResponse("Invalid payload", 400);
    }

    const { hvacId, event } = parsed.data;
    logger.info("Received HVAC event", { requestId, hvacId, event });

    // Resolve dependencies: multi-tenant or legacy
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

    if (event === "off") {
      await d.analytics.trackHvacStateEvent({
        requestId,
        hvacId,
        event: "off",
        wasExposed: false,
        turnoffScheduled: false,
      });
      return jsonResponse({ status: "ok", action: "none" });
    }

    // Check if system is enabled
    const systemEnabled = await d.stateStore.getSystemEnabled();
    if (!systemEnabled) {
      logger.info("System disabled, skipping HVAC evaluation", { requestId });
      await d.analytics.trackHvacStateEvent({
        requestId,
        hvacId,
        event: "on",
        wasExposed: false,
        turnoffScheduled: false,
      });
      return jsonResponse({ status: "ok", action: "system_disabled" });
    }

    if (!(hvacId in d.config.hvacUnits)) {
      logger.warn("Unknown HVAC unit ID", { requestId, hvacId });
      return errorResponse("Unknown HVAC unit", 404);
    }

    // Read all sensor states from Redis, applying defaults for sensors without state
    const allSensorIds = Object.keys(d.config.sensorDelays);
    const sensorStates = await d.stateStore.getAllSensorStates(allSensorIds);
    for (const [id, defaultState] of Object.entries(d.config.sensorDefaults)) {
      if (!sensorStates.has(id)) {
        sensorStates.set(id, defaultState);
      }
    }

    // Treat offline/unknown sensors as "closed" (safe default: AC stays on)
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

    // Evaluate zone graph
    const { exposedUnits } = evaluateZoneGraph(d.config.zones, sensorStates);

    if (!exposedUnits.has(hvacId)) {
      logger.info("HVAC unit is not in an exposed zone, no action needed", {
        requestId,
        hvacId,
      });
      await d.analytics.trackHvacStateEvent({
        requestId,
        hvacId,
        event: "on",
        wasExposed: false,
        turnoffScheduled: false,
      });
      return jsonResponse({ status: "ok", action: "none" });
    }

    // Unit is exposed — schedule turn-off timer
    const delaySeconds = await getDelayForUnit(hvacId, d.stateStore, d.config);
    const token = crypto.randomUUID();
    const ttl = delaySeconds + 60;

    await d.stateStore.setTimerToken(hvacId, token, ttl);

    const window = Math.floor(Date.now() / (10 * 60 * 1000));
    const dedupId = `turnoff-${hvacId.trim()}-${window}`;
    await d.scheduler.scheduleUnitTurnOff(hvacId, token, delaySeconds, dedupId);

    logger.info("Turn-off scheduled for HVAC unit on event", {
      requestId,
      hvacId,
      delaySeconds,
      dedupId,
    });

    const unitConfig = d.config.hvacUnits[hvacId];
    await d.analytics.trackHvacStateEvent({
      requestId,
      hvacId,
      event: "on",
      wasExposed: true,
      turnoffScheduled: true,
    });
    await d.analytics.trackHvacCommand({
      requestId,
      hvacUnitId: hvacId,
      unitName: unitConfig?.name ?? hvacId,
      action: "scheduled",
      triggerSource: "hvac_on",
      delaySeconds,
      iftttEvent: unitConfig?.iftttEvent,
    });

    return jsonResponse({
      status: "ok",
      action: "scheduled",
      hvacUnitId: hvacId,
      delaySeconds,
    });
  } catch (error) {
    logger.error("hvac-event handler error", {
      requestId,
      error: error instanceof Error ? error.message : String(error),
    });
    return errorResponse("Internal server error", 500);
  }
}

export default async function handler(request: Request): Promise<Response> {
  return handleHvacEvent(request);
}
