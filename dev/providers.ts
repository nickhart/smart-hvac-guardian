import type { ServerResponse } from "node:http";
import type {
  StateStore,
  SchedulerProvider,
  HVACProvider,
  SensorProvider,
  AnalyticsProvider,
} from "../src/providers/types.js";
import type { SensorState } from "../src/zone-graph/evaluate.js";
import type { AppConfig } from "../src/config/schema.js";
import type { Receiver } from "@upstash/qstash";

// ---------------------------------------------------------------------------
// DevEventBus — SSE push to connected browser clients
// ---------------------------------------------------------------------------

export class DevEventBus {
  private clients = new Set<ServerResponse>();

  addClient(res: ServerResponse): void {
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "Access-Control-Allow-Origin": "*",
    });
    res.write(":\n\n"); // SSE comment keep-alive
    this.clients.add(res);
    res.on("close", () => this.clients.delete(res));
  }

  emit(type: string, data: unknown): void {
    const payload = `event: ${type}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const client of this.clients) {
      client.write(payload);
    }
  }

  closeAll(): void {
    for (const client of this.clients) {
      client.end();
    }
    this.clients.clear();
  }
}

// ---------------------------------------------------------------------------
// InMemoryStateStore implements StateStore
// ---------------------------------------------------------------------------

interface TimerEntry {
  token: string;
  expireTimeout: ReturnType<typeof setTimeout>;
}

export class InMemoryStateStore implements StateStore {
  private sensors = new Map<string, SensorState>();
  private timers = new Map<string, TimerEntry>();
  private unitDelays = new Map<string, number>();
  private systemEnabled = true;
  private onChange: ((type: string, data: unknown) => void) | undefined;

  constructor(onChange?: (type: string, data: unknown) => void) {
    this.onChange = onChange;
  }

  async setSensorState(sensorId: string, state: SensorState): Promise<void> {
    this.sensors.set(sensorId, state);
    this.onChange?.("sensor-state", { sensorId, state });
  }

  async getAllSensorStates(sensorIds: string[]): Promise<Map<string, SensorState>> {
    const result = new Map<string, SensorState>();
    for (const id of sensorIds) {
      const state = this.sensors.get(id);
      if (state !== undefined) {
        result.set(id, state);
      }
    }
    return result;
  }

  async setTimerToken(hvacUnitId: string, token: string, ttlSeconds: number): Promise<void> {
    // Clear existing timer if any
    const existing = this.timers.get(hvacUnitId);
    if (existing) {
      clearTimeout(existing.expireTimeout);
    }
    const expireTimeout = setTimeout(() => {
      this.timers.delete(hvacUnitId);
      this.onChange?.("timer-expired", { hvacUnitId });
    }, ttlSeconds * 1000);
    // Don't keep the process alive for TTL expiry
    if (expireTimeout.unref) expireTimeout.unref();
    this.timers.set(hvacUnitId, { token, expireTimeout });
    this.onChange?.("timer-set", { hvacUnitId, token, ttlSeconds });
  }

  async getTimerToken(hvacUnitId: string): Promise<string | null> {
    return this.timers.get(hvacUnitId)?.token ?? null;
  }

  async deleteTimerToken(hvacUnitId: string): Promise<void> {
    const existing = this.timers.get(hvacUnitId);
    if (existing) {
      clearTimeout(existing.expireTimeout);
      this.timers.delete(hvacUnitId);
      this.onChange?.("timer-deleted", { hvacUnitId });
    }
  }

  async getActiveTimerUnitIds(): Promise<string[]> {
    return [...this.timers.keys()];
  }

  async getSystemEnabled(): Promise<boolean> {
    return this.systemEnabled;
  }

  async setSystemEnabled(enabled: boolean): Promise<void> {
    this.systemEnabled = enabled;
    this.onChange?.("system-enabled", { enabled });
  }

  async getUnitDelay(hvacUnitId: string): Promise<number | null> {
    return this.unitDelays.get(hvacUnitId) ?? null;
  }

  async setUnitDelay(hvacUnitId: string, delaySeconds: number): Promise<void> {
    this.unitDelays.set(hvacUnitId, delaySeconds);
    this.onChange?.("unit-delay", { hvacUnitId, delaySeconds });
  }

  /** For UI/E2E introspection */
  getSensorSnapshot(): Record<string, SensorState> {
    const result: Record<string, SensorState> = {};
    for (const [k, v] of this.sensors) result[k] = v;
    return result;
  }

  /** Clean up all timers */
  destroy(): void {
    for (const entry of this.timers.values()) {
      clearTimeout(entry.expireTimeout);
    }
    this.timers.clear();
  }
}

// ---------------------------------------------------------------------------
// LocalScheduler implements SchedulerProvider
// ---------------------------------------------------------------------------

interface PendingTimer {
  timeout: ReturnType<typeof setTimeout>;
  hvacUnitId: string;
  cancellationToken: string;
  firesAt: number;
  dedupId: string;
}

export class LocalScheduler implements SchedulerProvider {
  private pendingTimers = new Map<string, PendingTimer>();
  private delayScale: number;
  private baseUrl: string;
  private onChange: ((type: string, data: unknown) => void) | undefined;

  constructor(options: {
    delayScale: number;
    baseUrl: string;
    onChange?: (type: string, data: unknown) => void;
  }) {
    this.delayScale = options.delayScale;
    this.baseUrl = options.baseUrl;
    this.onChange = options.onChange;
  }

  async scheduleDelayedCheck(
    _sensorId: string,
    _delaySeconds: number,
    _deduplicationId?: string,
  ): Promise<void> {
    // Legacy no-op
  }

  async scheduleTurnOff(_deduplicationId: string): Promise<void> {
    // Legacy no-op
  }

  async scheduleUnitTurnOff(
    hvacUnitId: string,
    cancellationToken: string,
    delaySeconds: number,
    deduplicationId: string,
  ): Promise<void> {
    // If same dedupId exists, cancel the old one and reschedule.
    // (In production QStash would dedup, but in the dev simulator we
    // replace so that the latest cancellation token is always honored.)
    const existing = this.pendingTimers.get(deduplicationId);
    if (existing) {
      clearTimeout(existing.timeout);
      this.pendingTimers.delete(deduplicationId);
    }

    const scaledDelay = delaySeconds * this.delayScale;
    const firesAt = Date.now() + scaledDelay * 1000;

    const timeout = setTimeout(async () => {
      this.pendingTimers.delete(deduplicationId);
      this.onChange?.("timer-fired", { hvacUnitId, deduplicationId });
      try {
        await fetch(`${this.baseUrl}/api/hvac-turn-off`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "upstash-signature": "dev-mode-signature",
          },
          body: JSON.stringify({ hvacUnitId, cancellationToken }),
        });
      } catch (err) {
        console.error(`[LocalScheduler] Failed to POST hvac-turn-off for ${hvacUnitId}:`, err);
      }
    }, scaledDelay * 1000);

    this.pendingTimers.set(deduplicationId, {
      timeout,
      hvacUnitId,
      cancellationToken,
      firesAt,
      dedupId: deduplicationId,
    });

    this.onChange?.("timer-scheduled", {
      hvacUnitId,
      deduplicationId,
      delaySeconds,
      scaledDelayMs: scaledDelay * 1000,
      firesAt,
    });
  }

  /** For UI/E2E introspection */
  getPendingTimers(): Array<{
    dedupId: string;
    hvacUnitId: string;
    firesAt: number;
  }> {
    return [...this.pendingTimers.values()].map((t) => ({
      dedupId: t.dedupId,
      hvacUnitId: t.hvacUnitId,
      firesAt: t.firesAt,
    }));
  }

  /** Cancel pending timeout for a specific HVAC unit */
  cancelByUnitId(unitId: string): void {
    for (const [dedupId, entry] of this.pendingTimers) {
      if (entry.hvacUnitId === unitId) {
        clearTimeout(entry.timeout);
        this.pendingTimers.delete(dedupId);
        this.onChange?.("timer-cancelled", { hvacUnitId: unitId, dedupId });
      }
    }
  }

  /** Clear all pending timeouts */
  cancelAll(): void {
    for (const entry of this.pendingTimers.values()) {
      clearTimeout(entry.timeout);
    }
    this.pendingTimers.clear();
  }
}

// ---------------------------------------------------------------------------
// MockHVACProvider implements HVACProvider
// ---------------------------------------------------------------------------

interface HVACLogEntry {
  timestamp: string;
  iftttEvent: string;
  unitId: string | null;
}

export class MockHVACProvider implements HVACProvider {
  private unitStates = new Map<string, "on" | "off">();
  private eventLog: HVACLogEntry[] = [];
  private config: AppConfig;
  private onChange: ((type: string, data: unknown) => void) | undefined;

  constructor(config: AppConfig, onChange?: (type: string, data: unknown) => void) {
    this.config = config;
    this.onChange = onChange;
    // Initialize all units to 'on'
    for (const unitId of Object.keys(config.hvacUnits)) {
      this.unitStates.set(unitId, "on");
    }
  }

  async turnOff(iftttEvent: string): Promise<void> {
    // Reverse-look up unit ID from config
    let unitId: string | null = null;
    for (const [id, unit] of Object.entries(this.config.hvacUnits)) {
      if (unit.iftttEvent === iftttEvent) {
        unitId = id;
        break;
      }
    }

    if (unitId) {
      this.unitStates.set(unitId, "off");
    }

    const entry: HVACLogEntry = {
      timestamp: new Date().toISOString(),
      iftttEvent,
      unitId,
    };
    this.eventLog.push(entry);
    this.onChange?.("hvac-turn-off", entry);
  }

  setUnitState(unitId: string, state: "on" | "off"): void {
    this.unitStates.set(unitId, state);
    this.onChange?.("hvac-state", { unitId, state });
  }

  getUnitStates(): Map<string, "on" | "off"> {
    return new Map(this.unitStates);
  }

  getUnitStatesSnapshot(): Record<string, "on" | "off"> {
    const result: Record<string, "on" | "off"> = {};
    for (const [k, v] of this.unitStates) result[k] = v;
    return result;
  }

  getEventLog(): HVACLogEntry[] {
    return [...this.eventLog];
  }
}

// ---------------------------------------------------------------------------
// MockSensorProvider — not used by dev server (sensor state comes from
// StateStore via the handler) but needed to satisfy Dependencies.sensor
// ---------------------------------------------------------------------------

export class MockSensorProvider implements SensorProvider {
  async getState(_sensorId: string): Promise<"open" | "closed" | "unknown"> {
    return "unknown";
  }
}

// ---------------------------------------------------------------------------
// mockQStashReceiver — always verifies successfully
// ---------------------------------------------------------------------------

export const mockQStashReceiver = {
  verify: async () => true,
} as unknown as Receiver;

// ---------------------------------------------------------------------------
// NoopAnalyticsProvider — no-op for dev server
// ---------------------------------------------------------------------------

export class NoopAnalyticsProvider implements AnalyticsProvider {
  async trackSensorEvent(): Promise<void> {}
  async trackHvacCommand(): Promise<void> {}
  async trackHvacStateEvent(): Promise<void> {}
}
