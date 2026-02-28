import type { AppConfig, EnvSecrets } from "../config/index.js";
import type { StepData } from "../db/queries/onboarding.js";

/**
 * Convert legacy env-based configuration into onboarding step data.
 * Each step maps to a specific set of configuration values.
 */
export function envConfigToStepData(
  config: AppConfig,
  secrets: EnvSecrets,
): Record<string, StepData> {
  return {
    "1": { completed: true },
    "2": {
      uaCid: secrets.yolinkUaCid,
      secretKey: secrets.yolinkSecretKey,
    },
    "3": {
      sensorDelays: config.sensorDelays,
      sensorNames: config.sensorNames,
      sensorDefaults: config.sensorDefaults,
      yolinkBaseUrl: config.yolink.baseUrl,
    },
    "4": {
      zones: config.zones,
    },
    "5": {
      hvacUnits: config.hvacUnits,
    },
    "6": {
      webhookKey: secrets.iftttWebhookKey,
    },
    "7": { tested: true },
    "8": { verified: true },
  };
}
