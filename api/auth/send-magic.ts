export const config = { runtime: "edge" };

import { z } from "zod";
import { Resend } from "resend";
import { loadEnvSecrets } from "../../src/config/index.js";
import type { EnvSecrets } from "../../src/config/index.js";
import { RedisStateStore } from "../../src/providers/redis/index.js";
import type { AuthStore } from "../../src/providers/types.js";
import { createLogger } from "../../src/utils/logger.js";
import type { Logger } from "../../src/utils/logger.js";
import { jsonResponse, errorResponse } from "../../src/utils/response.js";

const SendMagicPayload = z.object({
  email: z.string().email(),
});

export interface SendMagicDeps {
  secrets: EnvSecrets;
  authStore: AuthStore;
  logger: Logger;
  sendEmail: (to: string, subject: string, text: string) => Promise<void>;
}

function resolveAppUrl(secrets: EnvSecrets): string {
  if (secrets.appUrl) return secrets.appUrl;
  const vercelUrl = process.env.VERCEL_URL;
  if (vercelUrl) return `https://${vercelUrl}`;
  return "http://localhost:3000";
}

export async function handleSendMagic(request: Request, deps?: SendMagicDeps): Promise<Response> {
  const logger = deps?.logger ?? createLogger();
  const requestId = crypto.randomUUID().slice(0, 8);

  try {
    if (request.method !== "POST") {
      return errorResponse("Method not allowed", 405);
    }

    const secrets = deps?.secrets ?? loadEnvSecrets();

    if (!secrets.resendApiKey || !secrets.ownerEmail) {
      logger.error("Auth not configured", { requestId });
      return errorResponse("Auth not configured", 503);
    }

    const body = await request.json().catch(() => null);
    const parsed = SendMagicPayload.safeParse(body);

    if (!parsed.success) {
      return errorResponse("Invalid payload", 400);
    }

    const { email } = parsed.data;

    if (email.toLowerCase() !== secrets.ownerEmail.toLowerCase()) {
      logger.warn("Unauthorized email attempt", { requestId, email });
      // Return success to avoid email enumeration
      return jsonResponse({ status: "ok" });
    }

    const token = crypto.randomUUID();

    const authStore =
      deps?.authStore ??
      new RedisStateStore({
        url: secrets.upstashRedisUrl,
        token: secrets.upstashRedisToken,
      });
    await authStore.setMagicToken(token, email.toLowerCase(), 600);

    const appUrl = resolveAppUrl(secrets);
    const magicLink = `${appUrl}/api/auth/magic?token=${token}`;

    const sendEmail =
      deps?.sendEmail ??
      (async (to: string, subject: string, text: string) => {
        const resend = new Resend(secrets.resendApiKey);
        await resend.emails.send({
          from: "HVAC Guardian <onboarding@resend.dev>",
          to,
          subject,
          text,
        });
      });

    await sendEmail(
      email,
      "Your login link",
      `Click the link below to log in to HVAC Guardian:\n\n${magicLink}\n\nThis link expires in 10 minutes.`,
    );

    logger.info("Magic link sent", { requestId, email: email.toLowerCase() });
    return jsonResponse({ status: "ok" });
  } catch (error) {
    logger.error("send-magic error", {
      requestId,
      error: error instanceof Error ? error.message : String(error),
    });
    return errorResponse("Internal server error", 500);
  }
}

export default async function handler(request: Request): Promise<Response> {
  return handleSendMagic(request);
}
