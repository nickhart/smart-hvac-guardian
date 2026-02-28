import { getDb } from "../db/client.js";
import { getTenantById } from "../db/queries/tenants.js";
import { getTenantConfig } from "../db/queries/config.js";
import { getTenantSecrets } from "../db/queries/secrets.js";
import type { TenantSecretsPlain } from "../db/queries/secrets.js";
import { getSessionPayload, getSessionToken } from "../auth/session.js";
import { RedisStateStore } from "../providers/redis/client.js";
import { loadEnvSecrets } from "../config/index.js";
import { timingSafeEqual } from "../utils/crypto.js";
import type { AppConfig, EnvSecrets } from "../config/index.js";
import type { Database } from "../db/client.js";

export interface TenantContext {
  tenantId: string;
  config: AppConfig;
  tenantSecrets: TenantSecretsPlain;
  envSecrets: EnvSecrets;
}

/**
 * Resolve tenant from the authenticated session cookie.
 * Used for browser-initiated requests (dashboard, toggle, delays).
 */
export async function resolveTenantFromSession(
  request: Request,
  db?: Database,
): Promise<TenantContext | null> {
  const envSecrets = loadEnvSecrets();
  const database = db ?? getDb();
  const authStore = new RedisStateStore({
    url: envSecrets.upstashRedisUrl,
    token: envSecrets.upstashRedisToken,
  });

  const token = getSessionToken(request);
  if (!token) return null;

  const session = await getSessionPayload(authStore, token, database);
  if (!session) return null;

  return resolveTenantById(session.tenantId, envSecrets, database);
}

/**
 * Resolve tenant from a tenantId (e.g. from URL path or QStash payload).
 * Used for webhook endpoints. Validates Bearer token or ?secret= query param.
 */
export async function resolveTenantFromWebhook(
  tenantId: string,
  request?: Request,
  db?: Database,
): Promise<TenantContext | null> {
  const envSecrets = loadEnvSecrets();
  const database = db ?? getDb();
  const ctx = await resolveTenantById(tenantId, envSecrets, database);
  if (!ctx) return null;

  // Validate webhook secret if one is configured
  if (ctx.tenantSecrets.webhookSecret && request) {
    const token = extractBearerToken(request);
    if (!token || !timingSafeEqual(token, ctx.tenantSecrets.webhookSecret)) {
      return null;
    }
  }

  return ctx;
}

/**
 * Extract bearer token from Authorization header or ?secret= query param.
 */
function extractBearerToken(request: Request): string | null {
  // Check Authorization header first
  const authHeader = request.headers.get("authorization");
  if (authHeader) {
    const match = authHeader.match(/^Bearer\s+(.+)$/i);
    if (match) return match[1];
  }

  // Fallback to ?secret= query param
  try {
    const url = new URL(request.url);
    const secret = url.searchParams.get("secret");
    if (secret) return secret;
  } catch {
    // Invalid URL, ignore
  }

  return null;
}

async function resolveTenantById(
  tenantId: string,
  envSecrets: EnvSecrets,
  db: Database,
): Promise<TenantContext | null> {
  const tenant = await getTenantById(db, tenantId);
  if (!tenant || tenant.status === "suspended") return null;

  const config = await getTenantConfig(db, tenantId);
  if (!config) return null;

  const secrets = await getTenantSecrets(db, tenantId);
  if (!secrets) return null;

  return { tenantId, config, tenantSecrets: secrets, envSecrets };
}
