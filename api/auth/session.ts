export const config = { runtime: "edge" };

import { loadEnvSecrets } from "../../src/config/index.js";
import { RedisStateStore } from "../../src/providers/redis/index.js";
import type { AuthStore } from "../../src/providers/types.js";
import { createLogger } from "../../src/utils/logger.js";
import type { Logger } from "../../src/utils/logger.js";
import { jsonResponse, errorResponse } from "../../src/utils/response.js";

function getSessionToken(request: Request): string | null {
  const cookie = request.headers.get("Cookie") ?? "";
  const match = cookie.match(/(?:^|;\s*)session=([^\s;]+)/);
  return match?.[1] ?? null;
}

export interface SessionDeps {
  authStore: AuthStore;
  logger: Logger;
}

export async function handleSession(request: Request, deps?: SessionDeps): Promise<Response> {
  const logger = deps?.logger ?? createLogger();
  const requestId = crypto.randomUUID().slice(0, 8);

  try {
    if (request.method !== "GET") {
      return errorResponse("Method not allowed", 405);
    }

    const token = getSessionToken(request);

    if (!token) {
      return jsonResponse({ authenticated: false });
    }

    const authStore =
      deps?.authStore ??
      (() => {
        const secrets = loadEnvSecrets();
        return new RedisStateStore({
          url: secrets.upstashRedisUrl,
          token: secrets.upstashRedisToken,
        });
      })();

    const email = await authStore.getSession(token);

    if (!email) {
      return jsonResponse({ authenticated: false });
    }

    logger.info("Session validated", { requestId, email });
    return jsonResponse({ authenticated: true, email });
  } catch (error) {
    logger.error("session check error", {
      requestId,
      error: error instanceof Error ? error.message : String(error),
    });
    return errorResponse("Internal server error", 500);
  }
}

export default async function handler(request: Request): Promise<Response> {
  return handleSession(request);
}
