import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

/**
 * The app ingests over raw HTTP (`/v0/events?name=...`), so a datasource name
 * that does not exist is a 404 at runtime, not a compile error. That is how
 * ingestion silently wrote to `sensor_events` for months while every pipe read
 * from `sensor_events_v2` — the dashboards queried tables nothing wrote to.
 *
 * This pins the two sides together.
 */
describe("Tinybird ingest names match deployed datasources", () => {
  const declaredDatasources = readdirSync(resolve(repoRoot, "tinybird/datasources"))
    .filter((f) => f.endsWith(".datasource"))
    .map((f) => f.replace(/\.datasource$/, ""));

  const clientSource = readFileSync(resolve(repoRoot, "src/providers/tinybird/client.ts"), "utf8");
  const ingestNames = [...clientSource.matchAll(/this\.ingest\("([^"]+)"/g)].map((m) => m[1]);

  it("finds the expected ingest call sites", () => {
    expect(ingestNames.length).toBeGreaterThanOrEqual(4);
  });

  it.each(["sensor_events_v2", "hvac_commands_v2", "hvac_state_events_v2", "provider_events_v2"])(
    "ingests to %s",
    (name) => {
      expect(ingestNames).toContain(name);
    },
  );

  it("every ingest target has a matching .datasource file", () => {
    const missing = ingestNames.filter((n) => !declaredDatasources.includes(n));
    expect(missing).toEqual([]);
  });

  it("declares only _v2 datasources", () => {
    // The pre-multi-tenancy datasources were dropped. Their schemas had been
    // inferred by the Events API on first ingest and could never be reconciled
    // with a .datasource file, which is what failed every deploy for 30 runs.
    const notV2 = declaredDatasources.filter((n) => !n.endsWith("_v2"));
    expect(notV2).toEqual([]);
  });
});
