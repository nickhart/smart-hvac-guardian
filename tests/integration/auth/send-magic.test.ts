import { describe, it, expect, vi } from "vitest";
import { handleSendMagic, type SendMagicDeps } from "../../../api/auth/send-magic";
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
  appUrl: "https://myapp.example.com",
};

function createDeps(overrides?: Partial<SendMagicDeps>): SendMagicDeps {
  return {
    secrets: mockSecrets,
    authStore: {
      setMagicToken: vi.fn().mockResolvedValue(undefined),
      getMagicToken: vi.fn(),
      deleteMagicToken: vi.fn(),
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
  return new Request("https://example.com/api/auth/send-magic", {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("send-magic handler", () => {
  it("returns 405 for non-POST", async () => {
    const req = new Request("https://example.com/api/auth/send-magic", { method: "GET" });
    const res = await handleSendMagic(req, createDeps());
    expect(res.status).toBe(405);
  });

  it("returns 503 when auth is not configured", async () => {
    const deps = createDeps({
      secrets: { ...mockSecrets, resendApiKey: undefined, ownerEmail: undefined },
    });
    const res = await handleSendMagic(makeRequest({ email: "test@example.com" }), deps);
    expect(res.status).toBe(503);
  });

  it("returns 400 for invalid payload", async () => {
    const res = await handleSendMagic(makeRequest({ bad: "data" }), createDeps());
    expect(res.status).toBe(400);
  });

  it("returns ok for unauthorized email without storing token", async () => {
    const deps = createDeps();
    const res = await handleSendMagic(makeRequest({ email: "stranger@example.com" }), deps);
    const body = (await res.json()) as Record<string, unknown>;

    expect(res.status).toBe(200);
    expect(body.status).toBe("ok");
    expect(deps.authStore.setMagicToken).not.toHaveBeenCalled();
    expect(deps.sendEmail).not.toHaveBeenCalled();
  });

  it("stores magic token and sends email with link for authorized email", async () => {
    const deps = createDeps();
    const res = await handleSendMagic(makeRequest({ email: "owner@example.com" }), deps);
    const body = (await res.json()) as Record<string, unknown>;

    expect(res.status).toBe(200);
    expect(body.status).toBe("ok");
    expect(deps.authStore.setMagicToken).toHaveBeenCalledWith(
      expect.any(String),
      "owner@example.com",
      600,
    );

    // Verify the email contains a magic link
    const sendEmailMock = deps.sendEmail as ReturnType<typeof vi.fn>;
    expect(sendEmailMock).toHaveBeenCalledWith(
      "owner@example.com",
      "Your login link",
      expect.stringContaining("https://myapp.example.com/api/auth/magic?token="),
    );
  });

  it("handles case-insensitive email matching", async () => {
    const deps = createDeps();
    const res = await handleSendMagic(makeRequest({ email: "Owner@Example.COM" }), deps);
    expect(res.status).toBe(200);
    expect(deps.authStore.setMagicToken).toHaveBeenCalled();
  });

  it("returns 500 on authStore failure", async () => {
    const deps = createDeps({
      authStore: {
        setMagicToken: vi.fn().mockRejectedValue(new Error("Redis down")),
        getMagicToken: vi.fn(),
        deleteMagicToken: vi.fn(),
        setSession: vi.fn(),
        getSession: vi.fn(),
        deleteSession: vi.fn(),
      },
    });
    const res = await handleSendMagic(makeRequest({ email: "owner@example.com" }), deps);
    expect(res.status).toBe(500);
  });
});
