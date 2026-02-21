import { z } from "zod";

export const SensorConfigSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  delaySeconds: z.number().int().positive(),
});

export const HVACUnitSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  iftttEvent: z.string().min(1),
});

export const YoLinkConfigSchema = z.object({
  baseUrl: z.string().url(),
});

export const AppConfigSchema = z.object({
  sensors: z.array(SensorConfigSchema).min(1),
  hvacUnits: z.array(HVACUnitSchema).min(1),
  yolink: YoLinkConfigSchema,
  checkStateUrl: z.string().url(),
});

export const EnvSecretsSchema = z.object({
  yolinkUaCid: z.string().min(1),
  yolinkSecretKey: z.string().min(1),
  iftttWebhookKey: z.string().min(1),
  qstashToken: z.string().min(1),
  qstashCurrentSigningKey: z.string().min(1),
  qstashNextSigningKey: z.string().min(1),
});

export type SensorConfig = z.infer<typeof SensorConfigSchema>;
export type HVACUnit = z.infer<typeof HVACUnitSchema>;
export type AppConfig = z.infer<typeof AppConfigSchema>;
export type EnvSecrets = z.infer<typeof EnvSecretsSchema>;
