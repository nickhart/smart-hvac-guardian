/**
 * CLI for tenant & user management.
 *
 * Usage: pnpm cli <command> [...args]
 *
 * Commands:
 *   tenant:create <name>                 Create a new tenant
 *   tenant:list                          List all tenants
 *   tenant:suspend <tenantId>            Suspend a tenant
 *   tenant:activate <tenantId>           Activate a tenant
 *   tenant:delete <tenantId>             Delete a tenant and all related records
 *
 *   user:add <email> <tenantId> [role]   Add a user (role: owner|admin|viewer, default: viewer)
 *   user:list <tenantId>                 List users for a tenant
 *   user:remove <userId>                 Remove a user
 *   user:set-role <userId> <role>        Change a user's role
 */

import { getDb } from "../src/db/client.js";
import {
  createTenant,
  getAllTenants,
  getTenantById,
  updateTenantStatus,
  deleteTenant,
} from "../src/db/queries/tenants.js";
import {
  createUser,
  getUsersByTenantId,
  getUserById,
  deleteUser,
  updateUserRole,
} from "../src/db/queries/users.js";

const VALID_ROLES = ["owner", "admin", "viewer"] as const;
type Role = (typeof VALID_ROLES)[number];

function usage(): never {
  console.error(`Usage: pnpm cli <command> [...args]

Tenant commands:
  tenant:create <name>                 Create a new tenant (auto-generates slug)
  tenant:list                          List all tenants
  tenant:suspend <tenantId>            Suspend a tenant
  tenant:activate <tenantId>           Activate a tenant
  tenant:delete <tenantId>             Delete tenant + all related records

User commands:
  user:add <email> <tenantId> [role]   Add a user (role: owner|admin|viewer, default: viewer)
  user:list <tenantId>                 List users for a tenant
  user:remove <userId>                 Remove a user
  user:set-role <userId> <role>        Change a user's role`);
  process.exit(1);
}

function slugify(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function printTable(rows: Record<string, unknown>[]): void {
  if (rows.length === 0) {
    console.log("(no results)");
    return;
  }

  const keys = Object.keys(rows[0]);
  const widths = keys.map((k) => Math.max(k.length, ...rows.map((r) => String(r[k] ?? "").length)));

  const header = keys.map((k, i) => k.padEnd(widths[i])).join("  ");
  const separator = widths.map((w) => "-".repeat(w)).join("  ");
  console.log(header);
  console.log(separator);
  for (const row of rows) {
    console.log(keys.map((k, i) => String(row[k] ?? "").padEnd(widths[i])).join("  "));
  }
}

function isValidRole(role: string): role is Role {
  return VALID_ROLES.includes(role as Role);
}

async function main(): Promise<void> {
  const [command, ...args] = process.argv.slice(2);

  if (!command) usage();

  const db = getDb();

  switch (command) {
    case "tenant:create": {
      const name = args[0];
      if (!name) {
        console.error("Error: tenant name is required");
        usage();
      }
      const slug = slugify(name);
      const tenant = await createTenant(db, { name, slug });
      console.log(`Tenant created:`);
      printTable([{ id: tenant.id, name: tenant.name, slug: tenant.slug, status: tenant.status }]);
      break;
    }

    case "tenant:list": {
      const tenantList = await getAllTenants(db);
      printTable(
        tenantList.map((t) => ({
          id: t.id,
          name: t.name,
          slug: t.slug,
          status: t.status,
          created: t.createdAt.toISOString(),
        })),
      );
      break;
    }

    case "tenant:suspend": {
      const tenantId = args[0];
      if (!tenantId) {
        console.error("Error: tenantId is required");
        usage();
      }
      const tenant = await getTenantById(db, tenantId);
      if (!tenant) {
        console.error(`Error: tenant ${tenantId} not found`);
        process.exit(1);
      }
      await updateTenantStatus(db, tenantId, "suspended");
      console.log(`Tenant ${tenantId} suspended.`);
      break;
    }

    case "tenant:activate": {
      const tenantId = args[0];
      if (!tenantId) {
        console.error("Error: tenantId is required");
        usage();
      }
      const tenant = await getTenantById(db, tenantId);
      if (!tenant) {
        console.error(`Error: tenant ${tenantId} not found`);
        process.exit(1);
      }
      await updateTenantStatus(db, tenantId, "active");
      console.log(`Tenant ${tenantId} activated.`);
      break;
    }

    case "tenant:delete": {
      const tenantId = args[0];
      if (!tenantId) {
        console.error("Error: tenantId is required");
        usage();
      }
      const tenant = await getTenantById(db, tenantId);
      if (!tenant) {
        console.error(`Error: tenant ${tenantId} not found`);
        process.exit(1);
      }
      await deleteTenant(db, tenantId);
      console.log(`Tenant ${tenantId} (${tenant.name}) deleted.`);
      break;
    }

    case "user:add": {
      const email = args[0];
      const tenantId = args[1];
      const role = args[2] ?? "viewer";
      if (!email || !tenantId) {
        console.error("Error: email and tenantId are required");
        usage();
      }
      if (!isValidRole(role)) {
        console.error(`Error: invalid role "${role}". Must be one of: ${VALID_ROLES.join(", ")}`);
        process.exit(1);
      }
      const tenant = await getTenantById(db, tenantId);
      if (!tenant) {
        console.error(`Error: tenant ${tenantId} not found`);
        process.exit(1);
      }
      const user = await createUser(db, { email, tenantId, role });
      console.log(`User added:`);
      printTable([{ id: user.id, email: user.email, tenantId: user.tenantId, role: user.role }]);
      break;
    }

    case "user:list": {
      const tenantId = args[0];
      if (!tenantId) {
        console.error("Error: tenantId is required");
        usage();
      }
      const userList = await getUsersByTenantId(db, tenantId);
      printTable(
        userList.map((u) => ({
          id: u.id,
          email: u.email,
          role: u.role,
          created: u.createdAt.toISOString(),
        })),
      );
      break;
    }

    case "user:remove": {
      const userId = args[0];
      if (!userId) {
        console.error("Error: userId is required");
        usage();
      }
      const user = await getUserById(db, userId);
      if (!user) {
        console.error(`Error: user ${userId} not found`);
        process.exit(1);
      }
      await deleteUser(db, userId);
      console.log(`User ${userId} (${user.email}) removed.`);
      break;
    }

    case "user:set-role": {
      const userId = args[0];
      const role = args[1];
      if (!userId || !role) {
        console.error("Error: userId and role are required");
        usage();
      }
      if (!isValidRole(role)) {
        console.error(`Error: invalid role "${role}". Must be one of: ${VALID_ROLES.join(", ")}`);
        process.exit(1);
      }
      const user = await getUserById(db, userId);
      if (!user) {
        console.error(`Error: user ${userId} not found`);
        process.exit(1);
      }
      await updateUserRole(db, userId, role);
      console.log(`User ${userId} role updated to "${role}".`);
      break;
    }

    default:
      console.error(`Unknown command: ${command}`);
      usage();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
