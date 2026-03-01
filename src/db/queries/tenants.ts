import { eq } from "drizzle-orm";
import type { Database } from "../client.js";
import { tenants, users, tenantConfig, tenantSecrets, onboardingProgress } from "../schema.js";
import type { Tenant, NewTenant } from "../schema.js";

export async function createTenant(
  db: Database,
  data: Pick<NewTenant, "name" | "slug">,
): Promise<Tenant> {
  const [tenant] = await db
    .insert(tenants)
    .values({ name: data.name, slug: data.slug })
    .returning();
  // Create empty onboarding progress
  await db.insert(onboardingProgress).values({ tenantId: tenant.id, stepData: {} });
  return tenant;
}

export async function getTenantById(db: Database, id: string): Promise<Tenant | undefined> {
  return db.query.tenants.findFirst({ where: eq(tenants.id, id) });
}

export async function getTenantBySlug(db: Database, slug: string): Promise<Tenant | undefined> {
  return db.query.tenants.findFirst({ where: eq(tenants.slug, slug) });
}

export async function updateTenantStatus(
  db: Database,
  id: string,
  status: "onboarding" | "active" | "suspended",
): Promise<void> {
  await db.update(tenants).set({ status, updatedAt: new Date() }).where(eq(tenants.id, id));
}

export async function updateTenantOnboardingStep(
  db: Database,
  id: string,
  step: number,
): Promise<void> {
  await db
    .update(tenants)
    .set({ onboardingStep: step, updatedAt: new Date() })
    .where(eq(tenants.id, id));
}

export async function getAllTenants(db: Database): Promise<Tenant[]> {
  return db.query.tenants.findMany();
}

export async function countTenants(db: Database): Promise<number> {
  const result = await db.select().from(tenants);
  return result.length;
}

export async function deleteTenant(db: Database, tenantId: string): Promise<void> {
  // Delete related records first (foreign key order), then the tenant
  await db.delete(users).where(eq(users.tenantId, tenantId));
  await db.delete(tenantConfig).where(eq(tenantConfig.tenantId, tenantId));
  await db.delete(tenantSecrets).where(eq(tenantSecrets.tenantId, tenantId));
  await db.delete(onboardingProgress).where(eq(onboardingProgress.tenantId, tenantId));
  await db.delete(tenants).where(eq(tenants.id, tenantId));
}
