import { createDependencies } from "../handlers/dependencies.js";
import type { Dependencies } from "../handlers/dependencies.js";
import type { Logger } from "../utils/logger.js";
import { errorResponse } from "../utils/response.js";
import { resolveTenantFromSession, resolveTenantFromWebhook } from "./tenant.js";
import type { TenantContext } from "./tenant.js";

/**
 * Tie a request to a tenant, or say why it can't be.
 *
 * Every request is served for one tenant, and tenants live in the database.
 * There used to be a second mode, configured from APP_CONFIG with no database,
 * in which each route fell back to that config — with no authentication at
 * all. That fallback was copied into every handler. These two functions are
 * now the only way a handler gets its dependencies, and neither has one: a
 * missing database, a missing tenant or a failed check is a response, never a
 * default.
 */

function databaseMissing(logger: Logger, requestId: string): Response | null {
  if (process.env.DATABASE_URL) return null;
  logger.error("DATABASE_URL is not set", { requestId });
  return errorResponse("Database not configured", 503);
}

function forTenant(ctx: TenantContext, logger: Logger): Dependencies {
  return createDependencies(ctx.config, ctx.envSecrets, logger, {
    tenantId: ctx.tenantId,
    tenantSecrets: ctx.tenantSecrets,
  });
}

/**
 * For IFTTT webhooks and QStash callbacks, where the caller names the tenant.
 * Pass the request to have the tenant's webhook secret checked; QStash
 * callbacks omit it because their signature is checked by the handler.
 */
export async function dependenciesForTenant(
  tenantId: string | null | undefined,
  logger: Logger,
  requestId: string,
  request?: Request,
): Promise<Dependencies | Response> {
  const missing = databaseMissing(logger, requestId);
  if (missing) return missing;

  if (!tenantId) {
    logger.warn("Request names no tenant", { requestId });
    return errorResponse("Unknown tenant", 404);
  }

  const ctx = await resolveTenantFromWebhook(tenantId, request);
  if (!ctx) {
    logger.warn("Unknown or suspended tenant", { requestId, tenantId });
    return errorResponse("Unknown tenant", 404);
  }
  return forTenant(ctx, logger);
}

/** For the dashboard's endpoints, where the session cookie names the tenant. */
export async function dependenciesForSession(
  request: Request,
  logger: Logger,
  requestId: string,
): Promise<Dependencies | Response> {
  const missing = databaseMissing(logger, requestId);
  if (missing) return missing;

  const ctx = await resolveTenantFromSession(request);
  if (!ctx) return errorResponse("Unauthorized", 401);
  return forTenant(ctx, logger);
}
