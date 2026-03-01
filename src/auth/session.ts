import type { AuthStore } from "../providers/types.js";
import { getDb } from "../db/client.js";
import { getUserByEmail } from "../db/queries/users.js";
import { getTenantById } from "../db/queries/tenants.js";
import type { Database } from "../db/client.js";
import type { Logger } from "../utils/logger.js";

export interface SessionPayload {
  email: string;
  tenantId: string;
  userId: string;
  tenantStatus: "onboarding" | "active" | "suspended";
}

const SESSION_TTL = 7 * 24 * 60 * 60; // 7 days

/**
 * Create a session for the given email.
 * Looks up the user in the DB to get tenantId.
 * Stores JSON payload in Redis.
 */
export async function createSession(
  authStore: AuthStore,
  email: string,
  db?: Database,
  logger?: Logger,
): Promise<{ token: string; payload: SessionPayload } | null> {
  const database = db ?? getDb();
  const user = await getUserByEmail(database, email);
  if (!user) {
    logger?.warn("createSession: user not found", { email });
    return null;
  }

  const tenant = await getTenantById(database, user.tenantId);
  if (!tenant) {
    logger?.warn("createSession: tenant not found", { email, tenantId: user.tenantId });
    return null;
  }

  const payload: SessionPayload = {
    email: user.email,
    tenantId: user.tenantId,
    userId: user.id,
    tenantStatus: tenant.status,
  };

  const token = crypto.randomUUID();
  await authStore.setSession(token, JSON.stringify(payload), SESSION_TTL);

  return { token, payload };
}

/**
 * Get session payload from a session token.
 * Handles both old-format (plain email string) and new-format (JSON) sessions.
 */
export async function getSessionPayload(
  authStore: AuthStore,
  token: string,
  db?: Database,
): Promise<SessionPayload | null> {
  const raw = await authStore.getSession(token);
  if (!raw) return null;

  // Upstash Redis auto-deserializes JSON, so raw may already be an object
  const parsed: unknown =
    typeof raw === "object"
      ? raw
      : (() => {
          try {
            return JSON.parse(raw);
          } catch {
            return null;
          }
        })();

  if (parsed && typeof parsed === "object" && "tenantId" in parsed && "email" in parsed) {
    return parsed as SessionPayload;
  }

  // Backward compat: old sessions store just an email string.
  // Look up the user in DB to construct a full payload.
  if (typeof raw !== "string") return null;

  const database = db ?? getDb();
  const user = await getUserByEmail(database, raw);
  if (!user) return null;

  const tenant = await getTenantById(database, user.tenantId);
  if (!tenant) return null;

  return {
    email: user.email,
    tenantId: user.tenantId,
    userId: user.id,
    tenantStatus: tenant.status,
  };
}

export function getSessionToken(request: Request): string | null {
  const cookie = request.headers.get("Cookie") ?? "";
  const match = cookie.match(/(?:^|;\s*)session=([^\s;]+)/);
  return match?.[1] ?? null;
}
