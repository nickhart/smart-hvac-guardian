# Analytics

## Overview

Smart HVAC Guardian uses [Tinybird](https://www.tinybird.co/) as its analytics backend, with the [`@tinybirdco/sdk`](https://www.npmjs.com/package/@tinybirdco/sdk) TypeScript SDK for type-safe datasource/pipe definitions and ingestion. The analytics layer tracks three categories of events:

- **Sensor events** — door/window open and close triggers, including which HVAC units became exposed or unexposed
- **HVAC commands** — turn-off, cancellation, and scheduling actions taken on HVAC units
- **HVAC state events** — raw on/off state changes reported by HVAC units

Analytics are fire-and-forget: ingestion errors are silently swallowed so they never break the HVAC control path.

## Architecture

```
API handlers                      Tinybird
─────────────                     ────────
sensor-event.ts ─┐
hvac-event.ts   ─┼─► AnalyticsProvider ─► Events API ─► Datasources ─► Pipes ─► (dashboard)
hvac-turn-off.ts ┘        │
                    NoopAnalyticsProvider
                    (when TINYBIRD_TOKEN
                     is not set)
```

- `AnalyticsProvider` is an interface implemented by `TinybirdAnalyticsProvider` (production) and `NoopAnalyticsProvider` (local dev / missing credentials).
- The provider is injected via `createDependencies()`, so handlers are decoupled from the analytics backend.
- Ingestion hits the Tinybird Events API (`POST /v0/events?name=<datasource>`).
- Pipes are deployed as HTTP endpoints and queried via the `tb` CLI or the Tinybird API.

## Configuration

| Variable         | Description                                                                                |
| ---------------- | ------------------------------------------------------------------------------------------ |
| `TINYBIRD_TOKEN` | Tinybird auth token (admin or append-only). When missing, `NoopAnalyticsProvider` is used. |
| `TINYBIRD_URL`   | Tinybird API base URL (defaults to `https://api.tinybird.co`).                             |

Tinybird project settings live in `tinybird.config.json`. Datasource and pipe definitions are in the `tinybird/` directory and mirrored as TypeScript in `src/lib/tinybird.ts`.

## Datasources

### `sensor_events_v2`

Door/window sensor open/close events.

| Column             | Type            | Description                                       |
| ------------------ | --------------- | ------------------------------------------------- |
| `timestamp`        | `DateTime`      | When the event occurred                           |
| `request_id`       | `String`        | Unique request correlation ID                     |
| `tenant_id`        | `String`        | Tenant identifier                                 |
| `sensor_id`        | `String`        | Sensor that triggered the event                   |
| `event`            | `String`        | `"open"` or `"close"`                             |
| `exposed_units`    | `Array(String)` | HVAC unit IDs now exposed to open openings        |
| `unexposed_units`  | `Array(String)` | HVAC unit IDs no longer exposed                   |
| `timers_scheduled` | `Array(String)` | Unit IDs for which turn-off timers were scheduled |
| `timers_cancelled` | `Array(String)` | Unit IDs for which turn-off timers were cancelled |

Sorting key: `tenant_id, timestamp, sensor_id`

### `hvac_commands_v2`

HVAC turn-off, cancellation, and scheduling commands.

| Column           | Type               | Description                                                 |
| ---------------- | ------------------ | ----------------------------------------------------------- |
| `timestamp`      | `DateTime`         | When the command was issued                                 |
| `request_id`     | `String`           | Unique request correlation ID                               |
| `tenant_id`      | `String`           | Tenant identifier                                           |
| `hvac_unit_id`   | `String`           | Target HVAC unit                                            |
| `unit_name`      | `String`           | Human-readable unit name                                    |
| `action`         | `String`           | `"turned_off"`, `"cancelled"`, or `"scheduled"`             |
| `trigger_source` | `String`           | What caused the command (e.g. `"sensor_open"`, `"hvac_on"`) |
| `delay_seconds`  | `Nullable(Int32)`  | Delay before turn-off (for scheduled actions)               |
| `ifttt_event`    | `Nullable(String)` | IFTTT webhook event name used to execute the turn-off       |

Sorting key: `tenant_id, timestamp, hvac_unit_id`

### `hvac_state_events_v2`

HVAC unit on/off state change events.

| Column              | Type       | Description                                              |
| ------------------- | ---------- | -------------------------------------------------------- |
| `timestamp`         | `DateTime` | When the state change was reported                       |
| `request_id`        | `String`   | Unique request correlation ID                            |
| `tenant_id`         | `String`   | Tenant identifier                                        |
| `hvac_id`           | `String`   | HVAC unit identifier                                     |
| `event`             | `String`   | `"on"` or `"off"`                                        |
| `was_exposed`       | `UInt8`    | `1` if the unit was exposed to open openings at the time |
| `turnoff_scheduled` | `UInt8`    | `1` if a turn-off timer was scheduled in response        |

Sorting key: `tenant_id, timestamp, hvac_id`

## Ingestion

Each API handler calls `AnalyticsProvider` methods at the end of its control flow:

| Handler                | Method(s)             | When                                                        |
| ---------------------- | --------------------- | ----------------------------------------------------------- |
| `api/sensor-event.ts`  | `trackSensorEvent`    | After zone graph evaluation and timer scheduling            |
| `api/hvac-event.ts`    | `trackHvacStateEvent` | On every HVAC on/off event                                  |
| `api/hvac-event.ts`    | `trackHvacCommand`    | When an exposed unit's turn-off is scheduled                |
| `api/hvac-turn-off.ts` | `trackHvacCommand`    | After a unit is turned off, or when a turn-off is cancelled |

All calls are wrapped in try/catch — analytics never breaks the control path. `TinybirdAnalyticsProvider` posts NDJSON to the Events API; `NoopAnalyticsProvider` does nothing.

## Pipes (Endpoints)

### `shutoffs_per_day`

Daily count of HVAC shutoffs with affected units.

**Parameters:**

| Name         | Type     | Default      | Description                    |
| ------------ | -------- | ------------ | ------------------------------ |
| `start_date` | `String` | `2024-01-01` | Start date (YYYY-MM-DD)        |
| `end_date`   | `String` | `2099-12-31` | End date (YYYY-MM-DD)          |
| `tenant_id`  | `String` | `""`         | Filter by tenant (empty = all) |

**Output columns:** `day` (Date), `shutoff_count` (UInt64), `units_affected` (Array(String)), `trigger_sources` (Array(String))

```bash
tb pipe data shutoffs_per_day --param start_date=2025-01-01 --param tenant_id=t_abc
```

### `sensor_trigger_frequency`

Per-sensor open event frequency.

**Parameters:**

| Name         | Type     | Default      | Description                    |
| ------------ | -------- | ------------ | ------------------------------ |
| `start_date` | `String` | `2024-01-01` | Start date (YYYY-MM-DD)        |
| `tenant_id`  | `String` | `""`         | Filter by tenant (empty = all) |

**Output columns:** `sensor_id` (String), `open_count` (UInt64), `first_seen` (DateTime), `last_seen` (DateTime)

```bash
tb pipe data sensor_trigger_frequency --param start_date=2025-06-01
```

### `recent_activity`

Recent sensor events in reverse chronological order.

**Parameters:**

| Name         | Type     | Default      | Description                    |
| ------------ | -------- | ------------ | ------------------------------ |
| `start_date` | `String` | `2024-01-01` | Start date (YYYY-MM-DD)        |
| `limit`      | `Int32`  | `50`         | Max rows to return             |
| `tenant_id`  | `String` | `""`         | Filter by tenant (empty = all) |

**Output columns:** `timestamp` (DateTime), `event_type` (String), `entity_id` (String), `action` (String), `exposed_units` (Array(String)), `timers_scheduled` (Array(String)), `timers_cancelled` (Array(String))

```bash
tb pipe data recent_activity --param limit=10 --param tenant_id=t_abc
```

### `exposure_duration`

Duration each HVAC unit was exposed to open exterior openings. Uses an ASOF JOIN to pair open/close events into sessions.

**Parameters:**

| Name                  | Type     | Default      | Description                       |
| --------------------- | -------- | ------------ | --------------------------------- |
| `start_date`          | `String` | `2024-01-01` | Start date (YYYY-MM-DD)           |
| `end_date`            | `String` | `2099-12-31` | End date (YYYY-MM-DD)             |
| `hvac_unit_id_filter` | `String` | `""`         | Filter by HVAC unit (empty = all) |
| `tenant_id`           | `String` | `""`         | Filter by tenant (empty = all)    |

**Output columns:** `hvac_unit_id` (String), `opened_at` (DateTime), `closed_at` (Nullable(DateTime)), `duration_minutes` (Int32)

```bash
tb pipe data exposure_duration --param start_date=2025-01-01 --param hvac_unit_id_filter=hvac-living
```

### `hvac_runtime`

Duration each HVAC unit ran between on/off state changes. Uses an ASOF JOIN to pair on/off events into sessions.

**Parameters:**

| Name             | Type     | Default      | Description                       |
| ---------------- | -------- | ------------ | --------------------------------- |
| `start_date`     | `String` | `2024-01-01` | Start date (YYYY-MM-DD)           |
| `end_date`       | `String` | `2099-12-31` | End date (YYYY-MM-DD)             |
| `hvac_id_filter` | `String` | `""`         | Filter by HVAC unit (empty = all) |
| `tenant_id`      | `String` | `""`         | Filter by tenant (empty = all)    |

**Output columns:** `hvac_id` (String), `started_at` (DateTime), `stopped_at` (Nullable(DateTime)), `runtime_minutes` (Int32)

```bash
tb pipe data hvac_runtime --param start_date=2025-01-01 --param hvac_id_filter=hvac-bedroom
```

## Querying

Use the `tb` CLI to query any pipe endpoint:

```bash
# All shutoffs in January 2025
tb pipe data shutoffs_per_day --param start_date=2025-01-01 --param end_date=2025-01-31

# Sensor frequency for a specific tenant
tb pipe data sensor_trigger_frequency --param tenant_id=t_abc

# Last 20 events
tb pipe data recent_activity --param limit=20

# Exposure sessions for one unit in a date range
tb pipe data exposure_duration \
  --param start_date=2025-03-01 \
  --param end_date=2025-03-31 \
  --param hvac_unit_id_filter=hvac-living \
  --param tenant_id=t_abc
```

All pipes support `tenant_id` filtering. Pass an empty string (the default) to query across all tenants.

## TypeScript SDK

`src/lib/tinybird.ts` is the single source of truth for datasource schemas and pipe definitions. It uses `@tinybirdco/sdk` to define:

- **Datasources** via `defineDatasource()` — schema, engine, sorting key
- **Endpoints** via `defineEndpoint()` — SQL nodes, parameters, output schema
- **Client** via `new Tinybird()` — registers all datasources and pipes

The SDK exports inferred types for each resource:

- `SensorEventsRow`, `HvacCommandsRow`, `HvacStateEventsRow` — row types for ingestion
- `ShutoffsPerDayParams` / `ShutoffsPerDayOutput` — parameter and output types per pipe
- `SensorTriggerFrequencyParams` / `SensorTriggerFrequencyOutput`
- `RecentActivityParams` / `RecentActivityOutput`
- `ExposureDurationParams` / `ExposureDurationOutput`
- `HvacRuntimeParams` / `HvacRuntimeOutput`

## Adding a New Pipe

1. Create a `.pipe` file in `tinybird/pipes/` with `NODE` and `TYPE endpoint` sections
2. Add a matching `defineEndpoint()` call in `src/lib/tinybird.ts` with params and output schema
3. Register the endpoint in the `tinybird` client's `pipes` object
4. Deploy: `tb deploy`
5. Test: `tb pipe data <pipe_name> --param key=value`
