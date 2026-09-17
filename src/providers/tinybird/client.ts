import type { AnalyticsProvider } from "../types.js";

/** Analytics must never be slower than the control path it instruments. */
const INGEST_TIMEOUT_MS = 2000;

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
    await this.ingest("sensor_events_v2", {
      timestamp: new Date().toISOString(),
      request_id: data.requestId,
      sensor_id: data.sensorId,
      event: data.event,
      exposed_units: data.exposedUnits,
      unexposed_units: data.unexposedUnits,
      timers_scheduled: data.timersScheduled,
      timers_cancelled: data.timersCancelled,
      shutoff_enabled: data.shutoffEnabled ? 1 : 0,
      ...(this.tenantId ? { tenant_id: this.tenantId } : {}),
    });
  }

  async trackHvacCommand(
    data: Parameters<AnalyticsProvider["trackHvacCommand"]>[0],
  ): Promise<void> {
    await this.ingest("hvac_commands_v2", {
      timestamp: new Date().toISOString(),
      request_id: data.requestId,
      hvac_unit_id: data.hvacUnitId,
      unit_name: data.unitName,
      action: data.action,
      trigger_source: data.triggerSource,
      delay_seconds: data.delaySeconds ?? null,
      ifttt_event: data.iftttEvent ?? null,
      shutoff_enabled: data.shutoffEnabled ? 1 : 0,
      ...(this.tenantId ? { tenant_id: this.tenantId } : {}),
    });
  }

  async trackHvacStateEvent(
    data: Parameters<AnalyticsProvider["trackHvacStateEvent"]>[0],
  ): Promise<void> {
    await this.ingest("hvac_state_events_v2", {
      timestamp: new Date().toISOString(),
      request_id: data.requestId,
      hvac_id: data.hvacId,
      event: data.event,
      was_exposed: data.wasExposed ? 1 : 0,
      turnoff_scheduled: data.turnoffScheduled ? 1 : 0,
      shutoff_enabled: data.shutoffEnabled ? 1 : 0,
      ...(this.tenantId ? { tenant_id: this.tenantId } : {}),
    });
  }

  async trackProviderEvent(
    data: Parameters<AnalyticsProvider["trackProviderEvent"]>[0],
  ): Promise<void> {
    await this.ingest("provider_events_v2", {
      timestamp: new Date().toISOString(),
      provider: data.provider,
      operation: data.operation,
      outcome: data.outcome,
      duration_ms: data.durationMs ?? null,
      status_code: data.statusCode ?? null,
      error_message: data.errorMessage ?? null,
      terminal: data.terminal ? 1 : 0,
      request_id: data.requestId ?? "",
      ...(this.tenantId ? { tenant_id: this.tenantId } : {}),
    });
  }

  private async ingest(datasource: string, payload: Record<string, unknown>): Promise<void> {
    // Analytics failures must never break the HVAC control path, so everything
    // here is swallowed — but the reason is logged. `fetch` does not reject on
    // a non-2xx, so the status is checked explicitly: a bad token or an unknown
    // datasource would otherwise look exactly like a successful ingest.
    try {
      const response = await fetch(`${this.baseUrl}/v0/events?name=${datasource}`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
        // Bounded so analytics can never stall the HVAC control path: these
        // calls are awaited before the handler responds, and a hung request
        // would let the function time out, which QStash reads as a failure and
        // retries — firing a duplicate turn-off.
        signal: AbortSignal.timeout(INGEST_TIMEOUT_MS),
      });

      if (!response.ok) {
        console.warn(`[Tinybird] Ingest to ${datasource} rejected: HTTP ${response.status}`);
      }
    } catch (error) {
      console.warn(
        `[Tinybird] Ingest to ${datasource} failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}
