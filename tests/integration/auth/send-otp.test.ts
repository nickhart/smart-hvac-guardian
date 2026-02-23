import { describe, it, expect, vi } from "vitest";
import { handleSendOtp, type SendOtpDeps } from "../../../api/auth/send-otp";
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

function createDeps(overrides?: Partial<SendOtpDeps>): SendOtpDeps {
  return {
    secrets: mockSecrets,
    authStore: {
      setOtp: vi.fn().mockResolvedValue(undefined),
      getOtp: vi.fn(),
      deleteOtp: vi.fn(),
      setSession: vi.fn(),
      getSession: vi.fn(),
      deleteSession: vi.fn(),
    },
    logger: mockLogger,
    sendEmail: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

function makeRequest(body: unknown, method = "POST"): Request {
  return new Request("https://example.com/api/auth/send-otp", {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("send-otp handler", () => {
  it("returns 405 for non-POST", async () => {
    const req = new Request("https://example.com/api/auth/send-otp", { method: "GET" });
    const res = await handleSendOtp(req, createDeps());
    expect(res.status).toBe(405);
  });

  it("returns 503 when auth is not configured", async () => {
    const deps = createDeps({
      secrets: { ...mockSecrets, resendApiKey: undefined, ownerEmail: undefined },
    });
    const res = await handleSendOtp(makeRequest({ email: "test@example.com" }), deps);
    expect(res.status).toBe(503);
  });

  it("returns 400 for invalid payload", async () => {
    const res = await handleSendOtp(makeRequest({ bad: "data" }), createDeps());
    expect(res.status).toBe(400);
  });

  it("returns ok for unauthorized email without sending OTP", async () => {
    const deps = createDeps();
    const res = await handleSendOtp(makeRequest({ email: "stranger@example.com" }), deps);
    const body = (await res.json()) as Record<string, unknown>;

    expect(res.status).toBe(200);
    expect(body.status).toBe("ok");
    expect(deps.authStore.setOtp).not.toHaveBeenCalled();
    expect(deps.sendEmail).not.toHaveBeenCalled();
  });

  it("stores OTP and sends email for authorized email", async () => {
    const deps = createDeps();
    const res = await handleSendOtp(makeRequest({ email: "owner@example.com" }), deps);
    const body = (await res.json()) as Record<string, unknown>;

    expect(res.status).toBe(200);
    expect(body.status).toBe("ok");
    expect(deps.authStore.setOtp).toHaveBeenCalledWith(
      "owner@example.com",
      expect.any(String),
      600,
    );
    expect(deps.sendEmail).toHaveBeenCalledWith(
      "owner@example.com",
      "Your login code",
      expect.stringContaining("login code"),
    );
  });

  it("handles case-insensitive email matching", async () => {
    const deps = createDeps();
    const res = await handleSendOtp(makeRequest({ email: "Owner@Example.COM" }), deps);
    expect(res.status).toBe(200);
    expect(deps.authStore.setOtp).toHaveBeenCalled();
  });

  it("returns 500 on authStore failure", async () => {
    const deps = createDeps({
      authStore: {
        setOtp: vi.fn().mockRejectedValue(new Error("Redis down")),
        getOtp: vi.fn(),
        deleteOtp: vi.fn(),
        setSession: vi.fn(),
        getSession: vi.fn(),
        deleteSession: vi.fn(),
      },
    });
    const res = await handleSendOtp(makeRequest({ email: "owner@example.com" }), deps);
    expect(res.status).toBe(500);
  });
});
