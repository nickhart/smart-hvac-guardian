export const config = { runtime: "edge" };

import { z } from "zod";
import { loadEnvSecrets } from "../../src/config/index.js";
import type { EnvSecrets } from "../../src/config/index.js";
import { RedisStateStore } from "../../src/providers/redis/index.js";
import type { AuthStore } from "../../src/providers/types.js";
import { getDb } from "../../src/db/client.js";
import { getUserByEmail } from "../../src/db/queries/users.js";
import type { Database } from "../../src/db/client.js";
import { createLogger } from "../../src/utils/logger.js";
import type { Logger } from "../../src/utils/logger.js";
import { jsonResponse, errorResponse } from "../../src/utils/response.js";
import { createResendSender, emailStatus } from "../../src/utils/email.js";

const SendMagicPayload = z.object({
  email: z.string().email(),
});

export interface SendMagicDeps {
  secrets: EnvSecrets;
  authStore: AuthStore;
  logger: Logger;
  db?: Database;
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

    // Sign-in is email-only, so without a way to send there is no sign-in.
    // Refusing here names the problem; sending anyway would surface as a
    // Resend rejection on a link the user never receives.
    if (emailStatus(secrets) !== "ok") {
      logger.error("Auth not configured: RESEND_API_KEY and EMAIL_FROM are both required", {
        requestId,
      });
      return errorResponse("Auth not configured", 503);
    }

    const body = await request.json().catch(() => null);
    const parsed = SendMagicPayload.safeParse(body);

    if (!parsed.success) {
      return errorResponse("Invalid payload", 400);
    }

    const { email } = parsed.data;

    // Users live in the database; there is no other list of who may sign in.
    const db = deps?.db ?? (process.env.DATABASE_URL ? getDb() : undefined);
    if (!db) {
      logger.error("DATABASE_URL is not set", { requestId });
      return errorResponse("Database not configured", 503);
    }

    const user = await getUserByEmail(db, email);
    if (!user) {
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

    const siteName = secrets.siteName ?? "HVAC Guardian";

    const sendEmail = deps?.sendEmail ?? createResendSender(secrets);

    await sendEmail(
      email,
      "Your login link",
      `Click the link below to log in to ${siteName}:\n\n${magicLink}\n\nThis link expires in 10 minutes.`,
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
