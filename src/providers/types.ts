import type { SensorState as ZoneSensorState } from "../zone-graph/evaluate.js";

export type SensorState = "open" | "closed" | "unknown";

export interface SensorProvider {
  getState(sensorId: string): Promise<SensorState>;
}

export interface HVACProvider {
  turnOff(iftttEvent: string): Promise<void>;
}

export interface SchedulerProvider {
  scheduleDelayedCheck(
    sensorId: string,
    delaySeconds: number,
    deduplicationId?: string,
  ): Promise<void>;
  scheduleTurnOff(deduplicationId: string): Promise<void>;
  scheduleUnitTurnOff(
    hvacUnitId: string,
    cancellationToken: string,
    delaySeconds: number,
    deduplicationId: string,
  ): Promise<void>;
}

export interface AnalyticsProvider {
  trackSensorEvent(data: {
    requestId: string;
    sensorId: string;
    event: "open" | "close";
    exposedUnits: string[];
    unexposedUnits: string[];
    timersScheduled: string[];
    timersCancelled: string[];
    /** False when the decision was made in shadow mode and not executed. */
    shutoffEnabled: boolean;
  }): Promise<void>;

  trackHvacCommand(data: {
    requestId: string;
    hvacUnitId: string;
    unitName: string;
    action: "turned_off" | "cancelled" | "scheduled";
    triggerSource: "sensor_open" | "hvac_on";
    delaySeconds?: number;
    iftttEvent?: string;
    /** False when the decision was made in shadow mode and not executed. */
    shutoffEnabled: boolean;
  }): Promise<void>;

  /**
   * Provider health, as opposed to business events: did a call to an external
   * service succeed, fail, or get skipped because its circuit was open.
   */
  trackProviderEvent(data: {
    provider: "ifttt" | "yolink" | "qstash" | "redis" | "resend";
    operation: string;
    outcome: "ok" | "failed" | "skipped_circuit_open";
    durationMs?: number;
    statusCode?: number;
    errorMessage?: string;
    terminal?: boolean;
    requestId?: string;
  }): Promise<void>;

  trackHvacStateEvent(data: {
    requestId: string;
    hvacId: string;
    event: "on" | "off";
    wasExposed: boolean;
    turnoffScheduled: boolean;
    /** False when the decision was made in shadow mode and not executed. */
    shutoffEnabled: boolean;
  }): Promise<void>;
}

export interface AuthStore {
  setMagicToken(token: string, email: string, ttlSeconds: number): Promise<void>;
  getMagicToken(token: string): Promise<string | null>;
  deleteMagicToken(token: string): Promise<void>;
  setSession(token: string, email: string, ttlSeconds: number): Promise<void>;
  getSession(token: string): Promise<string | null>;
  deleteSession(token: string): Promise<void>;
}

export interface StateStore {
  setSensorState(sensorId: string, state: ZoneSensorState): Promise<void>;
  getAllSensorStates(sensorIds: string[]): Promise<Map<string, ZoneSensorState>>;
  setTimerToken(hvacUnitId: string, token: string, ttlSeconds: number): Promise<void>;
  getTimerToken(hvacUnitId: string): Promise<string | null>;
  deleteTimerToken(hvacUnitId: string): Promise<void>;
  getActiveTimerUnitIds(): Promise<string[]>;
  getSystemEnabled(): Promise<boolean>;
  setSystemEnabled(enabled: boolean): Promise<void>;
  isCircuitOpen(name: string): Promise<boolean>;
  openCircuit(name: string, cooldownSeconds: number): Promise<void>;
  recordCircuitFailure(name: string, windowSeconds: number): Promise<number>;
  resetCircuit(name: string): Promise<void>;
  getUnitDelay(hvacUnitId: string): Promise<number | null>;
  setUnitDelay(hvacUnitId: string, delaySeconds: number): Promise<void>;
}
