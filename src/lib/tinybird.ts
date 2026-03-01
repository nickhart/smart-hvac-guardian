/**
 * Tinybird Definitions
 *
 * Data sources and endpoints for HVAC analytics.
 */

import {
  defineDatasource,
  defineEndpoint,
  Tinybird,
  node,
  t,
  p,
  engine,
  type InferRow,
  type InferParams,
  type InferOutputRow,
} from "@tinybirdco/sdk";

// ============================================================================
// Datasources
// ============================================================================

export const sensorEvents = defineDatasource("sensor_events_v2", {
  description: "Door/window sensor open/close events (v2 with tenant_id)",
  schema: {
    timestamp: t.dateTime(),
    request_id: t.string(),
    tenant_id: t.string(),
    sensor_id: t.string(),
    event: t.string(),
    exposed_units: t.array(t.string()).jsonPath("$.exposed_units[:]"),
    unexposed_units: t.array(t.string()).jsonPath("$.unexposed_units[:]"),
    timers_scheduled: t.array(t.string()).jsonPath("$.timers_scheduled[:]"),
    timers_cancelled: t.array(t.string()).jsonPath("$.timers_cancelled[:]"),
  },
  engine: engine.mergeTree({
    sortingKey: ["tenant_id", "timestamp", "sensor_id"],
  }),
});

export type SensorEventsRow = InferRow<typeof sensorEvents>;

export const hvacCommands = defineDatasource("hvac_commands_v2", {
  description: "HVAC turn-off, cancellation, and scheduling commands (v2 with tenant_id)",
  schema: {
    timestamp: t.dateTime(),
    request_id: t.string(),
    tenant_id: t.string(),
    hvac_unit_id: t.string(),
    unit_name: t.string(),
    action: t.string(),
    trigger_source: t.string(),
    delay_seconds: t.int32().nullable(),
    ifttt_event: t.string().nullable(),
  },
  engine: engine.mergeTree({
    sortingKey: ["tenant_id", "timestamp", "hvac_unit_id"],
  }),
});

export type HvacCommandsRow = InferRow<typeof hvacCommands>;

export const hvacStateEvents = defineDatasource("hvac_state_events_v2", {
  description: "HVAC unit on/off state change events (v2 with tenant_id)",
  schema: {
    timestamp: t.dateTime(),
    request_id: t.string(),
    tenant_id: t.string(),
    hvac_id: t.string(),
    event: t.string(),
    was_exposed: t.uint8(),
    turnoff_scheduled: t.uint8(),
  },
  engine: engine.mergeTree({
    sortingKey: ["tenant_id", "timestamp", "hvac_id"],
  }),
});

export type HvacStateEventsRow = InferRow<typeof hvacStateEvents>;

// ============================================================================
// Endpoints
// ============================================================================

export const shutoffsPerDay = defineEndpoint("shutoffs_per_day", {
  description: "Daily count of HVAC shutoffs with affected units",
  params: {
    start_date: p.string().optional("2024-01-01").describe("Start date (YYYY-MM-DD)"),
    end_date: p.string().optional("2099-12-31").describe("End date (YYYY-MM-DD)"),
    tenant_id: p.string().optional("").describe("Filter by tenant ID (empty = all)"),
  },
  nodes: [
    node({
      name: "aggregated",
      sql: `
        SELECT
          toDate(timestamp) AS day,
          count() AS shutoff_count,
          groupUniqArray(hvac_unit_id) AS units_affected,
          groupUniqArray(trigger_source) AS trigger_sources
        FROM hvac_commands_v2
        WHERE action = 'turned_off'
          AND timestamp >= parseDateTimeBestEffort({{String(start_date, '2024-01-01')}})
          AND timestamp <= parseDateTimeBestEffort({{String(end_date, '2099-12-31')}})
          AND ({{String(tenant_id, '')}} = '' OR tenant_id = {{String(tenant_id, '')}})
        GROUP BY day
        ORDER BY day DESC
      `,
    }),
  ],
  output: {
    day: t.date(),
    shutoff_count: t.uint64(),
    units_affected: t.array(t.string()),
    trigger_sources: t.array(t.string()),
  },
});

export type ShutoffsPerDayParams = InferParams<typeof shutoffsPerDay>;
export type ShutoffsPerDayOutput = InferOutputRow<typeof shutoffsPerDay>;

