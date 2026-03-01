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
  )
  .refine(
    (config) => {
      // Each exterior sensor must appear in exactly one zone (not 2+)
      const counts = new Map<string, number>();
      for (const zone of Object.values(config.zones)) {
        for (const sensorId of zone.exteriorOpenings) {
          counts.set(sensorId, (counts.get(sensorId) ?? 0) + 1);
        }
      }
      for (const count of counts.values()) {
        if (count > 1) return false;
      }
      return true;
    },
    { message: "Each exterior sensor must belong to exactly one zone" },
  )
  .refine(
    (config) => {
      // Each interior door sensor must appear in exactly two zones
      const counts = new Map<string, number>();
      for (const zone of Object.values(config.zones)) {
        for (const door of zone.interiorDoors) {
          counts.set(door.id, (counts.get(door.id) ?? 0) + 1);
        }
      }
      for (const count of counts.values()) {
        if (count !== 2) return false;
      }
      return true;
    },
    { message: "Each interior door sensor must appear in exactly two zones" },
  )
  .refine(
    (config) => {
      // Every HVAC unit must be assigned to exactly one zone
      const assigned = new Map<string, number>();
      for (const unitId of Object.keys(config.hvacUnits)) {
        assigned.set(unitId, 0);
      }
      for (const zone of Object.values(config.zones)) {
        for (const unitId of zone.minisplits) {
          assigned.set(unitId, (assigned.get(unitId) ?? 0) + 1);
        }
      }
      for (const count of assigned.values()) {
        if (count !== 1) return false;
      }
      return true;
    },
    { message: "Every HVAC unit must be assigned to exactly one zone" },
  )
  .refine(
    (config) => {
      // No duplicate HVAC unit names (case-insensitive)
      const names = new Set<string>();
      for (const unit of Object.values(config.hvacUnits)) {
        const lower = unit.name.toLowerCase();
        if (names.has(lower)) return false;
        names.add(lower);
      }
      return true;
    },
    { message: "HVAC unit names must be unique (case-insensitive)" },
  )
  .refine(
    (config) => {
      // Every sensor in sensorDelays must be referenced in some zone
      const usedSensors = new Set<string>();
      for (const zone of Object.values(config.zones)) {
        for (const sensorId of zone.exteriorOpenings) {
          usedSensors.add(sensorId);
        }
        for (const door of zone.interiorDoors) {
          usedSensors.add(door.id);
        }
      }
      for (const sensorId of Object.keys(config.sensorDelays)) {
        if (!usedSensors.has(sensorId)) return false;
      }
      return true;
    },
    { message: "Every sensor in sensorDelays must be used in at least one zone" },
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
