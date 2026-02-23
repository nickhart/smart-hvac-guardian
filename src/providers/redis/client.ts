import { Redis } from "@upstash/redis";
import type { StateStore } from "../types.js";
import type { SensorState } from "../../zone-graph/evaluate.js";

interface RedisStateStoreOptions {
  url: string;
  token: string;
}

export class RedisStateStore implements StateStore {
  private readonly redis: Redis;

  constructor(options: RedisStateStoreOptions) {
    this.redis = new Redis({ url: options.url, token: options.token });
  }

  async setSensorState(sensorId: string, state: SensorState): Promise<void> {
    await this.redis.set(`sensor:${sensorId}`, state);
  }

  async getAllSensorStates(sensorIds: string[]): Promise<Map<string, SensorState>> {
    if (sensorIds.length === 0) return new Map();

    const keys = sensorIds.map((id) => `sensor:${id}`);
    const values = await this.redis.mget<(string | null)[]>(...keys);
    const result = new Map<string, SensorState>();

    for (let i = 0; i < sensorIds.length; i++) {
      const val = values[i];
      if (val === "open" || val === "closed") {
        result.set(sensorIds[i], val);
      }
    }

    return result;
  }

  async setTimerToken(hvacUnitId: string, token: string, ttlSeconds: number): Promise<void> {
    await this.redis.set(`timer:${hvacUnitId}`, token, { ex: ttlSeconds });
  }

  async getTimerToken(hvacUnitId: string): Promise<string | null> {
    return this.redis.get<string>(`timer:${hvacUnitId}`);
  }

  async deleteTimerToken(hvacUnitId: string): Promise<void> {
    await this.redis.del(`timer:${hvacUnitId}`);
  }

  async getSystemEnabled(): Promise<boolean> {
    const val = await this.redis.get<string>("system:enabled");
    return val !== "false";
  }

  async setSystemEnabled(enabled: boolean): Promise<void> {
    await this.redis.set("system:enabled", enabled ? "true" : "false");
  }

  // --- Auth helpers (not part of StateStore interface) ---

  async setOtp(email: string, code: string, ttlSeconds: number): Promise<void> {
    await this.redis.set(`otp:${email}`, code, { ex: ttlSeconds });
  }

  async getOtp(email: string): Promise<string | null> {
    return this.redis.get<string>(`otp:${email}`);
  }

  async deleteOtp(email: string): Promise<void> {
    await this.redis.del(`otp:${email}`);
  }

  async setSession(token: string, email: string, ttlSeconds: number): Promise<void> {
    await this.redis.set(`session:${token}`, email, { ex: ttlSeconds });
  }

  async getSession(token: string): Promise<string | null> {
    return this.redis.get<string>(`session:${token}`);
  }

  async deleteSession(token: string): Promise<void> {
    await this.redis.del(`session:${token}`);
  }

  async getUnitDelay(hvacUnitId: string): Promise<number | null> {
    const val = await this.redis.get<number>(`delay:${hvacUnitId}`);
    return val ?? null;
  }

  async setUnitDelay(hvacUnitId: string, delaySeconds: number): Promise<void> {
    await this.redis.set(`delay:${hvacUnitId}`, delaySeconds);
  }

  async getActiveTimerUnitIds(): Promise<string[]> {
    const keys: string[] = [];
    let cursor = "0";

    do {
      const result: [string, string[]] = await this.redis.scan(cursor, {
        match: "timer:*",
        count: 100,
      });
      cursor = result[0];
      keys.push(...result[1]);
    } while (cursor !== "0");

    return keys.map((k) => k.replace("timer:", ""));
  }
}
