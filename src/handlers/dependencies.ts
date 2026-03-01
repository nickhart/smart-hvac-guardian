import type { AppConfig, EnvSecrets } from "../config/index.js";
import type {
  SensorProvider,
  HVACProvider,
  SchedulerProvider,
  StateStore,
  AnalyticsProvider,
} from "../providers/types.js";
import { YoLinkClient, YoLinkSensorProvider } from "../providers/yolink/index.js";
import { IFTTTClient } from "../providers/cielo/client.js";
import { CieloIFTTTProvider } from "../providers/cielo/index.js";
import { QStashScheduler } from "../providers/qstash/index.js";
import { createQStashReceiver } from "../providers/qstash/verify.js";
import { RedisStateStore } from "../providers/redis/index.js";
import { TinybirdAnalyticsProvider, NoopAnalyticsProvider } from "../providers/tinybird/index.js";
import type { Receiver } from "@upstash/qstash";
import type { Logger } from "../utils/logger.js";

export interface Dependencies {
  sensor: SensorProvider;
  hvac: HVACProvider;
  scheduler: SchedulerProvider;
  stateStore: StateStore;
  analytics: AnalyticsProvider;
  qstashReceiver: Receiver;
  config: AppConfig;
  logger: Logger;
  tenantId?: string;
}

export interface TenantSecrets {
  yolinkUaCid: string;
  yolinkSecretKey: string;
  iftttWebhookKey: string;
}

export function createDependencies(
  config: AppConfig,
  secrets: EnvSecrets,
  logger: Logger,
  options?: { tenantId?: string; tenantSecrets?: TenantSecrets },
): Dependencies {
  // Per-tenant credentials override env secrets for YoLink/IFTTT
  const yolinkUaCid = options?.tenantSecrets?.yolinkUaCid || secrets.yolinkUaCid;
  const yolinkSecretKey = options?.tenantSecrets?.yolinkSecretKey || secrets.yolinkSecretKey;
  const iftttWebhookKey = options?.tenantSecrets?.iftttWebhookKey || secrets.iftttWebhookKey;

  const yolinkClient = new YoLinkClient({
    baseUrl: config.yolink.baseUrl,
    uaCid: yolinkUaCid,
    secretKey: yolinkSecretKey,
    logger,
  });

  const iftttClient = new IFTTTClient({
    webhookKey: iftttWebhookKey,
    logger,
  });

  const analytics =
    secrets.tinybirdToken && secrets.tinybirdUrl
      ? new TinybirdAnalyticsProvider({
          baseUrl: secrets.tinybirdUrl,
          token: secrets.tinybirdToken,
          tenantId: options?.tenantId,
        })
      : new NoopAnalyticsProvider();

  return {
    sensor: new YoLinkSensorProvider(yolinkClient, logger),
    hvac: new CieloIFTTTProvider(iftttClient),
    scheduler: new QStashScheduler({
      token: secrets.qstashToken,
      checkStateUrl: "unused",
      turnOffUrl: config.turnOffUrl,
      logger,
      tenantId: options?.tenantId,
    }),
    stateStore: new RedisStateStore({
      url: secrets.upstashRedisUrl,
      token: secrets.upstashRedisToken,
      tenantId: options?.tenantId,
    }),
    analytics,
    qstashReceiver: createQStashReceiver({
      currentSigningKey: secrets.qstashCurrentSigningKey,
      nextSigningKey: secrets.qstashNextSigningKey,
    }),
    config,
    logger,
    tenantId: options?.tenantId,
  };
}
