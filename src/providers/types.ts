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
}
