export const config = { runtime: "edge" };

import { z } from "zod";
import { getSessionPayload, getSessionToken } from "../../src/auth/session.js";
import { getDb } from "../../src/db/client.js";
import { getOnboardingProgress } from "../../src/db/queries/onboarding.js";
import { RedisStateStore } from "../../src/providers/redis/index.js";
import { loadEnvSecrets } from "../../src/config/index.js";
import { createLogger } from "../../src/utils/logger.js";
import { jsonResponse, errorResponse } from "../../src/utils/response.js";

const TestAppletPayload = z.object({
  iftttEvent: z.string().min(1),
});

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

    const body = await request.json().catch(() => null);
    const parsed = TestAppletPayload.safeParse(body);
    if (!parsed.success) return errorResponse("Invalid payload", 400);

    const { iftttEvent } = parsed.data;

    // Get webhook key from onboarding progress
    const progress = await getOnboardingProgress(db, session.tenantId);
    const step6 = progress?.["6"] as { webhookKey?: string } | undefined;

    if (!step6?.webhookKey) {
      return errorResponse("IFTTT webhook key not configured. Complete step 6 first.", 400);
    }

    // Fire test webhook
    const response = await fetch(
      `https://maker.ifttt.com/trigger/${encodeURIComponent(iftttEvent)}/with/key/${encodeURIComponent(step6.webhookKey)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          value1: "test",
          value2: "HVAC Guardian onboarding test",
          value3: new Date().toISOString(),
        }),
      },
    );

    if (!response.ok) {
      return jsonResponse(
        { status: "error", message: `IFTTT webhook failed: ${response.statusText}` },
        400,
      );
    }

    logger.info("IFTTT applet test fired", {
      requestId,
      tenantId: session.tenantId,
      iftttEvent,
    });

    return jsonResponse({ status: "ok", message: `Test webhook fired for event "${iftttEvent}"` });
  } catch (error) {
    logger.error("ifttt-test-applet error", {
      requestId,
      error: error instanceof Error ? error.message : String(error),
    });
    return errorResponse("Internal server error", 500);
  }
}
