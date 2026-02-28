export const config = { runtime: "edge" };

import { getSessionPayload, getSessionToken } from "../../src/auth/session.js";
import { getDb } from "../../src/db/client.js";
import { getOnboardingProgress } from "../../src/db/queries/onboarding.js";
import { getTenantById, updateTenantStatus } from "../../src/db/queries/tenants.js";
import { upsertTenantConfig } from "../../src/db/queries/config.js";
import { setTenantSecrets } from "../../src/db/queries/secrets.js";
import { RedisStateStore } from "../../src/providers/redis/index.js";
import { loadEnvSecrets } from "../../src/config/index.js";
import { AppConfigSchema } from "../../src/config/schema.js";
import { createSession } from "../../src/auth/session.js";
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

    const sessionToken = getSessionToken(request);
    if (!sessionToken) return errorResponse("Unauthorized", 401);

    const db = getDb();
    const session = await getSessionPayload(authStore, sessionToken, db);
    if (!session) return errorResponse("Unauthorized", 401);

    const tenant = await getTenantById(db, session.tenantId);
    if (!tenant) return errorResponse("Tenant not found", 404);

    const progress = await getOnboardingProgress(db, session.tenantId);
    if (!progress) return errorResponse("No onboarding data found", 400);

    // Extract credentials from step data
    const step2 = (progress["2"] ?? {}) as { uaCid?: string; secretKey?: string };
    const step6 = (progress["6"] ?? {}) as { webhookKey?: string };

    if (!step2.uaCid || !step2.secretKey || !step6.webhookKey) {
      return errorResponse("Missing required credentials. Complete all steps first.", 400);
    }

    // Assemble config
    const step3 = (progress["3"] ?? {}) as Record<string, unknown>;
    const step4 = (progress["4"] ?? {}) as Record<string, unknown>;
    const step5 = (progress["5"] ?? {}) as Record<string, unknown>;

    const appUrl =
      secrets.appUrl ||
      (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "http://localhost:3000");

    const rawConfig = {
      zones: step4["zones"] ?? {},
      sensorDelays: step3["sensorDelays"] ?? {},
      hvacUnits: step5["hvacUnits"] ?? {},
      sensorNames: step3["sensorNames"] ?? {},
      sensorDefaults: step3["sensorDefaults"] ?? {},
      yolink: {
        baseUrl: (step3["yolinkBaseUrl"] as string) ?? "https://api.yosmart.com/open/yolink/v2/api",
      },
      turnOffUrl: `${appUrl}/api/t/${session.tenantId}/hvac-turn-off`,
    };

    const result = AppConfigSchema.safeParse(rawConfig);
    if (!result.success) {
      return jsonResponse(
        {
          status: "error",
          message: "Configuration validation failed",
          errors: result.error.flatten(),
        },
        400,
      );
    }

    // Generate a per-tenant webhook secret (32 random bytes as hex)
    const webhookSecretBytes = new Uint8Array(32);
    crypto.getRandomValues(webhookSecretBytes);
    const webhookSecret = Array.from(webhookSecretBytes)
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");

    // Write config and secrets to DB
    await upsertTenantConfig(db, session.tenantId, result.data);
    await setTenantSecrets(db, session.tenantId, {
      yolinkUaCid: step2.uaCid,
      yolinkSecretKey: step2.secretKey,
      iftttWebhookKey: step6.webhookKey,
      webhookSecret,
    });

    // Activate tenant
    await updateTenantStatus(db, session.tenantId, "active");

    // Refresh session to reflect new status
    const newSession = await createSession(authStore, session.email, db);

    logger.info("Tenant activated", { requestId, tenantId: session.tenantId });

    const response = jsonResponse({
      status: "ok",
      message: "Your system is now active!",
      webhookUrls: {
        sensorEvent: `${appUrl}/api/t/${session.tenantId}/sensor-event`,
        hvacEvent: `${appUrl}/api/t/${session.tenantId}/hvac-event`,
      },
      webhookSecret,
    });

    // Set new session cookie if session was refreshed
    if (newSession) {
      // Delete old session
      await authStore.deleteSession(sessionToken);
      response.headers.set(
        "Set-Cookie",
        `session=${newSession.token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${7 * 24 * 60 * 60}; Secure`,
      );
    }

    return response;
  } catch (error) {
    logger.error("onboarding activate error", {
      requestId,
      error: error instanceof Error ? error.message : String(error),
    });
    return errorResponse("Internal server error", 500);
  }
}
