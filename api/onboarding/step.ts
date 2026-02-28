export const config = { runtime: "edge" };

import { z } from "zod";
import { getDb } from "../../src/db/client.js";
import { getSessionPayload, getSessionToken } from "../../src/auth/session.js";
import { getOnboardingProgress, saveOnboardingStep } from "../../src/db/queries/onboarding.js";
import { updateTenantOnboardingStep } from "../../src/db/queries/tenants.js";
import { RedisStateStore } from "../../src/providers/redis/index.js";
import { loadEnvSecrets } from "../../src/config/index.js";
import { createLogger } from "../../src/utils/logger.js";
import { jsonResponse, errorResponse } from "../../src/utils/response.js";

const SaveStepPayload = z.object({
  step: z.number().int().min(1).max(9),
  data: z.record(z.unknown()),
});

export default async function handler(request: Request): Promise<Response> {
  const logger = createLogger();
  const requestId = crypto.randomUUID().slice(0, 8);

  try {
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

    if (request.method === "GET") {
      const progress = await getOnboardingProgress(db, session.tenantId);
      return jsonResponse({ status: "ok", stepData: progress ?? {} });
    }

    if (request.method === "POST") {
      const body = await request.json().catch(() => null);
      const parsed = SaveStepPayload.safeParse(body);

      if (!parsed.success) {
        return errorResponse("Invalid payload", 400);
      }

      const { step, data } = parsed.data;
      await saveOnboardingStep(db, session.tenantId, step, data);
      await updateTenantOnboardingStep(db, session.tenantId, step);

      logger.info("Onboarding step saved", { requestId, tenantId: session.tenantId, step });
      return jsonResponse({ status: "ok", step });
    }

    return errorResponse("Method not allowed", 405);
  } catch (error) {
    logger.error("onboarding step error", {
      requestId,
      error: error instanceof Error ? error.message : String(error),
    });
    return errorResponse("Internal server error", 500);
  }
}
