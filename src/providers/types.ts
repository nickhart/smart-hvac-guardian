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
  }): Promise<void>;

  trackHvacCommand(data: {
    requestId: string;
    hvacUnitId: string;
    unitName: string;
    action: "turned_off" | "cancelled" | "scheduled";
    triggerSource: "sensor_open" | "hvac_on";
    delaySeconds?: number;
    iftttEvent?: string;
  }): Promise<void>;

  trackHvacStateEvent(data: {
    requestId: string;
    hvacId: string;
    event: "on" | "off";
    wasExposed: boolean;
    turnoffScheduled: boolean;
  }): Promise<void>;
}

export interface AuthStore {
  setOtp(email: string, code: string, ttlSeconds: number): Promise<void>;
  getOtp(email: string): Promise<string | null>;
  deleteOtp(email: string): Promise<void>;
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
  getUnitDelay(hvacUnitId: string): Promise<number | null>;
  setUnitDelay(hvacUnitId: string, delaySeconds: number): Promise<void>;
}
