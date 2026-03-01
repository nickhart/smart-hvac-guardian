export const config = { runtime: "edge" };

import { getDb } from "../../src/db/client.js";
import { getRawTenantConfig, upsertTenantConfig } from "../../src/db/queries/config.js";
import { getSessionPayload, getSessionToken } from "../../src/auth/session.js";
import { RedisStateStore } from "../../src/providers/redis/client.js";
import { loadEnvSecrets } from "../../src/config/index.js";
import { AppConfigSchema } from "../../src/config/schema.js";
import { createLogger } from "../../src/utils/logger.js";
import { jsonResponse, errorResponse } from "../../src/utils/response.js";

/**
 * Authenticate the session and return the tenantId.
 * Unlike resolveTenantFromSession, this does NOT load or validate config,
 * so the settings page remains accessible even when config is broken.
 */
async function authenticateTenant(request: Request): Promise<string | null> {
  const envSecrets = loadEnvSecrets();
  const db = getDb();
  const authStore = new RedisStateStore({
    url: envSecrets.upstashRedisUrl,
    token: envSecrets.upstashRedisToken,
  });

  const token = getSessionToken(request);
  if (!token) return null;

  const session = await getSessionPayload(authStore, token, db);
  if (!session) return null;

  return session.tenantId;
}

export default async function handler(request: Request): Promise<Response> {
  const logger = createLogger();
  const requestId = crypto.randomUUID().slice(0, 8);

  try {
    const tenantId = await authenticateTenant(request);
    if (!tenantId) {
      return errorResponse("Unauthorized", 401);
    }

    const db = getDb();

    if (request.method === "GET") {
      const raw = await getRawTenantConfig(db, tenantId);
      if (!raw) {
        return errorResponse("Config not found", 404);
      }
      // Include validation errors so the UI can show what's wrong
      const validation = AppConfigSchema.safeParse(raw);
      return jsonResponse({
        status: "ok",
        config: raw,
        valid: validation.success,
        errors: validation.success ? undefined : validation.error.flatten(),
      });
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

      await upsertTenantConfig(db, tenantId, parsed.data);
      logger.info("Config updated via settings", { requestId, tenantId });
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
