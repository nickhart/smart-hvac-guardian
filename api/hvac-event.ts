export const config = { runtime: "edge" };

import { z } from "zod";
import { loadConfig, loadEnvSecrets } from "../src/config/index.js";
import { createDependencies } from "../src/handlers/dependencies.js";
import type { Dependencies } from "../src/handlers/dependencies.js";
import { createLogger } from "../src/utils/logger.js";
import { jsonResponse, errorResponse } from "../src/utils/response.js";

const HvacEventPayload = z.object({
  hvacId: z.string().min(1),
  event: z.enum(["on", "off"]),
});

export async function handleHvacEvent(request: Request, deps?: Dependencies): Promise<Response> {
  const logger = deps?.logger ?? createLogger();

  try {
    if (request.method !== "POST") {
      return errorResponse("Method not allowed", 405);
    }

    const body = await request.json().catch(() => null);
    const parsed = HvacEventPayload.safeParse(body);

    if (!parsed.success) {
      logger.warn("Invalid HVAC event payload", { errors: parsed.error.flatten() });
      return errorResponse("Invalid payload", 400);
    }

    const { hvacId, event } = parsed.data;
    logger.info("Received HVAC event", { hvacId, event });

    if (event === "off") {
      return jsonResponse({ status: "ok", action: "none" });
    }

    // event === "on" — schedule delayed checks for all sensors
    const d = deps ?? createDependencies(loadConfig(), loadEnvSecrets(), logger);
    const hvacUnit = d.config.hvacUnits.find((u) => u.id === hvacId);

    if (!hvacUnit) {
      logger.warn("Unknown HVAC unit ID", { hvacId });
      return errorResponse("Unknown HVAC unit", 404);
    }

    for (const sensor of d.config.sensors) {
      await d.scheduler.scheduleDelayedCheck(sensor.id, sensor.delaySeconds);
      logger.info("Delayed check scheduled", { sensorId: sensor.id, delaySeconds: sensor.delaySeconds });
    }

    return jsonResponse({
      status: "ok",
      action: "scheduled",
      checksScheduled: d.config.sensors.length,
    });
  } catch (error) {
    logger.error("hvac-event handler error", {
      error: error instanceof Error ? error.message : String(error),
    });
    return errorResponse("Internal server error", 500);
  }
}

export default async function handler(request: Request): Promise<Response> {
  return handleHvacEvent(request);
}
