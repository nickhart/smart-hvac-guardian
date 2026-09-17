import { describe, it, expect, vi } from "vitest";
import { handleHealth } from "../../api/health";
import type { HealthReport } from "../../api/health";
import type { Logger } from "@/utils/logger";

const logger: Logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };

function makeRequest(): Request {
  return new Request("https://example.com/api/health");
}

describe("health handler", () => {
  it("reports ok when every dependency is reachable", async () => {
    const res = await handleHealth(makeRequest(), {
      logger,
      checkRedis: vi.fn().mockResolvedValue(undefined),
      loadSecrets: () => ({ tinybirdToken: "tb", resendApiKey: "re" }),
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as HealthReport;
    expect(body.status).toBe("ok");
    expect(body.checks).toMatchObject({
      config: "ok",
      redis: "ok",
      analytics: "ok",
      email: "ok",
    });
  });

  it("returns 503 when Redis is unreachable", async () => {
    const res = await handleHealth(makeRequest(), {
      logger,
      checkRedis: vi.fn().mockRejectedValue(new Error("connect ECONNREFUSED")),
      loadSecrets: () => ({ tinybirdToken: "tb", resendApiKey: "re" }),
    });

    expect(res.status).toBe(503);
    const body = (await res.json()) as HealthReport;
    expect(body.status).toBe("degraded");
    expect(body.checks.redis).toBe("fail");
  });

  it("reports unconfigured optional services without failing", async () => {
    const res = await handleHealth(makeRequest(), {
      logger,
      checkRedis: vi.fn().mockResolvedValue(undefined),
      loadSecrets: () => ({}),
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as HealthReport;
    expect(body.checks.analytics).toBe("not_configured");
    expect(body.checks.email).toBe("not_configured");
  });

  it("returns 503 and skips further checks when config fails to load", async () => {
    const checkRedis = vi.fn();
    const res = await handleHealth(makeRequest(), {
      logger,
      checkRedis,
      loadSecrets: () => {
        throw new Error("APP_CONFIG missing");
      },
    });

    expect(res.status).toBe(503);
    const body = (await res.json()) as HealthReport;
    expect(body.checks.config).toBe("fail");
    expect(checkRedis).not.toHaveBeenCalled();
  });

  it("never leaks credentials or error detail in the response body", async () => {
    const res = await handleHealth(makeRequest(), {
      logger,
      checkRedis: vi.fn().mockRejectedValue(new Error("auth failed for token sk_secret_abc")),
      loadSecrets: () => ({ tinybirdToken: "tb_secret_xyz", resendApiKey: "re_secret_123" }),
    });

    const raw = await res.text();
    expect(raw).not.toContain("sk_secret_abc");
    expect(raw).not.toContain("tb_secret_xyz");
    expect(raw).not.toContain("re_secret_123");
  });
});