export const sensorTriggerFrequency = defineEndpoint("sensor_trigger_frequency", {
  description: "How often each sensor fires open events",
  params: {
    start_date: p.string().optional("2024-01-01").describe("Start date (YYYY-MM-DD)"),
    tenant_id: p.string().optional("").describe("Filter by tenant ID (empty = all)"),
  },
  nodes: [
    node({
      name: "aggregated",
      sql: `
        SELECT
          sensor_id,
          count() AS open_count,
          min(timestamp) AS first_seen,
          max(timestamp) AS last_seen
        FROM sensor_events_v2
        WHERE event = 'open'
          AND timestamp >= parseDateTimeBestEffort({{String(start_date, '2024-01-01')}})
          AND ({{String(tenant_id, '')}} = '' OR tenant_id = {{String(tenant_id, '')}})
        GROUP BY sensor_id
        ORDER BY open_count DESC
      `,
    }),
  ],
  output: {
    sensor_id: t.string(),
    open_count: t.uint64(),
    first_seen: t.dateTime(),
    last_seen: t.dateTime(),
  },
});

export type SensorTriggerFrequencyParams = InferParams<typeof sensorTriggerFrequency>;
export type SensorTriggerFrequencyOutput = InferOutputRow<typeof sensorTriggerFrequency>;

export const recentActivity = defineEndpoint("recent_activity", {
  description: "Recent sensor events in reverse chronological order",
  params: {
    start_date: p.string().optional("2024-01-01").describe("Start date (YYYY-MM-DD)"),
    limit: p.int32().optional(50).describe("Max rows to return"),
    tenant_id: p.string().optional("").describe("Filter by tenant ID (empty = all)"),
  },
  nodes: [
    node({
      name: "recent",
      sql: `
        SELECT
          timestamp,
          'sensor' AS event_type,
          sensor_id AS entity_id,
          event AS action,
          exposed_units,
          timers_scheduled,
          timers_cancelled
        FROM sensor_events_v2
        WHERE timestamp >= parseDateTimeBestEffort({{String(start_date, '2024-01-01')}})
          AND ({{String(tenant_id, '')}} = '' OR tenant_id = {{String(tenant_id, '')}})
        ORDER BY timestamp DESC
        LIMIT {{Int32(limit, 50)}}
      `,
    }),
  ],
  output: {
    timestamp: t.dateTime(),
    event_type: t.string(),
    entity_id: t.string(),
    action: t.string(),
    exposed_units: t.array(t.string()),
    timers_scheduled: t.array(t.string()),
    timers_cancelled: t.array(t.string()),
  },
});

export type RecentActivityParams = InferParams<typeof recentActivity>;
export type RecentActivityOutput = InferOutputRow<typeof recentActivity>;

export const exposureDuration = defineEndpoint("exposure_duration", {
  description: "Duration each HVAC unit was exposed to open exterior openings",
  params: {
    start_date: p.string().optional("2024-01-01").describe("Start date (YYYY-MM-DD)"),
    end_date: p.string().optional("2099-12-31").describe("End date (YYYY-MM-DD)"),
    hvac_unit_id_filter: p.string().optional("").describe("Filter by HVAC unit ID (empty = all)"),
    tenant_id: p.string().optional("").describe("Filter by tenant ID (empty = all)"),
  },
  nodes: [
    node({
      name: "open_events_node",
      sql: `
        SELECT
          timestamp AS opened_at,
          arrayJoin(exposed_units) AS hvac_unit_id
        FROM sensor_events_v2
        WHERE length(exposed_units) > 0
          AND timestamp >= parseDateTimeBestEffort({{String(start_date, '2024-01-01')}})
          AND timestamp <= parseDateTimeBestEffort({{String(end_date, '2099-12-31')}})
          AND ({{String(hvac_unit_id_filter, '')}} = '' OR has(exposed_units, {{String(hvac_unit_id_filter, '')}}))
          AND ({{String(tenant_id, '')}} = '' OR tenant_id = {{String(tenant_id, '')}})
      `,
    }),
    node({
      name: "close_events_node",
      sql: `
        SELECT
          timestamp AS closed_at,
          arrayJoin(unexposed_units) AS hvac_unit_id
        FROM sensor_events_v2
        WHERE length(unexposed_units) > 0
          AND timestamp >= parseDateTimeBestEffort({{String(start_date, '2024-01-01')}})
          AND timestamp <= parseDateTimeBestEffort({{String(end_date, '2099-12-31')}})
          AND ({{String(tenant_id, '')}} = '' OR tenant_id = {{String(tenant_id, '')}})
      `,
    }),
    node({
      name: "exposure_sessions",
      sql: `
        SELECT
          o.hvac_unit_id,
          o.opened_at,
          min(c.closed_at) AS closed_at,
          dateDiff('minute', o.opened_at, min(c.closed_at)) AS duration_minutes
        FROM open_events_node o
        ASOF LEFT JOIN close_events_node c
          ON o.hvac_unit_id = c.hvac_unit_id
          AND c.closed_at >= o.opened_at
        GROUP BY o.hvac_unit_id, o.opened_at
        ORDER BY o.opened_at DESC
      `,
    }),
  ],
  output: {
    hvac_unit_id: t.string(),
    opened_at: t.dateTime(),
    closed_at: t.dateTime().nullable(),
    duration_minutes: t.int32(),
  },
});

