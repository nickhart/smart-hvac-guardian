export const config = { runtime: "edge" };

import { z } from "zod";
import { Resend } from "resend";
import { loadEnvSecrets } from "../../src/config/index.js";
import { RedisStateStore } from "../../src/providers/redis/index.js";
import { createLogger } from "../../src/utils/logger.js";
import { jsonResponse, errorResponse } from "../../src/utils/response.js";

const SendOtpPayload = z.object({
  email: z.string().email(),
});

export default async function handler(request: Request): Promise<Response> {
  const logger = createLogger();
  const requestId = crypto.randomUUID().slice(0, 8);

  try {
    if (request.method !== "POST") {
      return errorResponse("Method not allowed", 405);
    }

    const secrets = loadEnvSecrets();

    if (!secrets.resendApiKey || !secrets.ownerEmail) {
      logger.error("Auth not configured", { requestId });
      return errorResponse("Auth not configured", 503);
    }

    const body = await request.json().catch(() => null);
    const parsed = SendOtpPayload.safeParse(body);

    if (!parsed.success) {
      return errorResponse("Invalid payload", 400);
    }

    const { email } = parsed.data;

    if (email.toLowerCase() !== secrets.ownerEmail.toLowerCase()) {
      logger.warn("Unauthorized email attempt", { requestId, email });
      // Return success to avoid email enumeration
      return jsonResponse({ status: "ok" });
    }

    // Generate 6-digit OTP
    const code = Array.from(crypto.getRandomValues(new Uint8Array(3)))
      .map((b) => (b % 10).toString())
      .join("")
      .padStart(6, "0");

    // Store OTP in Redis with 10-minute TTL
    const redis = new RedisStateStore({
      url: secrets.upstashRedisUrl,
      token: secrets.upstashRedisToken,
    });
    await redis.setOtp(email.toLowerCase(), code, 600);

    // Send OTP email via Resend
    const resend = new Resend(secrets.resendApiKey);
    await resend.emails.send({
      from: "HVAC Guardian <onboarding@resend.dev>",
      to: email,
      subject: "Your login code",
      text: `Your HVAC Guardian login code is: ${code}\n\nThis code expires in 10 minutes.`,
    });

    logger.info("OTP sent", { requestId, email: email.toLowerCase() });
    return jsonResponse({ status: "ok" });
  } catch (error) {
    logger.error("send-otp error", {
      requestId,
      error: error instanceof Error ? error.message : String(error),
    });
    return errorResponse("Internal server error", 500);
  }
}
