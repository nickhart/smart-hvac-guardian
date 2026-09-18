export const config = { runtime: "edge" };

import { z } from "zod";
import { getSessionPayload, getSessionToken } from "../../src/auth/session.js";
import { getDb } from "../../src/db/client.js";
import { RedisStateStore } from "../../src/providers/redis/index.js";
import { loadEnvSecrets } from "../../src/config/index.js";
import { createLogger } from "../../src/utils/logger.js";
import { jsonResponse, errorResponse } from "../../src/utils/response.js";
import { fetchWithTimeout } from "../../src/utils/http.js";

/**
 * Onboarding runs interactively and one-off, so it can wait longer than the
 * control path — but a hung setup step still has to fail with a message
 * rather than a function timeout.
 */
const ONBOARDING_TIMEOUT_MS = 10000;

const IftttTestPayload = z.object({
  webhookKey: z.string().min(1),
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
    const parsed = IftttTestPayload.safeParse(body);
    if (!parsed.success) return errorResponse("Invalid payload", 400);

    const { webhookKey } = parsed.data;

    // Test IFTTT webhook key by hitting the status endpoint
    const response = await fetchWithTimeout(
      `https://maker.ifttt.com/trigger/test_connection/with/key/${encodeURIComponent(webhookKey)}`,
      { method: "POST" },
      ONBOARDING_TIMEOUT_MS,
    );

    if (!response.ok) {
      return jsonResponse({ status: "error", message: "Invalid IFTTT webhook key" }, 400);
    }

    logger.info("IFTTT webhook key verified", { requestId, tenantId: session.tenantId });
    return jsonResponse({ status: "ok", message: "IFTTT webhook key is valid" });
  } catch (error) {
    logger.error("ifttt-test error", {
      requestId,
      error: error instanceof Error ? error.message : String(error),
    });
    return errorResponse("Internal server error", 500);
  }
}
