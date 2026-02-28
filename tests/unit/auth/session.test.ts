import { describe, it, expect } from "vitest";
import { getSessionToken } from "@/auth/session";

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
