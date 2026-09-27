import { AppConfigSchema } from "../config/schema.js";

/** The wizard's saved answers, keyed by step number ("1".."9"). */
export type OnboardingStepData = Record<string, Record<string, unknown>>;

const DEFAULT_YOLINK_BASE_URL = "https://api.yosmart.com/open/yolink/v2/api";

/**
 * Build a tenant's AppConfig from the wizard's saved steps.
 *
 * Step numbers are the order the wizard shows them in, not the component file
 * names: HVAC units are saved as step 4 and zones as step 5, because a zone has
 * to name units that already exist.
 *
 * Verify (the dry run) and activate (the real write) both go through here, so
 * they cannot disagree about what a set of answers means. The wizard's browser
 * tests use it too, so their fake backend rejects exactly what the real one
 * would.
 */
export function assembleConfig(
  stepData: OnboardingStepData,
  tenantId: string,
  appUrl: string,
): unknown {
  const step3 = stepData["3"] ?? {};
  const step4 = stepData["4"] ?? {};
  const step5 = stepData["5"] ?? {};

  return {
    zones: step5["zones"] ?? {},
    sensorDelays: step3["sensorDelays"] ?? {},
    hvacUnits: step4["hvacUnits"] ?? {},
    sensorNames: step3["sensorNames"] ?? {},
    sensorDefaults: step3["sensorDefaults"] ?? {},
    yolink: {
      baseUrl: (step3["yolinkBaseUrl"] as string | undefined) ?? DEFAULT_YOLINK_BASE_URL,
    },
    turnOffUrl: `${appUrl}/api/t/${tenantId}/hvac-turn-off`,
  };
}

/** Assemble and validate in one step — what verify and activate both need. */
export function validateOnboardingConfig(
  stepData: OnboardingStepData,
  tenantId: string,
  appUrl: string,
) {
  return AppConfigSchema.safeParse(assembleConfig(stepData, tenantId, appUrl));
}

/** The two URLs a tenant's IFTTT applets post to. */
export function tenantWebhookUrls(appUrl: string, tenantId: string) {
  return {
    sensorEvent: `${appUrl}/api/t/${tenantId}/sensor-event`,
    hvacEvent: `${appUrl}/api/t/${tenantId}/hvac-event`,
  };
}
