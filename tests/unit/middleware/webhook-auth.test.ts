import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock all DB/config dependencies before importing the module under test
vi.mock("@/db/client", () => ({ getDb: vi.fn() }));
vi.mock("@/db/queries/tenants", () => ({
  getTenantById: vi.fn(),
}));
vi.mock("@/db/queries/config", () => ({
  getTenantConfig: vi.fn(),
}));
vi.mock("@/db/queries/secrets", () => ({
  getTenantSecrets: vi.fn(),
}));
vi.mock("@/config/index", () => ({
  loadEnvSecrets: vi.fn(() => ({
    upstashRedisUrl: "https://fake",
    upstashRedisToken: "fake-token",
    qstashToken: "fake",
    qstashSigningKey: "fake",
    qstashNextSigningKey: "fake",
    appUrl: "https://test.example.com",
  })),
}));

import { resolveTenantFromWebhook } from "@/middleware/tenant";
import { getTenantById } from "@/db/queries/tenants";
import { getTenantConfig } from "@/db/queries/config";
import { getTenantSecrets } from "@/db/queries/secrets";

const TENANT_ID = "00000000-0000-0000-0000-000000000001";
const WEBHOOK_SECRET = "a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2";

const mockTenant = { id: TENANT_ID, name: "Test", slug: "test", status: "active" };
const mockConfig = { zones: {}, sensorDelays: {}, hvacUnits: {} };
const mockSecrets = {
  yolinkUaCid: "cid",
  yolinkSecretKey: "sk",
  iftttWebhookKey: "ifttt",
  webhookSecret: WEBHOOK_SECRET,
};

function makeRequest(url: string, headers?: Record<string, string>): Request {
  return new Request(url, { method: "POST", headers });
}

describe("resolveTenantFromWebhook auth", () => {
  beforeEach(() => {
    vi.mocked(getTenantById).mockResolvedValue(mockTenant as never);
    vi.mocked(getTenantConfig).mockResolvedValue(mockConfig as never);
    vi.mocked(getTenantSecrets).mockResolvedValue(mockSecrets as never);
  });

  it("allows request with valid Bearer header", async () => {
    const req = makeRequest(`https://test.example.com/api/t/${TENANT_ID}/sensor-event`, {
      Authorization: `Bearer ${WEBHOOK_SECRET}`,
    });
    const ctx = await resolveTenantFromWebhook(TENANT_ID, req, {} as never);
    expect(ctx).not.toBeNull();
    expect(ctx!.tenantId).toBe(TENANT_ID);
  });

  it("allows request with valid ?secret= query param", async () => {
    const req = makeRequest(
      `https://test.example.com/api/t/${TENANT_ID}/sensor-event?secret=${WEBHOOK_SECRET}`,
    );
    const ctx = await resolveTenantFromWebhook(TENANT_ID, req, {} as never);
    expect(ctx).not.toBeNull();
    expect(ctx!.tenantId).toBe(TENANT_ID);
  });

  it("rejects request with wrong Bearer token", async () => {
    const req = makeRequest(`https://test.example.com/api/t/${TENANT_ID}/sensor-event`, {
      Authorization: "Bearer wrong-token",
    });
    const ctx = await resolveTenantFromWebhook(TENANT_ID, req, {} as never);
    expect(ctx).toBeNull();
  });

  it("rejects request with no auth when webhook secret is configured", async () => {
    const req = makeRequest(`https://test.example.com/api/t/${TENANT_ID}/sensor-event`);
    const ctx = await resolveTenantFromWebhook(TENANT_ID, req, {} as never);
    expect(ctx).toBeNull();
  });

  it("allows request without auth when no webhook secret is configured (backward compat)", async () => {
    vi.mocked(getTenantSecrets).mockResolvedValue({
      yolinkUaCid: "cid",
      yolinkSecretKey: "sk",
      iftttWebhookKey: "ifttt",
      // no webhookSecret
    } as never);

    const req = makeRequest(`https://test.example.com/api/t/${TENANT_ID}/sensor-event`);
    const ctx = await resolveTenantFromWebhook(TENANT_ID, req, {} as never);
    expect(ctx).not.toBeNull();
  });

  it("allows request without request object (QStash-signed path)", async () => {
    const ctx = await resolveTenantFromWebhook(TENANT_ID, undefined, {} as never);
    expect(ctx).not.toBeNull();
  });

  it("prefers Authorization header over query param", async () => {
    const req = makeRequest(
      `https://test.example.com/api/t/${TENANT_ID}/sensor-event?secret=wrong-in-query`,
      { Authorization: `Bearer ${WEBHOOK_SECRET}` },
    );
    const ctx = await resolveTenantFromWebhook(TENANT_ID, req, {} as never);
    expect(ctx).not.toBeNull();
  });

  it("rejects request with Authorization header that is not Bearer scheme", async () => {
    const req = makeRequest(`https://test.example.com/api/t/${TENANT_ID}/sensor-event`, {
      Authorization: `Basic ${WEBHOOK_SECRET}`,
    });
    const ctx = await resolveTenantFromWebhook(TENANT_ID, req, {} as never);
    expect(ctx).toBeNull();
  });

  it("is case-insensitive for Bearer scheme", async () => {
    const req = makeRequest(`https://test.example.com/api/t/${TENANT_ID}/sensor-event`, {
      Authorization: `bearer ${WEBHOOK_SECRET}`,
    });
    const ctx = await resolveTenantFromWebhook(TENANT_ID, req, {} as never);
    expect(ctx).not.toBeNull();
  });
});
