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

    if (event === "off") {
      return jsonResponse({ status: "ok", action: "none" });
    }

    // event === "on" — schedule delayed checks for all sensors
    const d = deps ?? createDependencies(loadConfig(), loadEnvSecrets(), logger);
    const hvacUnit = d.config.hvacUnits.find((u) => u.id === hvacId);

    if (!hvacUnit) {
      logger.warn("Unknown HVAC unit ID", { requestId, hvacId });
      return errorResponse("Unknown HVAC unit", 404);
    }

    const window = Math.floor(Date.now() / (10 * 60 * 1000)); // 10-min window
    logger.info("Scheduling delayed checks for sensors", {
      requestId, hvacId, sensorCount: d.config.sensors.length, dedupWindow: window,
    });

    for (const sensor of d.config.sensors) {
      const dedupId = `hvac-on-${hvacId}-${sensor.id}-${window}`;
      await d.scheduler.scheduleDelayedCheck(sensor.id, sensor.delaySeconds, dedupId);
      logger.info("Delayed check scheduled", {
        requestId, sensorId: sensor.id, delaySeconds: sensor.delaySeconds, dedupId,
      });
    }

    return jsonResponse({
      status: "ok",
      action: "scheduled",
      checksScheduled: d.config.sensors.length,
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
