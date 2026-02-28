/**
 * One-time script to migrate Redis keys from unprefixed to tenant-prefixed format.
 *
 * Usage: TENANT_ID=xxx npx tsx scripts/migrate-redis-keys.ts
 *
 * This copies keys like:
 *   sensor:{id} → {tenantId}:sensor:{id}
 *   timer:{id}  → {tenantId}:timer:{id}
 *   system:enabled → {tenantId}:system:enabled
 *   delay:{id}  → {tenantId}:delay:{id}
 *
 * Auth keys (magic:*, session:*) are NOT migrated — they stay global.
 */

import { Redis } from "@upstash/redis";

const TENANT_ID = process.env.TENANT_ID;
const REDIS_URL = process.env.UPSTASH_REDIS_REST_URL;
const REDIS_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;

if (!TENANT_ID || !REDIS_URL || !REDIS_TOKEN) {
  console.error("Required: TENANT_ID, UPSTASH_REDIS_REST_URL, UPSTASH_REDIS_REST_TOKEN");
  process.exit(1);
}

const redis = new Redis({ url: REDIS_URL, token: REDIS_TOKEN });

const KEY_PREFIXES = ["sensor:", "timer:", "delay:"];
const STANDALONE_KEYS = ["system:enabled"];

async function migrateKeys(): Promise<void> {
  let migrated = 0;

  // Migrate prefixed keys
  for (const prefix of KEY_PREFIXES) {
    let cursor = "0";
    do {
      const result: [string, string[]] = await redis.scan(cursor, {
        match: `${prefix}*`,
        count: 100,
      });
      cursor = result[0];

      for (const key of result[1]) {
        // Skip already-prefixed keys
        if (key.startsWith(`${TENANT_ID}:`)) continue;

        const value = await redis.get(key);
        if (value !== null) {
          const ttl = await redis.ttl(key);
          const newKey = `${TENANT_ID}:${key}`;

          if (ttl > 0) {
            await redis.set(newKey, value as string, { ex: ttl });
          } else {
            await redis.set(newKey, value as string);
          }
          console.log(`Copied: ${key} → ${newKey}`);
          migrated++;
        }
      }
    } while (cursor !== "0");
  }

  // Migrate standalone keys
  for (const key of STANDALONE_KEYS) {
    const value = await redis.get(key);
    if (value !== null) {
      const newKey = `${TENANT_ID}:${key}`;
      await redis.set(newKey, value as string);
      console.log(`Copied: ${key} → ${newKey}`);
      migrated++;
    }
  }

  console.log(`\nMigration complete. ${migrated} keys copied.`);
  console.log("Old keys are preserved. Remove them manually after verifying.");
}

migrateKeys().catch(console.error);
