export const config = { runtime: "edge" };

import { z } from "zod";
import { getDb } from "../../src/db/client.js";
import { createTenant, getTenantBySlug } from "../../src/db/queries/tenants.js";
import { createUser, getUserByEmail } from "../../src/db/queries/users.js";
import { RedisStateStore } from "../../src/providers/redis/index.js";
import { loadEnvSecrets } from "../../src/config/index.js";
import { createLogger } from "../../src/utils/logger.js";
import { jsonResponse, errorResponse } from "../../src/utils/response.js";

const StartPayload = z.object({
  email: z.string().email(),
  propertyName: z.string().min(1).max(100),
});

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 50);
}

export default async function handler(request: Request): Promise<Response> {
  const logger = createLogger();
  const requestId = crypto.randomUUID().slice(0, 8);

  try {
    if (request.method !== "POST") {
      return errorResponse("Method not allowed", 405);
    }

    const body = await request.json().catch(() => null);
    const parsed = StartPayload.safeParse(body);

    if (!parsed.success) {
      return errorResponse("Invalid payload", 400);
    }

    const { email, propertyName } = parsed.data;
    const db = getDb();

    // Check if user already exists
    const existingUser = await getUserByEmail(db, email);
    if (existingUser) {
      // User already has a tenant — send magic link instead
      return jsonResponse({ status: "existing_user", message: "Check your email to log in." });
    }

    // Generate unique slug
    let slug = slugify(propertyName);
    let suffix = 0;
    while (await getTenantBySlug(db, slug + (suffix ? `-${suffix}` : ""))) {
      suffix++;
    }
    if (suffix) slug = `${slug}-${suffix}`;

    // Create tenant and user
    const tenant = await createTenant(db, { name: propertyName, slug });
    await createUser(db, { email, tenantId: tenant.id, role: "owner" });

    // Send magic link
    const secrets = loadEnvSecrets();
    if (secrets.resendApiKey) {
      const authStore = new RedisStateStore({
        url: secrets.upstashRedisUrl,
        token: secrets.upstashRedisToken,
      });

      const token = crypto.randomUUID();
      await authStore.setMagicToken(token, email.toLowerCase(), 600);

      const appUrl =
        secrets.appUrl ||
        (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "http://localhost:3000");
      const magicLink = `${appUrl}/api/auth/magic?token=${token}`;

      const { Resend } = await import("resend");
      const resend = new Resend(secrets.resendApiKey);
      const siteName = secrets.siteName ?? "HVAC Guardian";
      await resend.emails.send({
        from: `${siteName} <onboarding@resend.dev>`,
        to: email,
        subject: "Complete your setup",
        text: `Welcome to ${siteName}! Click the link below to continue setting up "${propertyName}":\n\n${magicLink}\n\nThis link expires in 10 minutes.`,
      });
    }

    logger.info("Onboarding started", { requestId, email, tenantId: tenant.id, slug });

    return jsonResponse({
      status: "ok",
      tenantId: tenant.id,
      slug,
      message: "Check your email to continue setup.",
    });
  } catch (error) {
    logger.error("onboarding start error", {
      requestId,
      error: error instanceof Error ? error.message : String(error),
    });
    return errorResponse("Internal server error", 500);
  }
}
