import { z } from "zod";
import { loadConfig, loadEnvSecrets } from "../src/config/index.js";
import { createDependencies } from "../src/handlers/dependencies.js";
import type { Dependencies } from "../src/handlers/dependencies.js";
import { verifyQStashSignature } from "../src/providers/qstash/verify.js";
import { createLogger } from "../src/utils/logger.js";
import { jsonResponse, errorResponse } from "../src/utils/response.js";
import { WebhookValidationError } from "../src/utils/errors.js";

const CheckStatePayload = z.object({
  sensorId: z.string().min(1),
});

export async function handleCheckState(request: Request, deps?: Dependencies): Promise<Response> {
  const logger = deps?.logger ?? createLogger();

  try {
    if (request.method !== "POST") {
      return errorResponse("Method not allowed", 405);
    }

    const rawBody = await request.text();
    const d = deps ?? createDependencies(loadConfig(), loadEnvSecrets(), logger);

    // Verify QStash signature
    const signature = request.headers.get("upstash-signature") ?? "";
    await verifyQStashSignature(d.qstashReceiver, signature, rawBody);

    const body = JSON.parse(rawBody);
    const parsed = CheckStatePayload.safeParse(body);

    if (!parsed.success) {
      logger.warn("Invalid check-state payload", { errors: parsed.error.flatten() });
      return errorResponse("Invalid payload", 400);
    }

    const { sensorId } = parsed.data;
    logger.info("Checking sensor state", { sensorId });

    const state = await d.sensor.getState(sensorId);
    logger.info("Current sensor state", { sensorId, state });

    if (state !== "open") {
      logger.info("Sensor is not open, no action needed", { sensorId, state });
      return jsonResponse({ status: "ok", action: "none", state });
    }

    // Sensor still open — turn off all HVAC units
    logger.info("Sensor still open, turning off HVAC units", { sensorId });

    const results = await Promise.allSettled(
      d.config.hvacUnits.map((unit) => d.hvac.turnOff(unit.iftttEvent)),
    );

    const failures = results.filter((r) => r.status === "rejected");
    if (failures.length > 0) {
      logger.error("Some HVAC turnoff commands failed", {
        failureCount: failures.length,
        totalUnits: d.config.hvacUnits.length,
      });
    }

    return jsonResponse({
      status: "ok",
      action: "hvac_turned_off",
      unitsProcessed: d.config.hvacUnits.length,
      failures: failures.length,
    });
  } catch (error) {
    if (error instanceof WebhookValidationError) {
      logger.warn("QStash signature verification failed");
      return errorResponse("Unauthorized", 401);
    }

    logger.error("check-state handler error", {
      error: error instanceof Error ? error.message : String(error),
    });
    return errorResponse("Internal server error", 500);
  }
}

export default async function handler(request: Request): Promise<Response> {
  return handleCheckState(request);
}
