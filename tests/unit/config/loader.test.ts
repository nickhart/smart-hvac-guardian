import { describe, it, expect, beforeEach } from "vitest";
import { loadConfig, loadEnvSecrets, resetConfigCache } from "@/config/loader";

const validConfig = {
  zones: {
    living_room: {
      minisplits: ["ac_living"],
      exteriorOpenings: ["front_door"],
      interiorDoors: [{ id: "door_bedroom", connectsTo: "bedroom" }],
    },
    bedroom: {
      minisplits: ["ac_bedroom"],
      exteriorOpenings: ["bedroom_window"],
      interiorDoors: [{ id: "door_bedroom", connectsTo: "living_room" }],
    },
  },
  sensorDelays: {
    front_door: 90,
    bedroom_window: 120,
    door_bedroom: 0,
  },
  hvacUnits: {
    ac_living: { name: "Living Room AC", iftttEvent: "turn_off_ac_living" },
    ac_bedroom: { name: "Bedroom AC", iftttEvent: "turn_off_ac_bedroom" },
  },
  yolink: { baseUrl: "https://api.yosmart.com/open/yolink/v2/api" },
  turnOffUrl: "https://example.vercel.app/api/hvac-turn-off",
};

const validSecrets = {
  YOLINK_UA_CID: "ua-cid",
  YOLINK_SECRET_KEY: "secret-key",
  IFTTT_WEBHOOK_KEY: "ifttt-key",
  QSTASH_TOKEN: "qstash-token",
  QSTASH_CURRENT_SIGNING_KEY: "current-key",
  QSTASH_NEXT_SIGNING_KEY: "next-key",
  UPSTASH_REDIS_REST_URL: "https://redis.upstash.io",
  UPSTASH_REDIS_REST_TOKEN: "redis-token",
};

describe("loadConfig", () => {
  beforeEach(() => {
    resetConfigCache();
  });

  it("parses valid JSON config", () => {
    const config = loadConfig(JSON.stringify(validConfig));
    expect(Object.keys(config.zones)).toHaveLength(2);
    expect(config.zones.living_room.minisplits).toEqual(["ac_living"]);
    expect(config.sensorDelays.front_door).toBe(90);
    expect(config.hvacUnits.ac_living.iftttEvent).toBe("turn_off_ac_living");
  });

  it("throws on missing APP_CONFIG", () => {
    expect(() => loadConfig(undefined)).toThrow("APP_CONFIG environment variable is not set");
  });

  it("throws on invalid JSON", () => {
    expect(() => loadConfig("not-json")).toThrow("APP_CONFIG is not valid JSON");
  });

  it("throws on schema validation failure", () => {
    expect(() => loadConfig(JSON.stringify({ zones: {} }))).toThrow(
      "APP_CONFIG validation failed",
    );
  });

  it("caches config across calls", () => {
    const config1 = loadConfig(JSON.stringify(validConfig));
    const config2 = loadConfig();
    expect(config1).toBe(config2);
  });

  it("rejects minisplit referencing nonexistent hvacUnit", () => {
    const bad = {
      ...validConfig,
      zones: {
        living_room: {
          minisplits: ["nonexistent_unit"],
          exteriorOpenings: ["front_door"],
          interiorDoors: [],
        },
      },
      sensorDelays: { front_door: 90 },
    };
    expect(() => loadConfig(JSON.stringify(bad))).toThrow("APP_CONFIG validation failed");
  });

  it("rejects exterior sensor not in sensorDelays", () => {
    const bad = {
      ...validConfig,
      zones: {
        living_room: {
          minisplits: ["ac_living"],
          exteriorOpenings: ["unlisted_sensor"],
          interiorDoors: [],
        },
      },
      sensorDelays: { front_door: 90 },
    };
    expect(() => loadConfig(JSON.stringify(bad))).toThrow("APP_CONFIG validation failed");
  });

  it("rejects interior door not in sensorDelays", () => {
    const bad = {
      ...validConfig,
      zones: {
        zone_a: {
          minisplits: ["ac_living"],
          exteriorOpenings: ["front_door"],
          interiorDoors: [{ id: "unlisted_door", connectsTo: "zone_b" }],
        },
        zone_b: {
          minisplits: [],
          exteriorOpenings: [],
          interiorDoors: [{ id: "unlisted_door", connectsTo: "zone_a" }],
        },
      },
      sensorDelays: { front_door: 90 },
    };
    expect(() => loadConfig(JSON.stringify(bad))).toThrow("APP_CONFIG validation failed");
  });

  it("rejects connectsTo referencing invalid zone", () => {
    const bad = {
      ...validConfig,
      zones: {
        living_room: {
          minisplits: ["ac_living"],
          exteriorOpenings: ["front_door"],
          interiorDoors: [{ id: "door_bedroom", connectsTo: "nonexistent_zone" }],
        },
      },
      sensorDelays: { front_door: 90, door_bedroom: 0 },
    };
    expect(() => loadConfig(JSON.stringify(bad))).toThrow("APP_CONFIG validation failed");
  });

  it("rejects asymmetric interior doors", () => {
    const bad = {
      ...validConfig,
      zones: {
        zone_a: {
          minisplits: ["ac_living"],
          exteriorOpenings: ["front_door"],
          interiorDoors: [{ id: "door_ab", connectsTo: "zone_b" }],
        },
        zone_b: {
          minisplits: ["ac_bedroom"],
          exteriorOpenings: ["bedroom_window"],
          interiorDoors: [], // Missing mirror of door_ab -> zone_a
        },
      },
      sensorDelays: { front_door: 90, bedroom_window: 120, door_ab: 0 },
    };
    expect(() => loadConfig(JSON.stringify(bad))).toThrow("APP_CONFIG validation failed");
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
    expect(secrets.upstashRedisUrl).toBe("https://redis.upstash.io");
    expect(secrets.upstashRedisToken).toBe("redis-token");
  });

  it("throws on missing secrets", () => {
    expect(() => loadEnvSecrets({})).toThrow("Environment secrets validation failed");
  });

  it("throws on missing Redis secrets", () => {
    const { UPSTASH_REDIS_REST_URL, UPSTASH_REDIS_REST_TOKEN, ...partial } = validSecrets;
    expect(() => loadEnvSecrets(partial)).toThrow("Environment secrets validation failed");
  });

  it("caches secrets across calls", () => {
    const s1 = loadEnvSecrets(validSecrets);
    const s2 = loadEnvSecrets();
    expect(s1).toBe(s2);
  });
});
