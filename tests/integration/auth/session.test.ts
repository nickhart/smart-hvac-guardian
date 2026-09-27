import { describe, it, expect, vi, afterEach } from "vitest";
import { handleSession, type SessionDeps } from "../../../api/auth/session";
import { fakeDb } from "./fake-db";

const STORED_SESSION = JSON.stringify({
  email: "owner@example.com",
  tenantId: "tenant-1",
  userId: "user-1",
  tenantStatus: "active",
});
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
      getSession: vi.fn().mockResolvedValue(STORED_SESSION),
      deleteSession: vi.fn(),
    },
    logger: mockLogger,
    db: fakeDb(),
    ...overrides,
  };
}

afterEach(() => {
  vi.unstubAllEnvs();
});

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
    expect(body.tenantId).toBe("tenant-1");
    expect(body.tenantStatus).toBe("active");
    expect(deps.authStore.getSession).toHaveBeenCalledWith("valid-token");
  });

  it("returns 503 when there is no database", async () => {
    vi.stubEnv("DATABASE_URL", "");
    const req = new Request("https://example.com/api/auth/session", {
      method: "GET",
      headers: { Cookie: "session=valid-token" },
    });
    const res = await handleSession(req, createDeps({ db: undefined }));
    expect(res.status).toBe(503);
  });

  // A session from before sessions carried the tenant: a bare email, looked
  // up in the database. An email with no user is not a session.
  it("returns unauthenticated for an old-style session whose user is gone", async () => {
    const deps = createDeps({
      db: fakeDb({}),
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
