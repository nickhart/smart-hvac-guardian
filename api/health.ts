export const config = { runtime: "edge" };

import { loadEnvSecrets } from "../src/config/index.js";
import { RedisStateStore } from "../src/providers/redis/index.js";
import { createLogger } from "../src/utils/logger.js";
import type { Logger } from "../src/utils/logger.js";
import { jsonResponse } from "../src/utils/response.js";

export type CheckStatus = "ok" | "fail" | "not_configured";

export interface HealthDeps {
  logger?: Logger;
  checkRedis?: () => Promise<void>;
  loadSecrets?: () => { tinybirdToken?: string; resendApiKey?: string };
}

export interface HealthReport {
  status: "ok" | "degraded";
  checks: Record<string, CheckStatus>;
  durationMs: number;
}

/**
 * Liveness/readiness probe for an external uptime monitor. Deliberately
 * unauthenticated so it can be polled while auth is broken — which is exactly
 * when it matters — so it reports only per-check status, never config values,
 * credentials, or error details that would be useful to an attacker.
 *
 * Redis is the only hard dependency: without it no timer state can be read or
 * written. Analytics being unconfigured is reported but is not a failure.
 */
export async function handleHealth(_request: Request, deps?: HealthDeps): Promise<Response> {
  const logger = deps?.logger ?? createLogger();
  const started = Date.now();
  const checks: Record<string, CheckStatus> = {};

  // Config must parse before anything else can be checked.
  let secrets: { tinybirdToken?: string; resendApiKey?: string } | null = null;
  try {
    secrets = deps?.loadSecrets ? deps.loadSecrets() : loadEnvSecrets();
    checks.config = "ok";
  } catch (error) {
    checks.config = "fail";
    logger.error("Health: config failed to load", {
      error: error instanceof Error ? error.message : String(error),
    });
  }

  if (secrets) {
    try {
      if (deps?.checkRedis) {
        await deps.checkRedis();
      } else {
        const envSecrets = loadEnvSecrets();
        const store = new RedisStateStore({
          url: envSecrets.upstashRedisUrl,
          token: envSecrets.upstashRedisToken,
        });
        await store.ping();
      }
      checks.redis = "ok";
    } catch (error) {
      checks.redis = "fail";
      logger.error("Health: Redis unreachable", {
        error: error instanceof Error ? error.message : String(error),
      });
    }

    checks.analytics = secrets.tinybirdToken ? "ok" : "not_configured";
    checks.email = secrets.resendApiKey ? "ok" : "not_configured";
  }

  const healthy = !Object.values(checks).includes("fail");
  const report: HealthReport = {
    status: healthy ? "ok" : "degraded",
    checks,
    durationMs: Date.now() - started,
  };

  // Non-200 so uptime monitors alert without needing to parse the body.
  return jsonResponse(report, healthy ? 200 : 503);
}

export default async function handler(request: Request): Promise<Response> {
  return handleHealth(request);
}
