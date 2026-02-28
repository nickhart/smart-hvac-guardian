export const config = { runtime: "edge" };

import { getSessionPayload, getSessionToken } from "../../src/auth/session.js";
import { getDb } from "../../src/db/client.js";
import { saveOnboardingStep } from "../../src/db/queries/onboarding.js";
import { RedisStateStore } from "../../src/providers/redis/index.js";
import { loadEnvSecrets } from "../../src/config/index.js";
import { createLogger } from "../../src/utils/logger.js";
import { jsonResponse, errorResponse } from "../../src/utils/response.js";

export default async function handler(request: Request): Promise<Response> {
  const logger = createLogger();
  const requestId = crypto.randomUUID().slice(0, 8);

  try {
    if (request.method !== "POST") {
      return errorResponse("Method not allowed", 405);
    }

    // Check if APP_CONFIG env var exists (legacy config)
    const appConfigRaw = process.env.APP_CONFIG;
    if (!appConfigRaw) {
      return errorResponse("No legacy configuration found", 404);
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

    // Parse legacy config
    let appConfig: Record<string, unknown>;
    try {
      appConfig = JSON.parse(appConfigRaw);
    } catch {
      return errorResponse("APP_CONFIG is not valid JSON", 400);
    }

    // Pre-fill onboarding steps from legacy config
    // Step 1: Account (already created)
    // Step 2: YoLink credentials
    await saveOnboardingStep(db, session.tenantId, 2, {
      uaCid: process.env.YOLINK_UA_CID ?? "",
      secretKey: process.env.YOLINK_SECRET_KEY ?? "",
    });

    // Step 3: Sensors
    await saveOnboardingStep(db, session.tenantId, 3, {
      sensorDelays: appConfig.sensorDelays ?? {},
      sensorNames: appConfig.sensorNames ?? {},
      sensorDefaults: appConfig.sensorDefaults ?? {},
      yolinkBaseUrl: (appConfig.yolink as Record<string, unknown>)?.baseUrl ?? "",
    });

    // Step 4: HVAC Units
    await saveOnboardingStep(db, session.tenantId, 4, {
      hvacUnits: appConfig.hvacUnits ?? {},
    });

    // Step 5: Zones
    await saveOnboardingStep(db, session.tenantId, 5, {
      zones: appConfig.zones ?? {},
    });

    // Step 6: IFTTT credentials
    await saveOnboardingStep(db, session.tenantId, 6, {
      webhookKey: process.env.IFTTT_WEBHOOK_KEY ?? "",
    });

    logger.info("Legacy config imported to onboarding", {
      requestId,
      tenantId: session.tenantId,
    });

    return jsonResponse({
      status: "ok",
      message: "Legacy configuration imported. Review and activate.",
    });
  } catch (error) {
    logger.error("import-env error", {
      requestId,
      error: error instanceof Error ? error.message : String(error),
    });
    return errorResponse("Internal server error", 500);
  }
}
