import type { SensorState as ZoneSensorState } from "../zone-graph/evaluate.js";

export type SensorState = "open" | "closed" | "unknown";

export interface SensorProvider {
  getState(sensorId: string): Promise<SensorState>;
}

export interface HVACProvider {
  /**
   * `requestId` ties the provider event this records back to the command that
   * caused it. Required rather than optional: every caller has one, and without
   * it provider_events_v2 cannot be joined to hvac_commands_v2 at all — which
   * was the case for every IFTTT event recorded before this was added.
   */
  turnOff(iftttEvent: string, requestId: string): Promise<void>;
}

export interface SchedulerProvider {
  scheduleDelayedCheck(
    sensorId: string,
    delaySeconds: number,
    deduplicationId?: string,
  ): Promise<void>;
  scheduleTurnOff(deduplicationId: string): Promise<void>;
  /**
   * The deduplication id is derived from the cancellation token rather than
   * passed in. Callers previously built it from a wall-clock bucket, which made
   * every re-exposure of a unit within ten minutes collide with the previous
   * one and be silently dropped.
   */
  scheduleUnitTurnOff(
    hvacUnitId: string,
    cancellationToken: string,
    delaySeconds: number,
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
    /**
     * `cancelled`: the door closed inside the delay, which is the timer doing
     * its job — a guest-behaviour signal.
     * `superseded`: the door reopened while this timer was still in flight, so a
     * newer one replaced it. Timer churn, unrelated to guest behaviour, and
     * worth separating because it accounted for 39% of schedules in the first
     * week and was inflating the cancellation rate.
     * `aborted_stale_state`: the devices said the exposure was already over.
     * `rearmed`: the timer was gone but the unit was still exposed, so a fresh
     * one was scheduled rather than letting the door go unwatched.
     */
    action:
      | "turned_off"
      | "cancelled"
      | "superseded"
      | "scheduled"
      | "aborted_stale_state"
      | "rearmed";
    triggerSource: "sensor_open" | "hvac_on";
    delaySeconds?: number;
    /**
     * How far past its intended fire time a message arrived. Only meaningful on
     * `rearmed`, where it says whether the token buffer is slightly too tight
     * or delivery is badly delayed — two problems with different remedies.
     */
    lateBySeconds?: number;
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

  /**
   * Reconciliation of our webhook-derived belief about a sensor against the
   * device's own reported state. Written for agreements too, so the drift rate
   * has a denominator.
   */
  trackSensorStateDrift(data: {
    requestId: string;
    sensorId: string;
    /** What our webhook-derived state says. */
    believedState: string;
    /** What the device itself reports. */
    actualState: string;
    agreed: boolean;
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
