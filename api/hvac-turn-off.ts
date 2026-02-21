export const config = { runtime: "edge" };

import { loadConfig, loadEnvSecrets } from "../src/config/index.js";
import { createDependencies } from "../src/handlers/dependencies.js";
import type { Dependencies } from "../src/handlers/dependencies.js";
import { verifyQStashSignature } from "../src/providers/qstash/verify.js";
import { createLogger } from "../src/utils/logger.js";
import { jsonResponse, errorResponse } from "../src/utils/response.js";
import { WebhookValidationError } from "../src/utils/errors.js";

export async function handleHvacTurnOff(request: Request, deps?: Dependencies): Promise<Response> {
  const logger = deps?.logger ?? createLogger();
  const requestId = crypto.randomUUID().slice(0, 8);

  try {
    if (request.method !== "POST") {
      return errorResponse("Method not allowed", 405);
    }

    const rawBody = await request.text();
    const d = deps ?? createDependencies(loadConfig(), loadEnvSecrets(), logger);

    // Verify QStash signature
    const signature = request.headers.get("upstash-signature") ?? "";
    await verifyQStashSignature(d.qstashReceiver, signature, rawBody);

    const iftttEvents = d.config.hvacUnits.map((u) => u.iftttEvent);
    logger.info("Turning off all HVAC units", {
      requestId,
      unitCount: d.config.hvacUnits.length,
      iftttEvents,
    });

    const results = await Promise.allSettled(
      d.config.hvacUnits.map((unit) => d.hvac.turnOff(unit.iftttEvent)),
    );

    const failures = results.filter((r) => r.status === "rejected");
    if (failures.length > 0) {
      logger.error("Some HVAC turnoff commands failed", {
        requestId,
        failureCount: failures.length,
        totalUnits: d.config.hvacUnits.length,
      });
    }

    logger.info("HVAC turnoff complete", {
      requestId,
      successes: results.length - failures.length,
      failures: failures.length,
    });

    return jsonResponse({
      status: "ok",
      action: "hvac_turned_off",
      unitsProcessed: d.config.hvacUnits.length,
      failures: failures.length,
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
