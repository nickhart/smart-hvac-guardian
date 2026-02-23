import { describe, it, expect, vi } from "vitest";
import { handleLogout, type LogoutDeps } from "../../../api/auth/logout";
import type { Logger } from "@/utils/logger";

const mockLogger: Logger = {
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
};

function createDeps(overrides?: Partial<LogoutDeps>): LogoutDeps {
  return {
    authStore: {
      setOtp: vi.fn(),
      getOtp: vi.fn(),
      deleteOtp: vi.fn(),
      setSession: vi.fn(),
      getSession: vi.fn(),
      deleteSession: vi.fn().mockResolvedValue(undefined),
    },
    logger: mockLogger,
    ...overrides,
  };
}

describe("logout handler", () => {
  it("returns 405 for non-POST", async () => {
    const req = new Request("https://example.com/api/auth/logout", { method: "GET" });
    const res = await handleLogout(req, createDeps());
    expect(res.status).toBe(405);
  });

  it("clears session and sets expired cookie", async () => {
    const deps = createDeps();
    const req = new Request("https://example.com/api/auth/logout", {
      method: "POST",
      headers: { Cookie: "session=valid-token" },
    });
    const res = await handleLogout(req, deps);
    const body = (await res.json()) as Record<string, unknown>;

    expect(res.status).toBe(200);
    expect(body.status).toBe("ok");
    expect(deps.authStore.deleteSession).toHaveBeenCalledWith("valid-token");
    expect(res.headers.get("Set-Cookie")).toContain("Max-Age=0");
  });

  it("handles logout without session cookie", async () => {
    const deps = createDeps();
    const req = new Request("https://example.com/api/auth/logout", { method: "POST" });
    const res = await handleLogout(req, deps);
    const body = (await res.json()) as Record<string, unknown>;

    expect(res.status).toBe(200);
    expect(body.status).toBe("ok");
    expect(deps.authStore.deleteSession).not.toHaveBeenCalled();
  });

  it("returns 500 on authStore failure", async () => {
    const deps = createDeps({
      authStore: {
        setOtp: vi.fn(),
        getOtp: vi.fn(),
        deleteOtp: vi.fn(),
        setSession: vi.fn(),
        getSession: vi.fn(),
        deleteSession: vi.fn().mockRejectedValue(new Error("Redis down")),
      },
    });
    const req = new Request("https://example.com/api/auth/logout", {
      method: "POST",
      headers: { Cookie: "session=valid-token" },
    });
    const res = await handleLogout(req, deps);
    expect(res.status).toBe(500);
  });
});
