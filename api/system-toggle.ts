export const config = { runtime: "edge" };

import { z } from "zod";
import { loadConfig, loadEnvSecrets } from "../src/config/index.js";
import { createDependencies } from "../src/handlers/dependencies.js";
import type { Dependencies } from "../src/handlers/dependencies.js";
import { createLogger } from "../src/utils/logger.js";
import { jsonResponse, errorResponse } from "../src/utils/response.js";

const TogglePayload = z.object({
  enabled: z.boolean(),
});

export async function handleSystemToggle(
  request: Request,
  deps?: Dependencies,
): Promise<Response> {
  const logger = deps?.logger ?? createLogger();
  const requestId = crypto.randomUUID().slice(0, 8);

  try {
    if (request.method === "GET") {
      const d = deps ?? createDependencies(loadConfig(), loadEnvSecrets(), logger);
      const enabled = await d.stateStore.getSystemEnabled();
      return jsonResponse({ status: "ok", enabled });
    }

    if (request.method !== "POST") {
      return errorResponse("Method not allowed", 405);
    }

    const body = await request.json().catch(() => null);
    const parsed = TogglePayload.safeParse(body);

    if (!parsed.success) {
      logger.warn("Invalid toggle payload", { requestId, errors: parsed.error.flatten() });
      return errorResponse("Invalid payload", 400);
    }

    const { enabled } = parsed.data;
    const d = deps ?? createDependencies(loadConfig(), loadEnvSecrets(), logger);

    await d.stateStore.setSystemEnabled(enabled);
    logger.info("System toggle updated", { requestId, enabled });

    return jsonResponse({ status: "ok", enabled });
  } catch (error) {
    logger.error("system-toggle handler error", {
      requestId,
      error: error instanceof Error ? error.message : String(error),
    });
    return errorResponse("Internal server error", 500);
  }
}

export default async function handler(request: Request): Promise<Response> {
  return handleSystemToggle(request);
}
