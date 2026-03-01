export const config = { runtime: "edge" };

import { getDb } from "../../src/db/client.js";
import { getTenantConfig, upsertTenantConfig } from "../../src/db/queries/config.js";
import { resolveTenantFromSession } from "../../src/middleware/tenant.js";
import { AppConfigSchema } from "../../src/config/schema.js";
import { createLogger } from "../../src/utils/logger.js";
import { jsonResponse, errorResponse } from "../../src/utils/response.js";

export default async function handler(request: Request): Promise<Response> {
  const logger = createLogger();
  const requestId = crypto.randomUUID().slice(0, 8);

  try {
    const ctx = await resolveTenantFromSession(request);
    if (!ctx) {
      return errorResponse("Unauthorized", 401);
    }

    const db = getDb();

    if (request.method === "GET") {
      const cfg = await getTenantConfig(db, ctx.tenantId);
      if (!cfg) {
        return errorResponse("Config not found", 404);
      }
      return jsonResponse({ status: "ok", config: cfg });
    }

    if (request.method === "PUT") {
      const body = await request.json().catch(() => null);
      if (!body) {
        return errorResponse("Invalid JSON", 400);
      }

      const parsed = AppConfigSchema.safeParse(body);
      if (!parsed.success) {
        logger.warn("Invalid config payload", { requestId, errors: parsed.error.flatten() });
        return errorResponse(parsed.error.message, 400);
      }

      await upsertTenantConfig(db, ctx.tenantId, parsed.data);
      logger.info("Config updated via settings", { requestId, tenantId: ctx.tenantId });
      return jsonResponse({ status: "ok" });
    }

    return errorResponse("Method not allowed", 405);
  } catch (error) {
    logger.error("settings/config handler error", {
      requestId,
      error: error instanceof Error ? error.message : String(error),
    });
    return errorResponse("Internal server error", 500);
  }
}
