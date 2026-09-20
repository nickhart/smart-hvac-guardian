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
import { readEffectiveSensorStates } from "../src/handlers/verify-exposure.js";
import { getDelayForUnit, TIMER_TOKEN_BUFFER_SECONDS } from "../src/utils/delay.js";

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

    // Validate the unit before recording anything about it, so an unknown id
    // cannot leave state-event rows behind for a unit that does not exist.
    if (!(hvacId in d.config.hvacUnits)) {
      logger.warn("Unknown HVAC unit ID", { requestId, hvacId });
      return errorResponse("Unknown HVAC unit", 404);
    }

    // When disabled the evaluation still runs and timers are still scheduled —
    // "shadow mode". Only the turn-off handler refuses to call IFTTT, so
    // nothing reaches the HVAC while every decision is still recorded.
    const systemEnabled = await d.stateStore.getSystemEnabled();
    if (!systemEnabled) {
      logger.info("System disabled — evaluating in shadow mode", { requestId });
    }

    // Evaluated before the `off` branch, not after. That branch used to report
    // wasExposed: false without ever checking — so a unit that switched off
    // while a door stood open was recorded as unexposed. That is precisely the
    // field you would use to ask whether a shutoff took effect.
    const sensorStates = await readEffectiveSensorStates(d.config, d.stateStore);
    const { exposedUnits } = evaluateZoneGraph(d.config.zones, sensorStates);
    const wasExposed = exposedUnits.has(hvacId);

    if (event === "off") {
      await d.analytics.trackHvacStateEvent({
        requestId,
        hvacId,
        event: "off",
        wasExposed,
        turnoffScheduled: false,
        shutoffEnabled: systemEnabled,
      });
      return jsonResponse({ status: "ok", action: "none" });
    }

    if (!wasExposed) {
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
        shutoffEnabled: systemEnabled,
      });
      return jsonResponse({ status: "ok", action: "none" });
    }

    // Unit is exposed — schedule turn-off timer
    const delaySeconds = await getDelayForUnit(hvacId, d.stateStore, d.config);
    const token = crypto.randomUUID();
    const ttl = delaySeconds + TIMER_TOKEN_BUFFER_SECONDS;

    await d.stateStore.setTimerToken(hvacId, token, ttl);

    await d.scheduler.scheduleUnitTurnOff(hvacId, token, delaySeconds);

    logger.info("Turn-off scheduled for HVAC unit on event", {
      requestId,
      hvacId,
      delaySeconds,
      token,
    });

    const unitConfig = d.config.hvacUnits[hvacId];
    await d.analytics.trackHvacStateEvent({
      requestId,
      hvacId,
      event: "on",
      wasExposed: true,
      turnoffScheduled: true,
      shutoffEnabled: systemEnabled,
    });
    await d.analytics.trackHvacCommand({
      requestId,
      hvacUnitId: hvacId,
      unitName: unitConfig?.name ?? hvacId,
      action: "scheduled",
      triggerSource: "hvac_on",
      delaySeconds,
      iftttEvent: unitConfig?.iftttEvent,
      shutoffEnabled: systemEnabled,
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
