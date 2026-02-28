import type { AnalyticsProvider } from "../types.js";

export class TinybirdAnalyticsProvider implements AnalyticsProvider {
  private baseUrl: string;
  private token: string;
  private tenantId?: string;

  constructor(options: { baseUrl: string; token: string; tenantId?: string }) {
    this.baseUrl = options.baseUrl.replace(/\/$/, "");
    this.token = options.token;
    this.tenantId = options.tenantId;
  }

  async trackSensorEvent(
    data: Parameters<AnalyticsProvider["trackSensorEvent"]>[0],
  ): Promise<void> {
    await this.ingest("sensor_events", {
      timestamp: new Date().toISOString(),
      request_id: data.requestId,
      sensor_id: data.sensorId,
      event: data.event,
      exposed_units: data.exposedUnits,
      unexposed_units: data.unexposedUnits,
      timers_scheduled: data.timersScheduled,
      timers_cancelled: data.timersCancelled,
      ...(this.tenantId ? { tenant_id: this.tenantId } : {}),
    });
  }

  async trackHvacCommand(
    data: Parameters<AnalyticsProvider["trackHvacCommand"]>[0],
  ): Promise<void> {
    await this.ingest("hvac_commands", {
      timestamp: new Date().toISOString(),
      request_id: data.requestId,
      hvac_unit_id: data.hvacUnitId,
      unit_name: data.unitName,
      action: data.action,
      trigger_source: data.triggerSource,
      delay_seconds: data.delaySeconds ?? null,
      ifttt_event: data.iftttEvent ?? null,
      ...(this.tenantId ? { tenant_id: this.tenantId } : {}),
    });
  }

  async trackHvacStateEvent(
    data: Parameters<AnalyticsProvider["trackHvacStateEvent"]>[0],
  ): Promise<void> {
    await this.ingest("hvac_state_events", {
      timestamp: new Date().toISOString(),
      request_id: data.requestId,
      hvac_id: data.hvacId,
      event: data.event,
      was_exposed: data.wasExposed ? 1 : 0,
      turnoff_scheduled: data.turnoffScheduled ? 1 : 0,
      ...(this.tenantId ? { tenant_id: this.tenantId } : {}),
    });
  }

  private async ingest(datasource: string, payload: Record<string, unknown>): Promise<void> {
    try {
      await fetch(`${this.baseUrl}/v0/events?name=${datasource}`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });
    } catch {
      // Analytics failures must never break the HVAC control path
      console.warn(`[Tinybird] Failed to ingest to ${datasource}`);
    }
  }
}
