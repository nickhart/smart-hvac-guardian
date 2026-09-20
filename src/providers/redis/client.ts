import { Redis } from "@upstash/redis";
import type { StateStore } from "../types.js";
import type { SensorState } from "../../zone-graph/evaluate.js";
import type { Logger } from "../../utils/logger.js";

interface RedisStateStoreOptions {
  url: string;
  token: string;
  tenantId?: string;
  logger?: Logger;
}

export class RedisStateStore implements StateStore {
  private readonly redis: Redis;
  private readonly tenantPrefix: string;
  private readonly logger?: Logger;

  constructor(options: RedisStateStoreOptions) {
    this.redis = new Redis({ url: options.url, token: options.token });
    this.tenantPrefix = options.tenantId ? `${options.tenantId}:` : "";
    this.logger = options.logger;
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

  /**
   * Defaults to **disabled** when the key is absent or unreadable.
   *
   * `system:enabled` is written only by the toggle endpoint — nothing seeds it
   * — so an absent key used to mean enabled. A Redis instance replaced,
   * flushed, migrated, or a changed tenant prefix would then silently switch
   * the system on and start shutting off guests' HVAC, with nothing logged,
   * because from the code's point of view nothing had happened.
   *
   * This matches the safe default the rest of the system already uses: an
   * unknown sensor is treated as closed so the AC stays on. Unknown state must
   * never mean "actuate".
   */
  async getSystemEnabled(): Promise<boolean> {
    const val = await this.redis.get(this.key("system:enabled"));

    if (val === true || val === "true") return true;
    if (val === false || val === "false") return false;

    // Absent, or a value we do not recognise. Say so — a system that is off
    // because nobody turned it on looks identical to one that is off because
    // someone turned it off, and only the log distinguishes them.
    this.logger?.warn("system:enabled is unset or unrecognised — defaulting to disabled", {
      key: this.key("system:enabled"),
      value: val === null || val === undefined ? "absent" : typeof val,
    });
    return false;
  }

  async setSystemEnabled(enabled: boolean): Promise<void> {
    await this.redis.set(this.key("system:enabled"), String(enabled));
  }

  // --- Circuit breaker ---
  // Two keys per circuit: a failure counter (rolling window) and an "open"
  // marker whose TTL is the cooldown. Both expire on their own, so a circuit
  // always heals without anything having to reset it.

  async isCircuitOpen(name: string): Promise<boolean> {
    const val = await this.redis.get(this.key(`circuit:${name}:open`));
    return val !== null && val !== undefined;
  }

  async openCircuit(name: string, cooldownSeconds: number): Promise<void> {
    await this.redis.set(this.key(`circuit:${name}:open`), "1", { ex: cooldownSeconds });
    await this.redis.del(this.key(`circuit:${name}:failures`));
  }

  /** Increment the failure counter and return the new total. */
  async recordCircuitFailure(name: string, windowSeconds: number): Promise<number> {
    const failureKey = this.key(`circuit:${name}:failures`);
    const count = await this.redis.incr(failureKey);
    // Start the window on the first failure so it rolls rather than extending.
    if (count === 1) {
      await this.redis.expire(failureKey, windowSeconds);
    }
    return count;
  }

  async resetCircuit(name: string): Promise<void> {
    await this.redis.del(this.key(`circuit:${name}:failures`));
    await this.redis.del(this.key(`circuit:${name}:open`));
  }

  /** Liveness probe for /api/health. Throws if Redis is unreachable. */
  async ping(): Promise<void> {
    await this.redis.ping();
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
