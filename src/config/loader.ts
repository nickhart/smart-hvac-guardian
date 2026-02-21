import { AppConfigSchema, EnvSecretsSchema } from "./schema.js";
import type { AppConfig, EnvSecrets } from "./schema.js";
import { ConfigError } from "../utils/errors.js";

let cachedConfig: AppConfig | null = null;
let cachedSecrets: EnvSecrets | null = null;

export function loadConfig(envValue?: string): AppConfig {
  if (cachedConfig) return cachedConfig;

  const raw = envValue ?? process.env.APP_CONFIG;
  if (!raw) {
    throw new ConfigError("APP_CONFIG environment variable is not set");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new ConfigError("APP_CONFIG is not valid JSON");
  }

  const result = AppConfigSchema.safeParse(parsed);
  if (!result.success) {
    throw new ConfigError(`APP_CONFIG validation failed: ${result.error.message}`);
  }

  cachedConfig = result.data;
  return cachedConfig;
}

export function loadEnvSecrets(env?: Record<string, string | undefined>): EnvSecrets {
  if (cachedSecrets) return cachedSecrets;

  const source = env ?? process.env;

  const raw = {
    yolinkUaCid: source.YOLINK_UA_CID,
    yolinkSecretKey: source.YOLINK_SECRET_KEY,
    iftttWebhookKey: source.IFTTT_WEBHOOK_KEY,
    qstashToken: source.QSTASH_TOKEN,
    qstashCurrentSigningKey: source.QSTASH_CURRENT_SIGNING_KEY,
    qstashNextSigningKey: source.QSTASH_NEXT_SIGNING_KEY,
  };

  const result = EnvSecretsSchema.safeParse(raw);
  if (!result.success) {
    throw new ConfigError(`Environment secrets validation failed: ${result.error.message}`);
  }

  cachedSecrets = result.data;
  return cachedSecrets;
}

/** Reset cached values — for testing only */
export function resetConfigCache(): void {
  cachedConfig = null;
  cachedSecrets = null;
}
