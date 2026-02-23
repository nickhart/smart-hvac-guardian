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

export const sensorEvents = defineDatasource("sensor_events", {
  description: "Door/window sensor open/close events",
  schema: {
    timestamp: t.dateTime(),
    request_id: t.string(),
    sensor_id: t.string(),
    event: t.string(),
    exposed_units: t.array(t.string()).jsonPath("$.exposed_units[:]"),
    unexposed_units: t.array(t.string()).jsonPath("$.unexposed_units[:]"),
    timers_scheduled: t.array(t.string()).jsonPath("$.timers_scheduled[:]"),
    timers_cancelled: t.array(t.string()).jsonPath("$.timers_cancelled[:]"),
  },
  engine: engine.mergeTree({
    sortingKey: ["timestamp", "sensor_id"],
  }),
});

export type SensorEventsRow = InferRow<typeof sensorEvents>;

export const hvacCommands = defineDatasource("hvac_commands", {
  description: "HVAC turn-off, cancellation, and scheduling commands",
  schema: {
    timestamp: t.dateTime(),
    request_id: t.string(),
    hvac_unit_id: t.string(),
    unit_name: t.string(),
    action: t.string(),
    trigger_source: t.string(),
    delay_seconds: t.int32().nullable(),
    ifttt_event: t.string().nullable(),
  },
  engine: engine.mergeTree({
    sortingKey: ["timestamp", "hvac_unit_id"],
  }),
});

export type HvacCommandsRow = InferRow<typeof hvacCommands>;

export const hvacStateEvents = defineDatasource("hvac_state_events", {
  description: "HVAC unit on/off state change events",
  schema: {
    timestamp: t.dateTime(),
    request_id: t.string(),
    hvac_id: t.string(),
    event: t.string(),
    was_exposed: t.uint8(),
    turnoff_scheduled: t.uint8(),
  },
  engine: engine.mergeTree({
    sortingKey: ["timestamp", "hvac_id"],
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
        FROM hvac_commands
        WHERE action = 'turned_off'
          AND timestamp >= parseDateTimeBestEffort({{String(start_date, '2024-01-01')}})
          AND timestamp <= parseDateTimeBestEffort({{String(end_date, '2099-12-31')}})
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
        FROM sensor_events
        WHERE event = 'open'
          AND timestamp >= parseDateTimeBestEffort({{String(start_date, '2024-01-01')}})
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
        FROM sensor_events
        WHERE timestamp >= parseDateTimeBestEffort({{String(start_date, '2024-01-01')}})
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
    hvac_unit_id: p.string().optional("").describe("Filter by HVAC unit ID (empty = all)"),
  },
  nodes: [
    node({
      name: "exposure_sessions",
      sql: `
        WITH open_events AS (
          SELECT
            timestamp AS opened_at,
            arrayJoin(exposed_units) AS hvac_unit_id
          FROM sensor_events
          WHERE length(exposed_units) > 0
            AND timestamp >= parseDateTimeBestEffort({{String(start_date, '2024-01-01')}})
            AND timestamp <= parseDateTimeBestEffort({{String(end_date, '2099-12-31')}})
            AND ({{String(hvac_unit_id, '')}} = '' OR has(exposed_units, {{String(hvac_unit_id, '')}}))
        ),
        close_events AS (
          SELECT
            timestamp AS closed_at,
            arrayJoin(unexposed_units) AS hvac_unit_id
          FROM sensor_events
          WHERE length(unexposed_units) > 0
            AND timestamp >= parseDateTimeBestEffort({{String(start_date, '2024-01-01')}})
            AND timestamp <= parseDateTimeBestEffort({{String(end_date, '2099-12-31')}})
        )
        SELECT
          o.hvac_unit_id,
          o.opened_at,
          min(c.closed_at) AS closed_at,
          dateDiff('minute', o.opened_at, min(c.closed_at)) AS duration_minutes
        FROM open_events o
        ASOF LEFT JOIN close_events c
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

// ============================================================================
// Client
// ============================================================================

export const tinybird = new Tinybird({
  datasources: { sensorEvents, hvacCommands, hvacStateEvents },
  pipes: { shutoffsPerDay, sensorTriggerFrequency, recentActivity, exposureDuration },
});
