export const config = { runtime: "edge" };

import { getSessionPayload, getSessionToken } from "../../src/auth/session.js";
import { getDb } from "../../src/db/client.js";
import { getOnboardingProgress } from "../../src/db/queries/onboarding.js";
import { getTenantById } from "../../src/db/queries/tenants.js";
import { RedisStateStore } from "../../src/providers/redis/index.js";
import { loadEnvSecrets } from "../../src/config/index.js";
import { AppConfigSchema } from "../../src/config/schema.js";
import { createLogger } from "../../src/utils/logger.js";
import { jsonResponse, errorResponse } from "../../src/utils/response.js";

/**
 * Assemble a full AppConfig from onboarding step data.
 */
function assembleConfig(
  stepData: Record<string, Record<string, unknown>>,
  tenantId: string,
): unknown {
  const step3 = (stepData["3"] ?? {}) as Record<string, unknown>;
  const step4 = (stepData["4"] ?? {}) as Record<string, unknown>;
  const step5 = (stepData["5"] ?? {}) as Record<string, unknown>;

  const appUrl =
    process.env.APP_URL ||
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "http://localhost:3000");

  return {
    zones: step5["zones"] ?? {},
    sensorDelays: step3["sensorDelays"] ?? {},
    hvacUnits: step4["hvacUnits"] ?? {},
    sensorNames: step3["sensorNames"] ?? {},
    sensorDefaults: step3["sensorDefaults"] ?? {},
    yolink: {
      baseUrl: (step3["yolinkBaseUrl"] as string) ?? "https://api.yosmart.com/open/yolink/v2/api",
    },
    turnOffUrl: `${appUrl}/api/t/${tenantId}/hvac-turn-off`,
  };
}

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

    // Assemble full config from step data
    const rawConfig = assembleConfig(progress, session.tenantId);

    // Validate with AppConfigSchema
    const result = AppConfigSchema.safeParse(rawConfig);

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
      webhookUrls: {
        sensorEvent: `${result.data.turnOffUrl.replace("/hvac-turn-off", "/sensor-event")}`,
        hvacEvent: `${result.data.turnOffUrl.replace("/hvac-turn-off", "/hvac-event")}`,
      },
    });
  } catch (error) {
    logger.error("onboarding verify error", {
      requestId,
      error: error instanceof Error ? error.message : String(error),
    });
    return errorResponse("Internal server error", 500);
  }
}
