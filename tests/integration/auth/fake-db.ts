import { vi } from "vitest";
import type { Database } from "@/db/client";

/**
 * The slice of the database the auth routes read: one user lookup and one
 * tenant lookup, both via Drizzle's relational `findFirst`. Leave `user` out
 * to model an email nobody has registered.
 */

export const OWNER = {
  id: "user-1",
  email: "owner@example.com",
  tenantId: "tenant-1",
  role: "owner",
};

export const ACTIVE_TENANT = { id: "tenant-1", name: "Test House", status: "active" };

export function fakeDb(
  rows: { user?: typeof OWNER; tenant?: typeof ACTIVE_TENANT } = {
    user: OWNER,
    tenant: ACTIVE_TENANT,
  },
): Database {
  return {
    query: {
      users: { findFirst: vi.fn().mockResolvedValue(rows.user) },
      tenants: { findFirst: vi.fn().mockResolvedValue(rows.tenant) },
    },
  } as unknown as Database;
}
