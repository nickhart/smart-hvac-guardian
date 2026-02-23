import { describe, it, expect, vi } from "vitest";
import { handleVerifyOtp, type VerifyOtpDeps } from "../../../api/auth/verify-otp";
import type { Logger } from "@/utils/logger";
import type { EnvSecrets } from "@/config/schema";

const mockLogger: Logger = {
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
};

const mockSecrets: EnvSecrets = {
  yolinkUaCid: "ua-cid",
  yolinkSecretKey: "secret-key",
  iftttWebhookKey: "ifttt-key",
  qstashToken: "qstash-token",
  qstashCurrentSigningKey: "current-key",
  qstashNextSigningKey: "next-key",
  upstashRedisUrl: "https://redis.upstash.io",
  upstashRedisToken: "redis-token",
  resendApiKey: "re_test_123",
  ownerEmail: "owner@example.com",
};

function createDeps(overrides?: Partial<VerifyOtpDeps>): VerifyOtpDeps {
  return {
    secrets: mockSecrets,
    authStore: {
      setOtp: vi.fn(),
      getOtp: vi.fn().mockResolvedValue("123456"),
      deleteOtp: vi.fn().mockResolvedValue(undefined),
      setSession: vi.fn().mockResolvedValue(undefined),
      getSession: vi.fn(),
      deleteSession: vi.fn(),
    },
    logger: mockLogger,
    ...overrides,
  };
}

function makeRequest(body: unknown, method = "POST"): Request {
  return new Request("https://example.com/api/auth/verify-otp", {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("verify-otp handler", () => {
  it("returns 405 for non-POST", async () => {
    const req = new Request("https://example.com/api/auth/verify-otp", { method: "GET" });
    const res = await handleVerifyOtp(req, createDeps());
    expect(res.status).toBe(405);
  });

  it("returns 503 when auth is not configured", async () => {
    const deps = createDeps({
      secrets: { ...mockSecrets, resendApiKey: undefined, ownerEmail: undefined },
    });
    const res = await handleVerifyOtp(
      makeRequest({ email: "owner@example.com", code: "123456" }),
      deps,
    );
    expect(res.status).toBe(503);
  });

  it("returns 400 for invalid payload", async () => {
    const res = await handleVerifyOtp(makeRequest({ bad: "data" }), createDeps());
    expect(res.status).toBe(400);
  });

  it("returns 401 for wrong email", async () => {
    const res = await handleVerifyOtp(
      makeRequest({ email: "stranger@example.com", code: "123456" }),
      createDeps(),
    );
    expect(res.status).toBe(401);
  });

  it("returns 401 for wrong code", async () => {
    const deps = createDeps({
      authStore: {
        setOtp: vi.fn(),
        getOtp: vi.fn().mockResolvedValue("654321"),
        deleteOtp: vi.fn(),
        setSession: vi.fn(),
        getSession: vi.fn(),
        deleteSession: vi.fn(),
      },
    });
    const res = await handleVerifyOtp(
      makeRequest({ email: "owner@example.com", code: "123456" }),
      deps,
    );
    expect(res.status).toBe(401);
  });

  it("returns 401 when OTP is expired/missing", async () => {
    const deps = createDeps({
      authStore: {
        setOtp: vi.fn(),
        getOtp: vi.fn().mockResolvedValue(null),
        deleteOtp: vi.fn(),
        setSession: vi.fn(),
        getSession: vi.fn(),
        deleteSession: vi.fn(),
      },
    });
    const res = await handleVerifyOtp(
      makeRequest({ email: "owner@example.com", code: "123456" }),
      deps,
    );
    expect(res.status).toBe(401);
  });

  it("creates session and sets cookie on valid OTP", async () => {
    const deps = createDeps();
    const res = await handleVerifyOtp(
      makeRequest({ email: "owner@example.com", code: "123456" }),
      deps,
    );
    const body = (await res.json()) as Record<string, unknown>;

    expect(res.status).toBe(200);
    expect(body.authenticated).toBe(true);
    expect(deps.authStore.deleteOtp).toHaveBeenCalledWith("owner@example.com");
    expect(deps.authStore.setSession).toHaveBeenCalledWith(
      expect.any(String),
      "owner@example.com",
      604800,
    );
    expect(res.headers.get("Set-Cookie")).toContain("session=");
  });

  it("returns 500 on authStore failure", async () => {
    const deps = createDeps({
      authStore: {
        setOtp: vi.fn(),
        getOtp: vi.fn().mockRejectedValue(new Error("Redis down")),
        deleteOtp: vi.fn(),
        setSession: vi.fn(),
        getSession: vi.fn(),
        deleteSession: vi.fn(),
      },
    });
    const res = await handleVerifyOtp(
      makeRequest({ email: "owner@example.com", code: "123456" }),
      deps,
    );
    expect(res.status).toBe(500);
  });
});
