export const config = { runtime: "edge" };

import { z } from "zod";
import { getSessionPayload, getSessionToken } from "../../src/auth/session.js";
import { getDb } from "../../src/db/client.js";
import { RedisStateStore } from "../../src/providers/redis/index.js";
import { loadEnvSecrets } from "../../src/config/index.js";
import { createLogger } from "../../src/utils/logger.js";
import { jsonResponse, errorResponse } from "../../src/utils/response.js";

const YoLinkTestPayload = z.object({
  uaCid: z.string().min(1),
  secretKey: z.string().min(1),
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
    const parsed = YoLinkTestPayload.safeParse(body);
    if (!parsed.success) return errorResponse("Invalid payload", 400);

    const { uaCid, secretKey } = parsed.data;

    // Test credentials by calling the YoLink API
    const response = await fetch("https://api.yosmart.com/open/yolink/v2/api", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        method: "Home.getGeneralInfo",
        time: Date.now(),
        msgid: crypto.randomUUID(),
      }),
    });

    // Get access token first
    const tokenResponse = await fetch("https://api.yosmart.com/open/yolink/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "client_credentials",
        client_id: uaCid,
        client_secret: secretKey,
      }),
    });

    if (!tokenResponse.ok) {
      return jsonResponse({ status: "error", message: "Invalid YoLink credentials" }, 400);
    }

    const tokenData = (await tokenResponse.json()) as { access_token?: string };
    if (!tokenData.access_token) {
      return jsonResponse({ status: "error", message: "Could not authenticate with YoLink" }, 400);
    }

    // Attempt to get device list to verify full access
    const devicesResponse = await fetch("https://api.yosmart.com/open/yolink/v2/api", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${tokenData.access_token}`,
      },
      body: JSON.stringify({
        method: "Home.getDeviceList",
        time: Date.now(),
        msgid: crypto.randomUUID(),
      }),
    });

    if (!devicesResponse.ok) {
      return jsonResponse({ status: "error", message: "Could not list YoLink devices" }, 400);
    }

    logger.info("YoLink credentials verified", { requestId, tenantId: session.tenantId });
    void response; // consume unused response
    return jsonResponse({ status: "ok", message: "YoLink credentials are valid" });
  } catch (error) {
    logger.error("yolink-test error", {
      requestId,
      error: error instanceof Error ? error.message : String(error),
    });
    return errorResponse("Internal server error", 500);
  }
}
