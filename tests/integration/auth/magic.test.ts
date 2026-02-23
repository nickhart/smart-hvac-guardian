import { describe, it, expect, vi } from "vitest";
import { handleMagic, type MagicDeps } from "../../../api/auth/magic";
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

const VALID_TOKEN = "550e8400-e29b-41d4-a716-446655440000";

function createDeps(overrides?: Partial<MagicDeps>): MagicDeps {
  return {
    secrets: mockSecrets,
    authStore: {
      setMagicToken: vi.fn(),
      getMagicToken: vi.fn().mockResolvedValue("owner@example.com"),
      deleteMagicToken: vi.fn().mockResolvedValue(undefined),
      setSession: vi.fn().mockResolvedValue(undefined),
      getSession: vi.fn(),
      deleteSession: vi.fn(),
    },
    logger: mockLogger,
    ...overrides,
  };
}

function makeRequest(token?: string, method = "GET"): Request {
  const url = token
    ? `https://example.com/api/auth/magic?token=${token}`
    : "https://example.com/api/auth/magic";
  return new Request(url, { method });
}

describe("magic handler", () => {
  it("returns 405 for non-GET", async () => {
    const req = new Request("https://example.com/api/auth/magic", { method: "POST" });
    const res = await handleMagic(req, createDeps());
    expect(res.status).toBe(405);
  });

  it("returns 400 HTML for missing token", async () => {
    const res = await handleMagic(makeRequest(), createDeps());
    expect(res.status).toBe(400);
    expect(res.headers.get("Content-Type")).toContain("text/html");
    const body = await res.text();
    expect(body).toContain("Invalid link");
  });

  it("returns 400 HTML for non-UUID token", async () => {
    const res = await handleMagic(makeRequest("not-a-uuid"), createDeps());
    expect(res.status).toBe(400);
    expect(res.headers.get("Content-Type")).toContain("text/html");
  });

  it("returns 400 HTML for expired/missing token in store", async () => {
    const deps = createDeps({
      authStore: {
        setMagicToken: vi.fn(),
        getMagicToken: vi.fn().mockResolvedValue(null),
        deleteMagicToken: vi.fn(),
        setSession: vi.fn(),
        getSession: vi.fn(),
        deleteSession: vi.fn(),
      },
    });
    const res = await handleMagic(makeRequest(VALID_TOKEN), deps);
    expect(res.status).toBe(400);
    const body = await res.text();
    expect(body).toContain("expired");
  });

  it("creates session, sets cookie, deletes token, and redirects on valid token", async () => {
    const deps = createDeps();
    const res = await handleMagic(makeRequest(VALID_TOKEN), deps);

    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toBe("/");

    // Token was deleted (single-use)
    expect(deps.authStore.deleteMagicToken).toHaveBeenCalledWith(VALID_TOKEN);

    // Session was created
    expect(deps.authStore.setSession).toHaveBeenCalledWith(
      expect.any(String),
      "owner@example.com",
      604800,
    );

    // Cookie was set
    const cookie = res.headers.get("Set-Cookie")!;
    expect(cookie).toContain("session=");
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("Secure");
  });

  it("returns 500 on authStore failure", async () => {
    const deps = createDeps({
      authStore: {
        setMagicToken: vi.fn(),
        getMagicToken: vi.fn().mockRejectedValue(new Error("Redis down")),
        deleteMagicToken: vi.fn(),
        setSession: vi.fn(),
        getSession: vi.fn(),
        deleteSession: vi.fn(),
      },
    });
    const res = await handleMagic(makeRequest(VALID_TOKEN), deps);
    expect(res.status).toBe(500);
  });
});
