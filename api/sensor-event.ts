export const config = { runtime: "edge" };

import { z } from "zod";
import { loadConfig, loadEnvSecrets } from "../src/config/index.js";
import { createDependencies } from "../src/handlers/dependencies.js";
import type { Dependencies } from "../src/handlers/dependencies.js";
import { createLogger } from "../src/utils/logger.js";
import { jsonResponse, errorResponse } from "../src/utils/response.js";

const SensorEventPayload = z.object({
  sensorId: z.string().min(1),
  event: z.enum(["open", "close"]),
});

export async function handleSensorEvent(request: Request, deps?: Dependencies): Promise<Response> {
  const logger = deps?.logger ?? createLogger();

  try {
    if (request.method !== "POST") {
      return errorResponse("Method not allowed", 405);
    }

    const body = await request.json().catch(() => null);
    const parsed = SensorEventPayload.safeParse(body);

    if (!parsed.success) {
      logger.warn("Invalid sensor event payload", { errors: parsed.error.flatten() });
      return errorResponse("Invalid payload", 400);
    }

    const { sensorId, event } = parsed.data;
    logger.info("Received sensor event", { sensorId, event });

    if (event === "close") {
      return jsonResponse({ status: "ok", action: "none" });
    }

    // event === "open" — schedule delayed check
    const d = deps ?? createDependencies(loadConfig(), loadEnvSecrets(), logger);
    const sensorConfig = d.config.sensors.find((s) => s.id === sensorId);

    if (!sensorConfig) {
      logger.warn("Unknown sensor ID", { sensorId });
      return errorResponse("Unknown sensor", 404);
    }

    await d.scheduler.scheduleDelayedCheck(sensorId, sensorConfig.delaySeconds);

    logger.info("Delayed check scheduled", { sensorId, delaySeconds: sensorConfig.delaySeconds });

    return jsonResponse({
      status: "ok",
      action: "scheduled",
      delaySeconds: sensorConfig.delaySeconds,
    });
  } catch (error) {
    logger.error("sensor-event handler error", {
      error: error instanceof Error ? error.message : String(error),
    });
    return errorResponse("Internal server error", 500);
  }
}

export default async function handler(request: Request): Promise<Response> {
  return handleSensorEvent(request);
}
