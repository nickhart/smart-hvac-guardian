import { describe, it, expect, vi } from "vitest";
import { handleSession, type SessionDeps } from "../../../api/auth/session";
import type { Logger } from "@/utils/logger";

const mockLogger: Logger = {
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
};

function createDeps(overrides?: Partial<SessionDeps>): SessionDeps {
  return {
    authStore: {
      setMagicToken: vi.fn(),
      getMagicToken: vi.fn(),
      deleteMagicToken: vi.fn(),
      setSession: vi.fn(),
      getSession: vi.fn().mockResolvedValue("owner@example.com"),
      deleteSession: vi.fn(),
    },
    logger: mockLogger,
    ...overrides,
  };
}

describe("session handler", () => {
  it("returns 405 for non-GET", async () => {
    const req = new Request("https://example.com/api/auth/session", { method: "POST" });
    const res = await handleSession(req, createDeps());
    expect(res.status).toBe(405);
  });

  it("returns unauthenticated when no cookie", async () => {
    const req = new Request("https://example.com/api/auth/session", { method: "GET" });
    const res = await handleSession(req, createDeps());
    const body = (await res.json()) as Record<string, unknown>;

    expect(res.status).toBe(200);
    expect(body.authenticated).toBe(false);
  });

  it("returns unauthenticated when session not found in store", async () => {
    const deps = createDeps({
      authStore: {
        setMagicToken: vi.fn(),
        getMagicToken: vi.fn(),
        deleteMagicToken: vi.fn(),
        setSession: vi.fn(),
        getSession: vi.fn().mockResolvedValue(null),
        deleteSession: vi.fn(),
      },
    });
    const req = new Request("https://example.com/api/auth/session", {
      method: "GET",
      headers: { Cookie: "session=expired-token" },
    });
    const res = await handleSession(req, deps);
    const body = (await res.json()) as Record<string, unknown>;

    expect(res.status).toBe(200);
    expect(body.authenticated).toBe(false);
  });

  it("returns authenticated with email for valid session", async () => {
    const deps = createDeps();
    const req = new Request("https://example.com/api/auth/session", {
      method: "GET",
      headers: { Cookie: "session=valid-token" },
    });
    const res = await handleSession(req, deps);
    const body = (await res.json()) as Record<string, unknown>;

    expect(res.status).toBe(200);
    expect(body.authenticated).toBe(true);
    expect(body.email).toBe("owner@example.com");
    expect(deps.authStore.getSession).toHaveBeenCalledWith("valid-token");
  });

  it("returns unauthenticated when DB is present but getSessionPayload returns null", async () => {
    const mockDb = {
      query: { users: { findFirst: vi.fn().mockResolvedValue(undefined) } },
    } as unknown as import("@/db/client").Database;
    const deps = createDeps({
      db: mockDb,
      authStore: {
        setMagicToken: vi.fn(),
        getMagicToken: vi.fn(),
        deleteMagicToken: vi.fn(),
        setSession: vi.fn(),
        getSession: vi.fn().mockResolvedValue("owner@example.com"),
        deleteSession: vi.fn(),
      },
    });
    const req = new Request("https://example.com/api/auth/session", {
      method: "GET",
      headers: { Cookie: "session=some-token" },
    });
    const res = await handleSession(req, deps);
    const body = (await res.json()) as Record<string, unknown>;
    expect(res.status).toBe(200);
    expect(body.authenticated).toBe(false);
  });

  it("returns 500 on authStore failure", async () => {
    const deps = createDeps({
      authStore: {
        setMagicToken: vi.fn(),
        getMagicToken: vi.fn(),
        deleteMagicToken: vi.fn(),
        setSession: vi.fn(),
        getSession: vi.fn().mockRejectedValue(new Error("Redis down")),
        deleteSession: vi.fn(),
      },
    });
    const req = new Request("https://example.com/api/auth/session", {
      method: "GET",
      headers: { Cookie: "session=some-token" },
    });
    const res = await handleSession(req, deps);
    expect(res.status).toBe(500);
  });
});
