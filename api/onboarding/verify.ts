export const config = { runtime: "edge" };

import { getSessionPayload, getSessionToken } from "../../src/auth/session.js";
import { getDb } from "../../src/db/client.js";
import { getOnboardingProgress } from "../../src/db/queries/onboarding.js";
import { getTenantById } from "../../src/db/queries/tenants.js";
import { RedisStateStore } from "../../src/providers/redis/index.js";
import { loadEnvSecrets } from "../../src/config/index.js";
import {
  tenantWebhookUrls,
  validateOnboardingConfig,
} from "../../src/onboarding/assemble-config.js";
import { createLogger } from "../../src/utils/logger.js";
import { jsonResponse, errorResponse } from "../../src/utils/response.js";

export default async function handler(request: Request): Promise<Response> {
  const logger = createLogger();
  const requestId = crypto.randomUUID().slice(0, 8);

  try {
    if (request.method !== "POST") {
      return errorResponse("Method not allowed", 405);
    }

    const secrets = loadEnvSecrets();
    const authStore = new RedisStateStore({
      url: secrets.upstashRedisUrl,
      token: secrets.upstashRedisToken,
    });

    const token = getSessionToken(request);
    if (!token) return errorResponse("Unauthorized", 401);

    const db = getDb();
    const session = await getSessionPayload(authStore, token, db);
    if (!session) return errorResponse("Unauthorized", 401);

    const tenant = await getTenantById(db, session.tenantId);
    if (!tenant) return errorResponse("Tenant not found", 404);

    const progress = await getOnboardingProgress(db, session.tenantId);
    if (!progress) return errorResponse("No onboarding data found", 400);

    const appUrl =
      process.env.APP_URL ||
      (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "http://localhost:3000");
    const result = validateOnboardingConfig(progress, session.tenantId, appUrl);

    if (!result.success) {
      logger.warn("Config validation failed", {
        requestId,
        tenantId: session.tenantId,
        errors: result.error.flatten(),
      });
      return jsonResponse(
        {
          status: "error",
          message: "Configuration validation failed",
          errors: result.error.flatten(),
        },
        400,
      );
    }

    logger.info("Config verified successfully", { requestId, tenantId: session.tenantId });

    return jsonResponse({
      status: "ok",
      message: "Configuration is valid",
      config: result.data,
      webhookUrls: tenantWebhookUrls(appUrl, session.tenantId),
    });
  } catch (error) {
    logger.error("onboarding verify error", {
      requestId,
      error: error instanceof Error ? error.message : String(error),
    });
    return errorResponse("Internal server error", 500);
  }
}
