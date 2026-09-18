import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

/**
 * Three sources have to agree about what a datasource is called and what
 * columns it has, and none of them fails loudly on its own:
 *
 *  - `src/lib/tinybird.ts` is what actually gets deployed. `tinybird.config.json`
 *    lists it under `include`, and the CLI reads nothing else. A datasource
 *    missing from here simply never exists in the workspace.
 *  - `tinybird/datasources/*.datasource` are documentation. They look
 *    authoritative and are not — editing one changes nothing, and a deploy
 *    reports "△ Not deploying. No changes."
 *  - `src/providers/tinybird/client.ts` ingests over raw HTTP, so a name with
 *    no deployed datasource is a 404 at runtime rather than a compile error.
 *
 * Every combination of those three drifting apart has already happened in this
 * repo: ingestion writing to `sensor_events` while pipes read `sensor_events_v2`,
 * `provider_events_v2` existing only as a .datasource file and so never being
 * deployed, and `shutoff_enabled` being added to the .datasource files only.
 */
const tsDefinitions = readFileSync(resolve(repoRoot, "src/lib/tinybird.ts"), "utf8");
const clientSource = readFileSync(resolve(repoRoot, "src/providers/tinybird/client.ts"), "utf8");

const deployedNames = [...tsDefinitions.matchAll(/defineDatasource\("([^"]+)"/g)].map((m) => m[1]);
const ingestNames = [...clientSource.matchAll(/this\.ingest\("([^"]+)"/g)].map((m) => m[1]);
const documentedNames = readdirSync(resolve(repoRoot, "tinybird/datasources"))
  .filter((f) => f.endsWith(".datasource"))
  .map((f) => f.replace(/\.datasource$/, ""));

describe("Tinybird datasource definitions", () => {
  it("finds the expected ingest call sites", () => {
    expect(ingestNames.length).toBeGreaterThanOrEqual(4);
  });

  it.each(["sensor_events_v2", "hvac_commands_v2", "hvac_state_events_v2", "provider_events_v2"])(
    "ingests to %s",
    (name) => {
      expect(ingestNames).toContain(name);
    },
  );

  // The one that matters: a name the app ingests to but src/lib/tinybird.ts
  // does not define is never deployed, so every write to it 404s.
  it("every ingest target is defined in src/lib/tinybird.ts", () => {
    const undeployed = ingestNames.filter((n) => !deployedNames.includes(n));
    expect(undeployed).toEqual([]);
  });

  it("the .datasource files describe exactly the deployed datasources", () => {
    expect([...documentedNames].sort()).toEqual([...deployedNames].sort());
  });

  it("declares only _v2 datasources", () => {
    expect(deployedNames.filter((n) => !n.endsWith("_v2"))).toEqual([]);
  });
});

describe("Tinybird schemas agree between the deployed definition and its .datasource file", () => {
  it.each(["sensor_events_v2", "hvac_commands_v2", "hvac_state_events_v2", "provider_events_v2"])(
    "%s has the same columns in both",
    (name) => {
      const block = tsDefinitions.slice(
        tsDefinitions.indexOf(`defineDatasource("${name}"`),
        tsDefinitions.indexOf("engine:", tsDefinitions.indexOf(`defineDatasource("${name}"`)),
      );
      const tsColumns = [...block.matchAll(/^\s{4}(\w+):\s*t\./gm)].map((m) => m[1]).sort();

      const file = readFileSync(
        resolve(repoRoot, `tinybird/datasources/${name}.datasource`),
        "utf8",
      );
      const schema = file.slice(file.indexOf("SCHEMA >"), file.indexOf("ENGINE "));
      const fileColumns = [...schema.matchAll(/^\s{4}(\w+)\s+\S/gm)].map((m) => m[1]).sort();

      expect(tsColumns).toEqual(fileColumns);
    },
  );
});
