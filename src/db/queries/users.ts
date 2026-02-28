import { eq } from "drizzle-orm";
import type { Database } from "../client.js";
import { users } from "../schema.js";
import type { User, NewUser } from "../schema.js";

export async function createUser(
  db: Database,
  data: Pick<NewUser, "email" | "tenantId" | "role">,
): Promise<User> {
  const [user] = await db
    .insert(users)
    .values({
      email: data.email.toLowerCase(),
      tenantId: data.tenantId,
      role: data.role ?? "owner",
    })
    .returning();
  return user;
}

export async function getUserByEmail(db: Database, email: string): Promise<User | undefined> {
  return db.query.users.findFirst({ where: eq(users.email, email.toLowerCase()) });
}

export async function getUserById(db: Database, id: string): Promise<User | undefined> {
  return db.query.users.findFirst({ where: eq(users.id, id) });
}

export async function getUsersByTenantId(db: Database, tenantId: string): Promise<User[]> {
  return db.query.users.findMany({ where: eq(users.tenantId, tenantId) });
}
