import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("@/middleware/tenant", () => ({
  resolveTenantFromWebhook: vi.fn(),
  resolveTenantFromSession: vi.fn(),
}));
vi.mock("@/handlers/dependencies", () => ({
  createDependencies: vi.fn((config, envSecrets, logger, options) => ({
    config,
    logger,
    tenantId: options?.tenantId,
  })),
}));

import { dependenciesForSession, dependenciesForTenant } from "@/middleware/resolve-dependencies";
import { resolveTenantFromSession, resolveTenantFromWebhook } from "@/middleware/tenant";
import type { TenantContext } from "@/middleware/tenant";
import type { Logger } from "@/utils/logger";

const logger: Logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };

const ctx = {
  tenantId: "tenant-1",
  config: { zones: {} },
  envSecrets: {},
  tenantSecrets: { webhookSecret: "s" },
} as unknown as TenantContext;

const request = new Request("https://example.com/api/t/tenant-1/sensor-event", { method: "POST" });

beforeEach(() => {
  vi.stubEnv("DATABASE_URL", "postgres://example");
  vi.mocked(resolveTenantFromWebhook).mockReset();
  vi.mocked(resolveTenantFromSession).mockReset();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

/**
 * There used to be a mode with no database, in which every route ran from
 * APP_CONFIG with no authentication. Its absence is what these tests pin down:
 * nothing here falls back to anything.
 */
describe("dependenciesForTenant", () => {
  it("builds the tenant's dependencies when the tenant checks out", async () => {
    vi.mocked(resolveTenantFromWebhook).mockResolvedValue(ctx);

    const d = await dependenciesForTenant("tenant-1", logger, "r1", request);

    expect(d).not.toBeInstanceOf(Response);
    expect(d).toMatchObject({ tenantId: "tenant-1" });
    // The request is passed on so the webhook secret gets checked.
    expect(resolveTenantFromWebhook).toHaveBeenCalledWith("tenant-1", request);
  });

  it("refuses with 503 when there is no database, without looking anything up", async () => {
    vi.stubEnv("DATABASE_URL", "");

    const d = await dependenciesForTenant("tenant-1", logger, "r1", request);

    expect(d).toBeInstanceOf(Response);
    expect((d as Response).status).toBe(503);
    expect(resolveTenantFromWebhook).not.toHaveBeenCalled();
  });

  // The old URLs without a tenant — /api/sensor-event — ran against APP_CONFIG.
  it("refuses with 404 when the request names no tenant", async () => {
    const d = await dependenciesForTenant(null, logger, "r1", request);

    expect((d as Response).status).toBe(404);
    expect(resolveTenantFromWebhook).not.toHaveBeenCalled();
  });

  it("refuses with 404 for an unknown tenant or a wrong secret", async () => {
    vi.mocked(resolveTenantFromWebhook).mockResolvedValue(null);

    const d = await dependenciesForTenant("tenant-1", logger, "r1", request);

    expect((d as Response).status).toBe(404);
  });
});

describe("dependenciesForSession", () => {
  it("builds the dependencies of the session's tenant", async () => {
    vi.mocked(resolveTenantFromSession).mockResolvedValue(ctx);

    const d = await dependenciesForSession(request, logger, "r1");

    expect(d).toMatchObject({ tenantId: "tenant-1" });
  });

  it("refuses with 401 without a valid session", async () => {
    vi.mocked(resolveTenantFromSession).mockResolvedValue(null);

    const d = await dependenciesForSession(request, logger, "r1");

    expect((d as Response).status).toBe(401);
  });

  it("refuses with 503 when there is no database", async () => {
    vi.stubEnv("DATABASE_URL", "");

    const d = await dependenciesForSession(request, logger, "r1");

    expect((d as Response).status).toBe(503);
    expect(resolveTenantFromSession).not.toHaveBeenCalled();
  });
});
