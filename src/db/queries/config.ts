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

/** Return the raw config JSON without Zod validation (for the settings editor). */
export async function getRawTenantConfig(
  db: Database,
  tenantId: string,
): Promise<Record<string, unknown> | undefined> {
  const row = await db.query.tenantConfig.findFirst({
    where: eq(tenantConfig.tenantId, tenantId),
  });
  if (!row) return undefined;
  return row.config as Record<string, unknown>;
}

/** Trim all Record keys and string values in config to prevent trailing-space bugs. */
export function sanitizeConfig(config: AppConfig): AppConfig {
  function trimRecord<V>(record: Record<string, V>): Record<string, V> {
    const out: Record<string, V> = {};
    for (const [key, value] of Object.entries(record)) {
      out[key.trim()] = value;
    }
    return out;
  }

  const hvacUnits = Object.fromEntries(
    Object.entries(config.hvacUnits).map(([k, v]) => [k.trim(), { ...v, name: v.name.trim() }]),
  );

  const sensorNames = Object.fromEntries(
    Object.entries(config.sensorNames).map(([k, v]) => [k.trim(), v.trim()]),
  );

  const zones = Object.fromEntries(
    Object.entries(config.zones).map(([k, z]) => [
      k.trim(),
      {
        minisplits: z.minisplits.map((s) => s.trim()),
        exteriorOpenings: z.exteriorOpenings.map((s) => s.trim()),
        interiorDoors: z.interiorDoors.map((d) => ({
          id: d.id.trim(),
          connectsTo: d.connectsTo.trim(),
        })),
      },
    ]),
  );

  return {
    ...config,
    hvacUnits,
    sensorDelays: trimRecord(config.sensorDelays),
    sensorNames,
    sensorDefaults: trimRecord(config.sensorDefaults),
    zones,
  };
}

export async function upsertTenantConfig(
  db: Database,
  tenantId: string,
  config: AppConfig,
): Promise<void> {
  const sanitized = sanitizeConfig(config);
  await db
    .insert(tenantConfig)
    .values({ tenantId, config: sanitized, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: tenantConfig.tenantId,
      set: { config: sanitized, updatedAt: new Date() },
    });
}
