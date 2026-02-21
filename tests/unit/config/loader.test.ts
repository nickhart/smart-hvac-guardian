import { describe, it, expect, beforeEach } from "vitest";
import { loadConfig, loadEnvSecrets, resetConfigCache } from "@/config/loader";

const validConfig = {
  sensors: [{ id: "sensor1", name: "Front Door", delaySeconds: 90 }],
  hvacUnits: [{ id: "unit1", name: "Living Room AC", iftttEvent: "turn_off_ac" }],
  yolink: { baseUrl: "https://api.yosmart.com/open/yolink/v2/api" },
  checkStateUrl: "https://example.vercel.app/api/check-state",
};

const validSecrets = {
  YOLINK_UA_CID: "ua-cid",
  YOLINK_SECRET_KEY: "secret-key",
  IFTTT_WEBHOOK_KEY: "ifttt-key",
  QSTASH_TOKEN: "qstash-token",
  QSTASH_CURRENT_SIGNING_KEY: "current-key",
  QSTASH_NEXT_SIGNING_KEY: "next-key",
};

describe("loadConfig", () => {
  beforeEach(() => {
    resetConfigCache();
  });

  it("parses valid JSON config", () => {
    const config = loadConfig(JSON.stringify(validConfig));
    expect(config.sensors).toHaveLength(1);
    expect(config.sensors[0].id).toBe("sensor1");
    expect(config.sensors[0].delaySeconds).toBe(90);
    expect(config.hvacUnits[0].iftttEvent).toBe("turn_off_ac");
  });

  it("throws on missing APP_CONFIG", () => {
    expect(() => loadConfig(undefined)).toThrow("APP_CONFIG environment variable is not set");
  });

  it("throws on invalid JSON", () => {
    expect(() => loadConfig("not-json")).toThrow("APP_CONFIG is not valid JSON");
  });

  it("throws on schema validation failure", () => {
    expect(() => loadConfig(JSON.stringify({ sensors: [] }))).toThrow(
      "APP_CONFIG validation failed",
    );
  });

  it("caches config across calls", () => {
    const config1 = loadConfig(JSON.stringify(validConfig));
    const config2 = loadConfig();
    expect(config1).toBe(config2);
  });
});

describe("loadEnvSecrets", () => {
  beforeEach(() => {
    resetConfigCache();
  });

  it("parses valid env secrets", () => {
    const secrets = loadEnvSecrets(validSecrets);
    expect(secrets.yolinkUaCid).toBe("ua-cid");
    expect(secrets.iftttWebhookKey).toBe("ifttt-key");
  });

  it("throws on missing secrets", () => {
    expect(() => loadEnvSecrets({})).toThrow("Environment secrets validation failed");
  });

  it("caches secrets across calls", () => {
    const s1 = loadEnvSecrets(validSecrets);
    const s2 = loadEnvSecrets();
    expect(s1).toBe(s2);
  });
});
