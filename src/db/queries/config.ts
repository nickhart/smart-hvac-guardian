import { eq } from "drizzle-orm";
import type { Database } from "../client.js";
import { tenantConfig } from "../schema.js";
import { AppConfigSchema } from "../../config/schema.js";
import type { AppConfig } from "../../config/schema.js";

export async function getTenantConfig(
  db: Database,
  tenantId: string,
): Promise<AppConfig | undefined> {
  const row = await db.query.tenantConfig.findFirst({
    where: eq(tenantConfig.tenantId, tenantId),
  });
  if (!row) return undefined;

  const result = AppConfigSchema.safeParse(row.config);
  if (!result.success) {
    throw new Error(`Invalid tenant config for ${tenantId}: ${result.error.message}`);
  }
  return result.data;
}

export async function upsertTenantConfig(
  db: Database,
  tenantId: string,
  config: AppConfig,
): Promise<void> {
  await db
    .insert(tenantConfig)
    .values({ tenantId, config, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: tenantConfig.tenantId,
      set: { config, updatedAt: new Date() },
    });
}
