export const config = { runtime: "edge" };

import { z } from "zod";
import { loadConfig, loadEnvSecrets } from "../src/config/index.js";
import { createDependencies } from "../src/handlers/dependencies.js";
import type { Dependencies } from "../src/handlers/dependencies.js";
import { resolveTenantFromWebhook } from "../src/middleware/tenant.js";
import { verifyQStashSignature } from "../src/providers/qstash/verify.js";
import { createLogger } from "../src/utils/logger.js";
import { jsonResponse, errorResponse } from "../src/utils/response.js";
import { WebhookValidationError } from "../src/utils/errors.js";

const TurnOffPayload = z.object({
  hvacUnitId: z.string().min(1),
  cancellationToken: z.string().min(1),
  tenantId: z.string().optional(),
});

export async function handleHvacTurnOff(request: Request, deps?: Dependencies): Promise<Response> {
  const logger = deps?.logger ?? createLogger();
  const requestId = crypto.randomUUID().slice(0, 8);

  try {
    if (request.method !== "POST") {
      return errorResponse("Method not allowed", 405);
    }

    const rawBody = await request.text();

    // Parse body first to check for tenantId
    let body: unknown;
    try {
      body = JSON.parse(rawBody);
    } catch {
      return errorResponse("Invalid JSON", 400);
    }

    const parsed = TurnOffPayload.safeParse(body);
    if (!parsed.success) {
      logger.warn("Invalid turn-off payload", { requestId, errors: parsed.error.flatten() });
      return errorResponse("Invalid payload", 400);
    }

    const { hvacUnitId, cancellationToken, tenantId } = parsed.data;
    logger.info("Received turn-off request", {
      requestId,
      hvacUnitId,
      cancellationToken,
      tenantId,
    });

    // Resolve dependencies: multi-tenant (from QStash payload) or legacy
    let d: Dependencies;
    if (deps) {
      d = deps;
    } else if (tenantId && process.env.DATABASE_URL) {
      const ctx = await resolveTenantFromWebhook(tenantId);
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

    // Verify QStash signature
    const signature = request.headers.get("upstash-signature") ?? "";
    await verifyQStashSignature(d.qstashReceiver, signature, rawBody);

    // Check cancellation token in Redis
    const storedToken = await d.stateStore.getTimerToken(hvacUnitId);

    if (!storedToken || storedToken !== cancellationToken) {
      logger.info("Turn-off cancelled: token mismatch or missing", {
        requestId,
        hvacUnitId,
        expected: storedToken,
        received: cancellationToken,
      });
      await d.analytics.trackHvacCommand({
        requestId,
        hvacUnitId,
        unitName: d.config.hvacUnits[hvacUnitId]?.name ?? hvacUnitId,
        action: "cancelled",
        triggerSource: "sensor_open",
      });

      return jsonResponse({
        status: "ok",
        action: "cancelled",
        hvacUnitId,
      });
    }

    // Check if system is enabled before executing turn-off
    const systemEnabled = await d.stateStore.getSystemEnabled();
    if (!systemEnabled) {
      logger.info("Turn-off skipped: system disabled", { requestId, hvacUnitId });
      await d.stateStore.deleteTimerToken(hvacUnitId);
      await d.analytics.trackHvacCommand({
        requestId,
        hvacUnitId,
        unitName: d.config.hvacUnits[hvacUnitId]?.name ?? hvacUnitId,
        action: "cancelled",
        triggerSource: "sensor_open",
      });
      return jsonResponse({
        status: "ok",
        action: "cancelled",
        hvacUnitId,
        reason: "system_disabled",
      });
    }

    // Token matches — turn off the unit
    const unitConfig = d.config.hvacUnits[hvacUnitId];
    if (!unitConfig) {
      logger.warn("Unknown HVAC unit in turn-off", { requestId, hvacUnitId });
      return errorResponse("Unknown HVAC unit", 404);
    }

    logger.info("Turning off HVAC unit", {
      requestId,
      hvacUnitId,
      iftttEvent: unitConfig.iftttEvent,
    });

    await d.hvac.turnOff(unitConfig.iftttEvent);
    await d.stateStore.deleteTimerToken(hvacUnitId);

    logger.info("HVAC unit turned off successfully", { requestId, hvacUnitId });

    d.analytics.trackHvacCommand({
      requestId,
      hvacUnitId,
      unitName: unitConfig.name,
      action: "turned_off",
      triggerSource: "sensor_open",
      iftttEvent: unitConfig.iftttEvent,
    });

    return jsonResponse({
      status: "ok",
      action: "turned_off",
      hvacUnitId,
    });
  } catch (error) {
    if (error instanceof WebhookValidationError) {
      logger.warn("QStash signature verification failed", { requestId });
      return errorResponse("Unauthorized", 401);
    }

    logger.error("hvac-turn-off handler error", {
      requestId,
      error: error instanceof Error ? error.message : String(error),
    });
    return errorResponse("Internal server error", 500);
  }
}

export default async function handler(request: Request): Promise<Response> {
  return handleHvacTurnOff(request);
}
