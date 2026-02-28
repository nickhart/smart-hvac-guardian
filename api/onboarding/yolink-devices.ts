export const config = { runtime: "edge" };

import { getSessionPayload, getSessionToken } from "../../src/auth/session.js";
import { getDb } from "../../src/db/client.js";
import { getOnboardingProgress } from "../../src/db/queries/onboarding.js";
import { RedisStateStore } from "../../src/providers/redis/index.js";
import { loadEnvSecrets } from "../../src/config/index.js";
import { createLogger } from "../../src/utils/logger.js";
import { jsonResponse, errorResponse } from "../../src/utils/response.js";

interface YoLinkDevice {
  deviceId: string;
  name: string;
  type: string;
  modelName: string;
}

export default async function handler(request: Request): Promise<Response> {
  const logger = createLogger();
  const requestId = crypto.randomUUID().slice(0, 8);

  try {
    if (request.method !== "GET") {
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

    // Get YoLink credentials from saved onboarding data
    const progress = await getOnboardingProgress(db, session.tenantId);
    const step2 = progress?.["2"] as { uaCid?: string; secretKey?: string } | undefined;

    if (!step2?.uaCid || !step2?.secretKey) {
      return errorResponse("YoLink credentials not configured. Complete step 2 first.", 400);
    }

    // Get access token
    const tokenResponse = await fetch("https://api.yosmart.com/open/yolink/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "client_credentials",
        client_id: step2.uaCid,
        client_secret: step2.secretKey,
      }),
    });

    if (!tokenResponse.ok) {
      return errorResponse("Failed to authenticate with YoLink", 502);
    }

    const tokenData = (await tokenResponse.json()) as { access_token?: string };
    if (!tokenData.access_token) {
      return errorResponse("Could not get YoLink access token", 502);
    }

    // Get device list
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

    const devicesData = (await devicesResponse.json()) as {
      data?: { devices?: YoLinkDevice[] };
    };

    // Filter to door/window sensors
    const sensors = (devicesData.data?.devices ?? []).filter(
      (d) => d.type === "DoorSensor" || d.type === "LeakSensor" || d.type.includes("Sensor"),
    );

    logger.info("YoLink devices discovered", {
      requestId,
      tenantId: session.tenantId,
      totalDevices: devicesData.data?.devices?.length ?? 0,
      sensors: sensors.length,
    });

    return jsonResponse({
      status: "ok",
      devices: sensors.map((d) => ({
        deviceId: d.deviceId,
        name: d.name,
        type: d.type,
        modelName: d.modelName,
      })),
    });
  } catch (error) {
    logger.error("yolink-devices error", {
      requestId,
      error: error instanceof Error ? error.message : String(error),
    });
    return errorResponse("Internal server error", 500);
  }
}