export type ExposureDurationParams = InferParams<typeof exposureDuration>;
export type ExposureDurationOutput = InferOutputRow<typeof exposureDuration>;

export const hvacRuntime = defineEndpoint("hvac_runtime", {
  description: "Duration each HVAC unit ran between on/off state changes",
  params: {
    start_date: p.string().optional("2024-01-01").describe("Start date (YYYY-MM-DD)"),
    end_date: p.string().optional("2099-12-31").describe("End date (YYYY-MM-DD)"),
    hvac_id_filter: p.string().optional("").describe("Filter by HVAC unit ID (empty = all)"),
    tenant_id: p.string().optional("").describe("Filter by tenant ID (empty = all)"),
  },
  nodes: [
    node({
      name: "on_events",
      sql: `
        SELECT
          timestamp AS started_at,
          hvac_id
        FROM hvac_state_events_v2
        WHERE event = 'on'
          AND timestamp >= parseDateTimeBestEffort({{String(start_date, '2024-01-01')}})
          AND timestamp <= parseDateTimeBestEffort({{String(end_date, '2099-12-31')}})
          AND ({{String(hvac_id_filter, '')}} = '' OR hvac_id = {{String(hvac_id_filter, '')}})
          AND ({{String(tenant_id, '')}} = '' OR tenant_id = {{String(tenant_id, '')}})
      `,
    }),
    node({
      name: "off_events",
      sql: `
        SELECT
          timestamp AS stopped_at,
          hvac_id
        FROM hvac_state_events_v2
        WHERE event = 'off'
          AND timestamp >= parseDateTimeBestEffort({{String(start_date, '2024-01-01')}})
          AND timestamp <= parseDateTimeBestEffort({{String(end_date, '2099-12-31')}})
          AND ({{String(tenant_id, '')}} = '' OR tenant_id = {{String(tenant_id, '')}})
      `,
    }),
    node({
      name: "runtime_sessions",
      sql: `
        SELECT
          o.hvac_id,
          o.started_at,
          min(f.stopped_at) AS stopped_at,
          dateDiff('minute', o.started_at, min(f.stopped_at)) AS runtime_minutes
        FROM on_events o
        ASOF LEFT JOIN off_events f
          ON o.hvac_id = f.hvac_id
          AND f.stopped_at >= o.started_at
        GROUP BY o.hvac_id, o.started_at
        ORDER BY o.started_at DESC
      `,
    }),
  ],
  output: {
    hvac_id: t.string(),
    started_at: t.dateTime(),
    stopped_at: t.dateTime().nullable(),
    runtime_minutes: t.int32(),
  },
});

export type HvacRuntimeParams = InferParams<typeof hvacRuntime>;
export type HvacRuntimeOutput = InferOutputRow<typeof hvacRuntime>;

// ============================================================================
// Client
// ============================================================================

export const tinybird = new Tinybird({
  datasources: { sensorEvents, hvacCommands, hvacStateEvents },
  pipes: { shutoffsPerDay, sensorTriggerFrequency, recentActivity, exposureDuration, hvacRuntime },
});
