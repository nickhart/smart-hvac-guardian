export const config = { runtime: "edge" };

import { z } from "zod";
import { loadEnvSecrets } from "../../src/config/index.js";
import type { EnvSecrets } from "../../src/config/index.js";
import { RedisStateStore } from "../../src/providers/redis/index.js";
import type { AuthStore } from "../../src/providers/types.js";
import { createLogger } from "../../src/utils/logger.js";
import type { Logger } from "../../src/utils/logger.js";
import { errorResponse } from "../../src/utils/response.js";

const MagicQuery = z.object({
  token: z.string().uuid(),
});

const SESSION_TTL = 7 * 24 * 60 * 60; // 7 days

export interface MagicDeps {
  secrets: EnvSecrets;
  authStore: AuthStore;
  logger: Logger;
}

function htmlPage(title: string, body: string): Response {
  return new Response(
    `<!DOCTYPE html><html><head><title>${title}</title></head><body style="font-family:sans-serif;display:flex;justify-content:center;align-items:center;min-height:100vh;margin:0"><div style="text-align:center"><h1>${title}</h1><p>${body}</p></div></body></html>`,
    { status: 400, headers: { "Content-Type": "text/html; charset=utf-8" } },
  );
}

export async function handleMagic(request: Request, deps?: MagicDeps): Promise<Response> {
  const logger = deps?.logger ?? createLogger();
  const requestId = crypto.randomUUID().slice(0, 8);

  try {
    if (request.method !== "GET") {
      return errorResponse("Method not allowed", 405);
    }

    let tokenParam: string | null = null;
    try {
      const url = new URL(request.url, "http://localhost");
      tokenParam = url.searchParams.get("token");
    } catch {
      // URL parsing failed
    }
    const parsed = MagicQuery.safeParse({ token: tokenParam });

    if (!parsed.success) {
      return htmlPage("Invalid link", "This login link is invalid. Please request a new one.");
    }

    const { token } = parsed.data;

    const secrets = deps?.secrets ?? loadEnvSecrets();
    const authStore =
      deps?.authStore ??
      new RedisStateStore({
        url: secrets.upstashRedisUrl,
        token: secrets.upstashRedisToken,
      });

    const email = await authStore.getMagicToken(token);

    if (!email) {
      return htmlPage(
        "Link expired",
        "This login link has expired or already been used. Please request a new one.",
      );
    }

    // Single-use: delete the magic token
    await authStore.deleteMagicToken(token);

    // Create session
    const sessionToken = crypto.randomUUID();
    await authStore.setSession(sessionToken, email, SESSION_TTL);

    logger.info("Magic link login", { requestId, email });

    return new Response(null, {
      status: 302,
      headers: {
        Location: "/",
        "Set-Cookie": `session=${sessionToken}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_TTL}; Secure`,
      },
    });
  } catch (error) {
    logger.error("magic error", {
      requestId,
      error: error instanceof Error ? error.message : String(error),
    });
    return errorResponse("Internal server error", 500);
  }
}

export default async function handler(request: Request): Promise<Response> {
  return handleMagic(request);
}
