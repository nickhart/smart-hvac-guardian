import { z } from "zod";

export const InteriorDoorSchema = z.object({
  id: z.string().min(1),
  connectsTo: z.string().min(1),
});

export const ZoneConfigSchema = z.object({
  minisplits: z.array(z.string().min(1)),
  exteriorOpenings: z.array(z.string().min(1)),
  interiorDoors: z.array(InteriorDoorSchema).default([]),
});

export const HVACUnitSchema = z.object({
  name: z.string().min(1),
  iftttEvent: z.string().min(1),
  delaySeconds: z.number().int().positive().default(300),
});

export const YoLinkConfigSchema = z.object({
  baseUrl: z.string().url(),
});

export const AppConfigSchema = z
  .object({
    zones: z.record(z.string(), ZoneConfigSchema),
    sensorDelays: z.record(z.string(), z.number().int().nonnegative()),
    hvacUnits: z.record(z.string(), HVACUnitSchema),
    sensorNames: z.record(z.string(), z.string().min(1)).default({}),
    sensorDefaults: z.record(z.string(), z.enum(["open", "closed"])).default({}),
    yolink: YoLinkConfigSchema,
    turnOffUrl: z.string().url(),
  })
  .refine(
    (config) => {
      // Every minisplit must exist in hvacUnits
      for (const [, zone] of Object.entries(config.zones)) {
        for (const unitId of zone.minisplits) {
          if (!(unitId in config.hvacUnits)) return false;
        }
      }
      return true;
    },
    { message: "Every minisplit in zones must reference a valid hvacUnits key" },
  )
  .refine(
    (config) => {
      // Every sensor in exteriorOpenings and interiorDoors must exist in sensorDelays
      for (const [, zone] of Object.entries(config.zones)) {
        for (const sensorId of zone.exteriorOpenings) {
          if (!(sensorId in config.sensorDelays)) return false;
        }
        for (const door of zone.interiorDoors) {
          if (!(door.id in config.sensorDelays)) return false;
        }
      }
      return true;
    },
    { message: "Every sensor in exteriorOpenings/interiorDoors must exist in sensorDelays" },
  )
  .refine(
    (config) => {
      // Every connectsTo must reference a valid zone
      for (const [, zone] of Object.entries(config.zones)) {
        for (const door of zone.interiorDoors) {
          if (!(door.connectsTo in config.zones)) return false;
        }
      }
      return true;
    },
    { message: "Every interiorDoor connectsTo must reference a valid zone" },
  )
  .refine(
    (config) => {
      // Interior doors must be symmetric: if zone A has door X -> B, then zone B must have door X -> A
      for (const [zoneId, zone] of Object.entries(config.zones)) {
        for (const door of zone.interiorDoors) {
          const otherZone = config.zones[door.connectsTo];
          if (!otherZone) return false;
          const hasMirror = otherZone.interiorDoors.some(
            (d) => d.id === door.id && d.connectsTo === zoneId,
          );
          if (!hasMirror) return false;
        }
      }
      return true;
    },
    { message: "Interior doors must be symmetric (door in zone A→B must also appear in zone B→A)" },
  );

export const EnvSecretsSchema = z.object({
  // Per-tenant credentials — optional when using multi-tenant DB
  yolinkUaCid: z.string().default(""),
  yolinkSecretKey: z.string().default(""),
  iftttWebhookKey: z.string().default(""),
  // Infrastructure secrets — always required
  qstashToken: z.string().min(1),
  qstashCurrentSigningKey: z.string().min(1),
  qstashNextSigningKey: z.string().min(1),
  upstashRedisUrl: z.string().url(),
  upstashRedisToken: z.string().min(1),
  tinybirdToken: z.string().min(1).optional(),
  tinybirdUrl: z.string().url().optional(),
  resendApiKey: z.string().min(1).optional(),
  ownerEmail: z.string().email().optional(),
  appUrl: z.string().url().optional(),
  siteName: z.string().min(1).optional(),
});

export type ZoneConfig = z.infer<typeof ZoneConfigSchema>;
export type HVACUnit = z.infer<typeof HVACUnitSchema>;
export type AppConfig = z.infer<typeof AppConfigSchema>;
export type EnvSecrets = z.infer<typeof EnvSecretsSchema>;
