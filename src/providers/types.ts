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

export interface StateStore {
  setSensorState(sensorId: string, state: ZoneSensorState): Promise<void>;
  getAllSensorStates(sensorIds: string[]): Promise<Map<string, ZoneSensorState>>;
  setTimerToken(hvacUnitId: string, token: string, ttlSeconds: number): Promise<void>;
  getTimerToken(hvacUnitId: string): Promise<string | null>;
  deleteTimerToken(hvacUnitId: string): Promise<void>;
  getActiveTimerUnitIds(): Promise<string[]>;
}
