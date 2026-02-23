export const config = { runtime: "edge" };

import { z } from "zod";
import { loadConfig, loadEnvSecrets } from "../src/config/index.js";
import { createDependencies } from "../src/handlers/dependencies.js";
import type { Dependencies } from "../src/handlers/dependencies.js";
import { createLogger } from "../src/utils/logger.js";
import { jsonResponse, errorResponse } from "../src/utils/response.js";

const SetDelayPayload = z.object({
  unitId: z.string().min(1),
  delaySeconds: z.number().int().positive(),
});

export async function handleUnitDelay(request: Request, deps?: Dependencies): Promise<Response> {
  const logger = deps?.logger ?? createLogger();
  const requestId = crypto.randomUUID().slice(0, 8);

  try {
    const d = deps ?? createDependencies(loadConfig(), loadEnvSecrets(), logger);

    if (request.method === "GET") {
      const url = new URL(request.url);
      const unitId = url.searchParams.get("unitId");

      if (!unitId || !(unitId in d.config.hvacUnits)) {
        return errorResponse("Invalid or missing unitId", 400);
      }

      const override = await d.stateStore.getUnitDelay(unitId);
      const delaySeconds = override ?? d.config.hvacUnits[unitId].delaySeconds;
      const source = override !== null ? "override" : "config";

      return jsonResponse({ unitId, delaySeconds, source });
    }

    if (request.method !== "POST") {
      return errorResponse("Method not allowed", 405);
    }

    const body = await request.json().catch(() => null);
    const parsed = SetDelayPayload.safeParse(body);

    if (!parsed.success) {
      logger.warn("Invalid unit-delay payload", { requestId, errors: parsed.error.flatten() });
      return errorResponse("Invalid payload", 400);
    }

    const { unitId, delaySeconds } = parsed.data;

    if (!(unitId in d.config.hvacUnits)) {
      return errorResponse("Unknown HVAC unit", 404);
    }

    await d.stateStore.setUnitDelay(unitId, delaySeconds);
    logger.info("Unit delay updated", { requestId, unitId, delaySeconds });

    return jsonResponse({ status: "ok", unitId, delaySeconds });
  } catch (error) {
    logger.error("unit-delay handler error", {
      requestId,
      error: error instanceof Error ? error.message : String(error),
    });
    return errorResponse("Internal server error", 500);
  }
}

export default async function handler(request: Request): Promise<Response> {
  return handleUnitDelay(request);
}
