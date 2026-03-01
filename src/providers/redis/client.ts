import { Redis } from "@upstash/redis";
import type { StateStore } from "../types.js";
import type { SensorState } from "../../zone-graph/evaluate.js";

interface RedisStateStoreOptions {
  url: string;
  token: string;
  tenantId?: string;
}

export class RedisStateStore implements StateStore {
  private readonly redis: Redis;
  private readonly tenantPrefix: string;

  constructor(options: RedisStateStoreOptions) {
    this.redis = new Redis({ url: options.url, token: options.token });
    this.tenantPrefix = options.tenantId ? `${options.tenantId}:` : "";
  }

  /** Prefix a state key with tenantId. Auth keys (magic/session) stay global. */
  private key(base: string): string {
    return `${this.tenantPrefix}${base}`;
  }

  async setSensorState(sensorId: string, state: SensorState): Promise<void> {
    await this.redis.set(this.key(`sensor:${sensorId}`), state);
  }

  async getAllSensorStates(sensorIds: string[]): Promise<Map<string, SensorState>> {
    if (sensorIds.length === 0) return new Map();

    const keys = sensorIds.map((id) => this.key(`sensor:${id}`));
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
    await this.redis.set(this.key(`timer:${hvacUnitId}`), token, { ex: ttlSeconds });
  }

  async getTimerToken(hvacUnitId: string): Promise<string | null> {
    return this.redis.get<string>(this.key(`timer:${hvacUnitId}`));
  }

  async deleteTimerToken(hvacUnitId: string): Promise<void> {
    await this.redis.del(this.key(`timer:${hvacUnitId}`));
  }

  async getSystemEnabled(): Promise<boolean> {
    const val = await this.redis.get(this.key("system:enabled"));
    if (val === false || val === "false") return false;
    return true;
  }

  async setSystemEnabled(enabled: boolean): Promise<void> {
    await this.redis.set(this.key("system:enabled"), String(enabled));
  }

  // --- Auth helpers (not part of StateStore interface) ---
  // Auth keys are GLOBAL (no tenant prefix) — sessions/magic tokens are cross-tenant.

  async setMagicToken(token: string, email: string, ttlSeconds: number): Promise<void> {
    await this.redis.set(`magic:${token}`, email, { ex: ttlSeconds });
  }

  async getMagicToken(token: string): Promise<string | null> {
    return this.redis.get<string>(`magic:${token}`);
  }

  async deleteMagicToken(token: string): Promise<void> {
    await this.redis.del(`magic:${token}`);
  }

  async setSession(token: string, value: string, ttlSeconds: number): Promise<void> {
    await this.redis.set(`session:${token}`, value, { ex: ttlSeconds });
  }

  async getSession(token: string): Promise<string | null> {
    return this.redis.get<string>(`session:${token}`);
  }

  async deleteSession(token: string): Promise<void> {
    await this.redis.del(`session:${token}`);
  }

  async getUnitDelay(hvacUnitId: string): Promise<number | null> {
    const val = await this.redis.get<number>(this.key(`delay:${hvacUnitId}`));
    return val ?? null;
  }

  async setUnitDelay(hvacUnitId: string, delaySeconds: number): Promise<void> {
    await this.redis.set(this.key(`delay:${hvacUnitId}`), delaySeconds);
  }

  async deleteUnitDelay(hvacUnitId: string): Promise<void> {
    await this.redis.del(this.key(`delay:${hvacUnitId}`));
  }

  async getActiveTimerUnitIds(): Promise<string[]> {
    const keys: string[] = [];
    let cursor = "0";
    const pattern = this.key("timer:*");

    do {
      const result: [string, string[]] = await this.redis.scan(cursor, {
        match: pattern,
        count: 100,
      });
      cursor = result[0];
      keys.push(...result[1]);
    } while (cursor !== "0");

    const prefix = this.key("timer:");
    return keys.map((k) => k.slice(prefix.length));
  }
}
