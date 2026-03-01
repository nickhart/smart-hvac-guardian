export const config = { runtime: "edge" };

import { loadEnvSecrets } from "../../src/config/index.js";
import { RedisStateStore } from "../../src/providers/redis/index.js";
import type { AuthStore } from "../../src/providers/types.js";
import { getSessionPayload, getSessionToken } from "../../src/auth/session.js";
import { getDb } from "../../src/db/client.js";
import type { Database } from "../../src/db/client.js";
import { createLogger } from "../../src/utils/logger.js";
import type { Logger } from "../../src/utils/logger.js";
import { jsonResponse, errorResponse } from "../../src/utils/response.js";

export interface SessionDeps {
  authStore: AuthStore;
  logger: Logger;
  db?: Database;
}

export async function handleSession(request: Request, deps?: SessionDeps): Promise<Response> {
  const logger = deps?.logger ?? createLogger();
  const requestId = crypto.randomUUID().slice(0, 8);

  try {
    if (request.method !== "GET") {
      return errorResponse("Method not allowed", 405);
    }

    const siteName = process.env.SITE_NAME || "HVAC Guardian";
    const logoUrl = process.env.LOGO_URL || null;
    const primaryColor = process.env.PRIMARY_COLOR || null;
    const token = getSessionToken(request);

    if (!token) {
      return jsonResponse({ authenticated: false, siteName, logoUrl, primaryColor });
    }

    const authStore =
      deps?.authStore ??
      (() => {
        const secrets = loadEnvSecrets();
        return new RedisStateStore({
          url: secrets.upstashRedisUrl,
          token: secrets.upstashRedisToken,
        });
      })();

    const db = deps?.db ?? (process.env.DATABASE_URL ? getDb() : undefined);

    // Try multi-tenant session (JSON payload with tenantId)
    if (db) {
      const payload = await getSessionPayload(authStore, token, db);
      if (payload) {
        logger.info("Session validated (multi-tenant)", { requestId, email: payload.email });
        return jsonResponse({
          authenticated: true,
          email: payload.email,
          tenantId: payload.tenantId,
          tenantStatus: payload.tenantStatus,
          siteName,
          logoUrl,
          primaryColor,
        });
      }
      // DB is configured but payload reconstruction failed — session is invalid
      return jsonResponse({ authenticated: false, siteName, logoUrl, primaryColor });
    }

    // Legacy fallback: session stores plain email (only when no DB)
    const email = await authStore.getSession(token);

    if (!email) {
      return jsonResponse({ authenticated: false, siteName, logoUrl, primaryColor });
    }

    // If it looks like JSON, it was a multi-tenant session but DB is unavailable
    try {
      JSON.parse(email);
      // It's JSON but we have no DB — can't validate
      return jsonResponse({ authenticated: false, siteName, logoUrl, primaryColor });
    } catch {
      // Plain email string — legacy single-tenant
    }

    logger.info("Session validated", { requestId, email });
    return jsonResponse({ authenticated: true, email, siteName, logoUrl, primaryColor });
  } catch (error) {
    logger.error("session check error", {
      requestId,
      error: error instanceof Error ? error.message : String(error),
    });
    return errorResponse("Internal server error", 500);
  }
}

export default async function handler(request: Request): Promise<Response> {
  return handleSession(request);
}
