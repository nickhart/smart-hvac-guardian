import type { AppConfig, EnvSecrets } from "../config/index.js";
import type { SensorProvider, HVACProvider, SchedulerProvider, StateStore, AnalyticsProvider } from "../providers/types.js";
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
}

export function createDependencies(
  config: AppConfig,
  secrets: EnvSecrets,
  logger: Logger,
): Dependencies {
  const yolinkClient = new YoLinkClient({
    baseUrl: config.yolink.baseUrl,
    uaCid: secrets.yolinkUaCid,
    secretKey: secrets.yolinkSecretKey,
    logger,
  });

  const iftttClient = new IFTTTClient({
    webhookKey: secrets.iftttWebhookKey,
    logger,
  });

  const analytics = secrets.tinybirdToken && secrets.tinybirdBaseUrl
    ? new TinybirdAnalyticsProvider({
        baseUrl: secrets.tinybirdBaseUrl,
        token: secrets.tinybirdToken,
      })
    : new NoopAnalyticsProvider();

  return {
    sensor: new YoLinkSensorProvider(yolinkClient, logger),
    hvac: new CieloIFTTTProvider(iftttClient),
    scheduler: new QStashScheduler({
      token: secrets.qstashToken,
      checkStateUrl: "unused", // check-state is no longer in the critical path
      turnOffUrl: config.turnOffUrl,
      logger,
    }),
    stateStore: new RedisStateStore({
      url: secrets.upstashRedisUrl,
      token: secrets.upstashRedisToken,
    }),
    analytics,
    qstashReceiver: createQStashReceiver({
      currentSigningKey: secrets.qstashCurrentSigningKey,
      nextSigningKey: secrets.qstashNextSigningKey,
    }),
    config,
    logger,
  };
}
