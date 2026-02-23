export const config = { runtime: "edge" };

import { z } from "zod";
import { loadEnvSecrets } from "../../src/config/index.js";
import type { EnvSecrets } from "../../src/config/index.js";
import { RedisStateStore } from "../../src/providers/redis/index.js";
import type { AuthStore } from "../../src/providers/types.js";
import { createLogger } from "../../src/utils/logger.js";
import type { Logger } from "../../src/utils/logger.js";
import { jsonResponse, errorResponse } from "../../src/utils/response.js";

const VerifyOtpPayload = z.object({
  email: z.string().email(),
  code: z.string().length(6),
});

const SESSION_TTL = 7 * 24 * 60 * 60; // 7 days

export interface VerifyOtpDeps {
  secrets: EnvSecrets;
  authStore: AuthStore;
  logger: Logger;
}

export async function handleVerifyOtp(request: Request, deps?: VerifyOtpDeps): Promise<Response> {
  const logger = deps?.logger ?? createLogger();
  const requestId = crypto.randomUUID().slice(0, 8);

  try {
    if (request.method !== "POST") {
      return errorResponse("Method not allowed", 405);
    }

    const secrets = deps?.secrets ?? loadEnvSecrets();

    if (!secrets.resendApiKey || !secrets.ownerEmail) {
      return errorResponse("Auth not configured", 503);
    }

    const body = await request.json().catch(() => null);
    const parsed = VerifyOtpPayload.safeParse(body);

    if (!parsed.success) {
      return errorResponse("Invalid payload", 400);
    }

    const { email, code } = parsed.data;
    const normalizedEmail = email.toLowerCase();

    if (normalizedEmail !== secrets.ownerEmail.toLowerCase()) {
      return errorResponse("Invalid credentials", 401);
    }

    const authStore =
      deps?.authStore ??
      new RedisStateStore({
        url: secrets.upstashRedisUrl,
        token: secrets.upstashRedisToken,
      });

    const storedCode = await authStore.getOtp(normalizedEmail);

    if (!storedCode || storedCode !== code) {
      logger.warn("Invalid OTP attempt", { requestId, email: normalizedEmail });
      return errorResponse("Invalid or expired code", 401);
    }

    // OTP is valid — delete it and create session
    await authStore.deleteOtp(normalizedEmail);

    const sessionToken = crypto.randomUUID();
    await authStore.setSession(sessionToken, normalizedEmail, SESSION_TTL);

    logger.info("Session created", { requestId, email: normalizedEmail });

    const response = jsonResponse({ status: "ok", authenticated: true });
    response.headers.set(
      "Set-Cookie",
      `session=${sessionToken}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_TTL}; Secure`,
    );

    return response;
  } catch (error) {
    logger.error("verify-otp error", {
      requestId,
      error: error instanceof Error ? error.message : String(error),
    });
    return errorResponse("Internal server error", 500);
  }
}

export default async function handler(request: Request): Promise<Response> {
  return handleVerifyOtp(request);
}
