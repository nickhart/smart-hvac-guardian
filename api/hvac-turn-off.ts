export const config = { runtime: "edge" };

import { z } from "zod";
import { loadConfig, loadEnvSecrets } from "../src/config/index.js";
import { createDependencies } from "../src/handlers/dependencies.js";
import type { Dependencies } from "../src/handlers/dependencies.js";
import { resolveTenantFromWebhook } from "../src/middleware/tenant.js";
import { verifyQStashSignature } from "../src/providers/qstash/verify.js";
import { createLogger } from "../src/utils/logger.js";
import { jsonResponse, errorResponse } from "../src/utils/response.js";
import { verifyExposureStillHolds } from "../src/handlers/verify-exposure.js";
import {
  CircuitOpenError,
  TerminalProviderError,
  WebhookValidationError,
} from "../src/utils/errors.js";

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

    // Read before the token check, not after: the cancellation branch below
    // returns early, and hardcoding a value there mislabelled every cancelled
    // row as live — including ones recorded while the system was disabled.
    // That is the one flag separating a dry run from real operation.
    const systemEnabled = await d.stateStore.getSystemEnabled();

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
        shutoffEnabled: systemEnabled,
      });

      return jsonResponse({
        status: "ok",
        action: "cancelled",
        hvacUnitId,
      });
    }

    // Validate the target before doing any external work. An unknown unit is
    // never in the zone graph, so the exposure check below would always find it
    // unexposed and abort with a benign 200 — hiding a configuration error
    // behind a result that looks like a correctly avoided shutoff.
    const unitConfig = d.config.hvacUnits[hvacUnitId];
    if (!unitConfig) {
      logger.warn("Unknown HVAC unit in turn-off", { requestId, hvacUnitId });
      return errorResponse("Unknown HVAC unit", 404);
    }

    // The timer says this unit was exposed ten minutes ago. Before acting on
    // that, check the reason still holds — a close webhook that never arrived
    // leaves us shutting off a guest's AC for a door that has been shut the
    // whole time, and nothing downstream can tell that decision from a correct
    // one. Runs before the shadow-mode gate, so a disabled system still records
    // whether the shutoff it decided on would have been justified.
    const exposure = await verifyExposureStillHolds({
      hvacUnitId,
      config: d.config,
      stateStore: d.stateStore,
      sensor: d.sensor,
      analytics: d.analytics,
      logger,
      requestId,
    });

    if (!exposure.stillExposed) {
      logger.warn("Turn-off aborted: sensors say the exposure is over", {
        requestId,
        hvacUnitId,
        drifted: exposure.drifted,
        corrected: exposure.corrected,
        unknownDevices: exposure.unknownDevices,
      });
      await d.stateStore.deleteTimerToken(hvacUnitId);
      await d.analytics.trackHvacCommand({
        requestId,
        hvacUnitId,
        unitName: unitConfig.name,
        action: "aborted_stale_state",
        triggerSource: "sensor_open",
        iftttEvent: unitConfig.iftttEvent,
        shutoffEnabled: systemEnabled,
      });
      return jsonResponse({
        status: "ok",
        action: "aborted_stale_state",
        hvacUnitId,
        drifted: exposure.drifted,
      });
    }

    // The one guard that keeps the HVAC safe: while the system is disabled,
    // execution stops here and IFTTT is never reached. Everything above this
    // point still ran, so the decision is real — it is recorded as a turn-off
    // that was not executed rather than thrown away as a cancellation, which
    // is what makes shadow mode observable.
    if (!systemEnabled) {
      logger.info("Turn-off recorded but not executed: system disabled", {
        requestId,
        hvacUnitId,
      });
      await d.stateStore.deleteTimerToken(hvacUnitId);
      await d.analytics.trackHvacCommand({
        requestId,
        hvacUnitId,
        unitName: unitConfig.name,
        action: "turned_off",
        triggerSource: "sensor_open",
        iftttEvent: unitConfig.iftttEvent,
        shutoffEnabled: false,
      });
      return jsonResponse({
        status: "ok",
        action: "not_executed",
        hvacUnitId,
        reason: "system_disabled",
      });
    }

    logger.info("Turning off HVAC unit", {
      requestId,
      hvacUnitId,
      iftttEvent: unitConfig.iftttEvent,
    });

    await d.hvac.turnOff(unitConfig.iftttEvent);
    await d.stateStore.deleteTimerToken(hvacUnitId);

    logger.info("HVAC unit turned off successfully", { requestId, hvacUnitId });

    await d.analytics.trackHvacCommand({
      requestId,
      hvacUnitId,
      unitName: unitConfig.name,
      action: "turned_off",
      triggerSource: "sensor_open",
      iftttEvent: unitConfig.iftttEvent,
      shutoffEnabled: true,
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

    // QStash retries any non-2xx. A terminal failure (bad webhook key, unknown
    // event) and a deliberately skipped call will both fail identically on
    // every retry, so acknowledge them with a 200 and stop the cycle — each
    // extra attempt is another IFTTT failure notification.
    if (error instanceof CircuitOpenError) {
      logger.warn("Turn-off skipped: provider circuit open", {
        requestId,
        circuit: error.circuit,
      });
      return jsonResponse({ status: "ok", action: "skipped", reason: "circuit_open" });
    }

    if (error instanceof TerminalProviderError) {
      logger.error("Turn-off failed permanently — not retrying", {
        requestId,
        error: error.message,
      });
      return jsonResponse({ status: "ok", action: "failed", reason: "terminal_provider_error" });
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
