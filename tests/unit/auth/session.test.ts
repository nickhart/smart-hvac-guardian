import { describe, it, expect, vi } from "vitest";
import { getSessionToken, getSessionPayload } from "@/auth/session";
import type { AuthStore } from "@/providers/types";

function req(cookie?: string): Request {
  const headers: Record<string, string> = {};
  if (cookie) headers["Cookie"] = cookie;
  return new Request("https://example.com", { headers });
}

describe("getSessionToken", () => {
  it("extracts session token from cookie", () => {
    expect(getSessionToken(req("session=abc123"))).toBe("abc123");
  });

  it("extracts session from multiple cookies", () => {
    expect(getSessionToken(req("other=x; session=mytoken; foo=bar"))).toBe("mytoken");
  });

  it("returns null when no cookie header", () => {
    expect(getSessionToken(req())).toBeNull();
  });

  it("returns null when session cookie is absent", () => {
    expect(getSessionToken(req("other=value"))).toBeNull();
  });

  it("handles UUID session tokens", () => {
    const uuid = "550e8400-e29b-41d4-a716-446655440000";
    expect(getSessionToken(req(`session=${uuid}`))).toBe(uuid);
  });
});

describe("getSessionPayload", () => {
  const mockPayload = {
    email: "user@example.com",
    tenantId: "t_123",
    userId: "u_456",
    tenantStatus: "active" as const,
  };

  function mockAuthStore(sessionValue: unknown): AuthStore {
    return {
      setMagicToken: vi.fn(),
      getMagicToken: vi.fn(),
      deleteMagicToken: vi.fn(),
      setSession: vi.fn(),
      getSession: vi.fn().mockResolvedValue(sessionValue),
      deleteSession: vi.fn(),
    };
  }

  it("handles Upstash auto-deserialized object (not a string)", async () => {
    // Upstash Redis auto-deserializes JSON, so getSession may return an object
    const store = mockAuthStore(mockPayload);
    const result = await getSessionPayload(store, "token-123");
    expect(result).toEqual(mockPayload);
  });

  it("handles JSON string session value", async () => {
    const store = mockAuthStore(JSON.stringify(mockPayload));
    const result = await getSessionPayload(store, "token-123");
    expect(result).toEqual(mockPayload);
  });

  it("returns null for missing session", async () => {
    const store = mockAuthStore(null);
    const result = await getSessionPayload(store, "token-123");
    expect(result).toBeNull();
  });
});
