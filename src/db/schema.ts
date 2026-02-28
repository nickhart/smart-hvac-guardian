import {
  pgTable,
  text,
  timestamp,
  jsonb,
  customType,
  uuid,
  pgEnum,
  integer,
} from "drizzle-orm/pg-core";

// Custom bytea type for encrypted data
const bytea = customType<{ data: Uint8Array; driverData: Buffer }>({
  dataType() {
    return "bytea";
  },
  toDriver(value: Uint8Array): Buffer {
    return Buffer.from(value);
  },
  fromDriver(value: Buffer): Uint8Array {
    return new Uint8Array(value);
  },
});

// Enums
export const tenantStatusEnum = pgEnum("tenant_status", ["onboarding", "active", "suspended"]);

export const userRoleEnum = pgEnum("user_role", ["owner", "admin", "viewer"]);

// Tables
export const tenants = pgTable("tenants", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  status: tenantStatusEnum("status").notNull().default("onboarding"),
  onboardingStep: integer("onboarding_step").notNull().default(1),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").notNull().unique(),
  tenantId: uuid("tenant_id")
    .notNull()
    .references(() => tenants.id),
  role: userRoleEnum("role").notNull().default("owner"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const tenantConfig = pgTable("tenant_config", {
  tenantId: uuid("tenant_id")
    .primaryKey()
    .references(() => tenants.id),
  config: jsonb("config").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const tenantSecrets = pgTable("tenant_secrets", {
  tenantId: uuid("tenant_id")
    .primaryKey()
    .references(() => tenants.id),
  yolinkUaCidEnc: bytea("yolink_ua_cid_enc"),
  yolinkSecretKeyEnc: bytea("yolink_secret_key_enc"),
  iftttWebhookKeyEnc: bytea("ifttt_webhook_key_enc"),
  webhookSecretEnc: bytea("webhook_secret_enc"),
  keyVersion: integer("key_version").notNull().default(1),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const onboardingProgress = pgTable("onboarding_progress", {
  tenantId: uuid("tenant_id")
    .primaryKey()
    .references(() => tenants.id),
  stepData: jsonb("step_data").notNull().default({}),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

// Type exports
export type Tenant = typeof tenants.$inferSelect;
export type NewTenant = typeof tenants.$inferInsert;
export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type TenantConfig = typeof tenantConfig.$inferSelect;
export type TenantSecrets = typeof tenantSecrets.$inferSelect;
export type OnboardingProgress = typeof onboardingProgress.$inferSelect;
