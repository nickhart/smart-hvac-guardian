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
 *
 * With a request — an IFTTT webhook — the tenant's webhook secret must arrive
 * as `Authorization: Bearer <secret>`. It is required: activation always
 * creates one, so a tenant without it is broken rather than old, and letting it
 * through would make the tenant ID alone enough to post events. Without a
 * request — a QStash callback — the caller checks the QStash signature instead.
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

  if (request) {
    const expected = ctx.tenantSecrets.webhookSecret;
    const token = extractBearerToken(request);
    if (!expected || !token || !timingSafeEqual(token, expected)) {
      return null;
    }
  }

  return ctx;
}

/**
 * The secret from `Authorization: Bearer <secret>`. Only the header: a secret
 * in the URL (`?secret=` used to be accepted) ends up in request logs.
 */
function extractBearerToken(request: Request): string | null {
  const authHeader = request.headers.get("authorization");
  const match = authHeader?.match(/^Bearer\s+(.+)$/i);
  return match ? match[1] : null;
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
