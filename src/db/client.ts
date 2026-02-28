import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import * as schema from "./schema.js";

export type Database = ReturnType<typeof createDb>;

function createDb(databaseUrl: string) {
  const sql = neon(databaseUrl);
  return drizzle({ client: sql, schema });
}

let cachedDb: Database | null = null;

export function getDb(databaseUrl?: string): Database {
  if (cachedDb) return cachedDb;

  const url = databaseUrl ?? process.env.DATABASE_URL;
  if (!url) {
    throw new Error("DATABASE_URL environment variable is not set");
  }

  cachedDb = createDb(url);
  return cachedDb;
}

/** Reset cached DB — for testing only */
export function resetDbCache(): void {
  cachedDb = null;
}
