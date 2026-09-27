import { describe, it, expect } from "vitest";
import {
  assembleConfig,
  tenantWebhookUrls,
  validateOnboardingConfig,
  type OnboardingStepData,
} from "@/onboarding/assemble-config.js";

const APP_URL = "https://guardian.example.com";

/** What the wizard saves for one zone with one unit and one door. */
const completeSteps: OnboardingStepData = {
  "1": { completed: true },
  "2": { uaCid: "ua_test", secretKey: "sk_test" },
  "3": {
    sensorDelays: { front_door: 120 },
    sensorNames: { front_door: "Front Door" },
    sensorDefaults: {},
  },
  "4": {
    hvacUnits: {
      living_ac: { name: "Living AC", iftttEvent: "turn_off_living_ac", delaySeconds: 300 },
    },
  },
  "5": {
    zones: {
      living: {
        name: "Living",
        minisplits: ["living_ac"],
        exteriorOpenings: ["front_door"],
        interiorDoors: [],
      },
    },
  },
  "6": { webhookKey: "ifttt_test" },
};

describe("assembleConfig", () => {
  /**
   * The step numbers follow the order the wizard shows the steps in, not the
   * component file names (Step4Zones renders at step 5). Reading zones from
   * step 4 would produce an empty config that still looks plausible.
   */
  it("reads HVAC units from step 4 and zones from step 5", () => {
    const config = assembleConfig(completeSteps, "t1", APP_URL) as Record<string, unknown>;

    expect(Object.keys(config.hvacUnits as object)).toEqual(["living_ac"]);
    expect(Object.keys(config.zones as object)).toEqual(["living"]);
  });

  it("points QStash at the tenant's own turn-off URL", () => {
    const config = assembleConfig(completeSteps, "t1", APP_URL) as { turnOffUrl: string };
    expect(config.turnOffUrl).toBe(`${APP_URL}/api/t/t1/hvac-turn-off`);
  });

  it("defaults the YoLink base URL", () => {
    const config = assembleConfig(completeSteps, "t1", APP_URL) as { yolink: { baseUrl: string } };
    expect(config.yolink.baseUrl).toBe("https://api.yosmart.com/open/yolink/v2/api");
  });

  it("tolerates missing steps rather than throwing", () => {
    expect(() => assembleConfig({}, "t1", APP_URL)).not.toThrow();
  });
});

describe("validateOnboardingConfig", () => {
  it("accepts what a complete wizard run saves", () => {
    expect(validateOnboardingConfig(completeSteps, "t1", APP_URL).success).toBe(true);
  });

  // The failure a user actually hits: a zone references a sensor that was
  // removed from the sensors step afterwards.
  it("rejects a zone that references a sensor with no delay", () => {
    const steps: OnboardingStepData = {
      ...completeSteps,
      "3": { sensorDelays: {}, sensorNames: {}, sensorDefaults: {} },
    };
    expect(validateOnboardingConfig(steps, "t1", APP_URL).success).toBe(false);
  });
});

describe("tenantWebhookUrls", () => {
  it("builds the two URLs the IFTTT applets post to", () => {
    expect(tenantWebhookUrls(APP_URL, "t1")).toEqual({
      sensorEvent: `${APP_URL}/api/t/t1/sensor-event`,
      hvacEvent: `${APP_URL}/api/t/t1/hvac-event`,
    });
  });
});
