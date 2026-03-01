export const config = { runtime: "edge" };

import { getDb } from "../../src/db/client.js";
import { getRawTenantConfig, upsertTenantConfig } from "../../src/db/queries/config.js";
import { getSessionPayload, getSessionToken } from "../../src/auth/session.js";
import { RedisStateStore } from "../../src/providers/redis/client.js";
import { loadEnvSecrets } from "../../src/config/index.js";
import { AppConfigSchema } from "../../src/config/schema.js";
import type { EnvSecrets } from "../../src/config/schema.js";
import { createLogger } from "../../src/utils/logger.js";
import { jsonResponse, errorResponse } from "../../src/utils/response.js";

interface AuthResult {
  tenantId: string;
  stateStore: RedisStateStore;
}

/**
 * Authenticate the session and return the tenantId + a state store.
 * Unlike resolveTenantFromSession, this does NOT load or validate config,
 * so the settings page remains accessible even when config is broken.
 */
async function authenticateTenant(
  request: Request,
  envSecrets: EnvSecrets,
): Promise<AuthResult | null> {
  const db = getDb();
  const authStore = new RedisStateStore({
    url: envSecrets.upstashRedisUrl,
    token: envSecrets.upstashRedisToken,
  });

  const token = getSessionToken(request);
  if (!token) return null;

  const session = await getSessionPayload(authStore, token, db);
  if (!session) return null;

  const stateStore = new RedisStateStore({
    url: envSecrets.upstashRedisUrl,
    token: envSecrets.upstashRedisToken,
    tenantId: session.tenantId,
  });

  return { tenantId: session.tenantId, stateStore };
}

export default async function handler(request: Request): Promise<Response> {
  const logger = createLogger();
  const requestId = crypto.randomUUID().slice(0, 8);

  try {
    const envSecrets = loadEnvSecrets();
    const auth = await authenticateTenant(request, envSecrets);
    if (!auth) {
      return errorResponse("Unauthorized", 401);
    }

    const { tenantId, stateStore } = auth;
    const db = getDb();

    if (request.method === "GET") {
      const raw = await getRawTenantConfig(db, tenantId);
      if (!raw) {
        return errorResponse("Config not found", 404);
      }

      // Merge Redis delay overrides into hvacUnits so the settings page
      // shows the effective delay (dashboard slider writes to Redis only).
      const hvacUnits = raw.hvacUnits as Record<string, { delaySeconds?: number }> | undefined;
      if (hvacUnits && typeof hvacUnits === "object") {
        for (const unitId of Object.keys(hvacUnits)) {
          const override = await stateStore.getUnitDelay(unitId);
          if (override !== null) {
            hvacUnits[unitId].delaySeconds = override;
          }
        }
      }

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

      // Save config to DB
      await upsertTenantConfig(db, tenantId, parsed.data);

      // Clear Redis delay overrides so the config values become the source of truth
      for (const unitId of Object.keys(parsed.data.hvacUnits)) {
        await stateStore.deleteUnitDelay(unitId);
      }

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
