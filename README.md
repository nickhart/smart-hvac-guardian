# Smart HVAC Guardian

A zone-aware webhook service that automatically turns off HVAC systems when doors or windows are left open. Supports YoLink sensors and Cielo controllers with per-unit configurable delays, zone graph evaluation, magic link authentication, a real-time web dashboard, and Tinybird analytics.

## How It Works

1. **IFTTT** sends a webhook to `POST /api/sensor-event` when a YoLink door/window sensor opens or closes
2. The server writes sensor state to **Redis** and re-evaluates the **zone graph** — a BFS over zones connected by open interior doors determines which zones form a single connected component
3. If any exterior opening in a component is open, all HVAC units in that component are considered **exposed** and a delayed turn-off is scheduled via **Upstash QStash**
4. Each HVAC unit gets its own timer with a **cancellation token** stored in Redis. Closing a door deletes the token, cancelling the pending turn-off
5. When QStash fires `POST /api/hvac-turn-off`, it verifies the token still matches before triggering **IFTTT webhooks** to turn off the unit
6. If an HVAC unit turns **on** while already in an exposed zone, `POST /api/hvac-event` detects the exposure and re-schedules a turn-off

Sensors with no recorded state (offline/dead battery) default to **closed** so they never cause unnecessary shutoffs.

## Setup

### Prerequisites

- Node.js 20+
- [pnpm](https://pnpm.io/)
- A [Vercel](https://vercel.com) account (for deployment)
- [Upstash QStash](https://upstash.com/qstash) account
- [Upstash Redis](https://upstash.com/redis) account
- [YoLink](https://www.yosmart.com/) account with API access
- [IFTTT](https://ifttt.com/) account with Webhooks service enabled

### Environment Variables

Set these in your Vercel project (or `.env` file locally):

#### Required

| Variable                     | Description                                    |
| ---------------------------- | ---------------------------------------------- |
| `APP_CONFIG`                 | JSON string with app configuration (see below) |
| `YOLINK_UA_CID`              | YoLink API UA Client ID                        |
| `YOLINK_SECRET_KEY`          | YoLink API Secret Key                          |
| `IFTTT_WEBHOOK_KEY`          | IFTTT Webhooks service key                     |
| `QSTASH_TOKEN`               | Upstash QStash token                           |
| `QSTASH_CURRENT_SIGNING_KEY` | QStash current signing key                     |
| `QSTASH_NEXT_SIGNING_KEY`    | QStash next signing key                        |
| `UPSTASH_REDIS_REST_URL`     | Upstash Redis REST URL                         |
| `UPSTASH_REDIS_REST_TOKEN`   | Upstash Redis REST token                       |

#### Optional

| Variable         | Description                                                               |
| ---------------- | ------------------------------------------------------------------------- |
| `RESEND_API_KEY` | Resend API key (required for magic link auth)                             |
| `OWNER_EMAIL`    | Email address allowed to log in to the dashboard                          |
| `APP_URL`        | Public app URL for magic link emails (e.g. `https://your-app.vercel.app`) |
| `TINYBIRD_TOKEN` | Tinybird auth token (enables analytics tracking)                          |
| `TINYBIRD_URL`   | Tinybird API base URL                                                     |
| `SITE_NAME`      | Custom branding name (default: `HVAC Guardian`)                           |

### APP_CONFIG Format

The `APP_CONFIG` environment variable is a JSON string validated against a Zod schema:

```jsonc
{
  "zones": {
    "living-room": {
      "minisplits": ["unit-lr"],
      "exteriorOpenings": ["sensor-front-door", "sensor-window-1"],
      "interiorDoors": [{ "id": "sensor-hallway-door", "connectsTo": "bedroom" }],
    },
    "bedroom": {
      "minisplits": ["unit-br"],
      "exteriorOpenings": ["sensor-bedroom-window"],
      "interiorDoors": [{ "id": "sensor-hallway-door", "connectsTo": "living-room" }],
    },
  },
  "sensorDelays": {
    "sensor-front-door": 90,
    "sensor-window-1": 120,
    "sensor-bedroom-window": 120,
    "sensor-hallway-door": 0,
  },
  "hvacUnits": {
    "unit-lr": { "name": "Living Room AC", "iftttEvent": "turn_off_lr", "delaySeconds": 300 },
    "unit-br": { "name": "Bedroom AC", "iftttEvent": "turn_off_br", "delaySeconds": 300 },
  },
  "sensorNames": {
    "sensor-front-door": "Front Door",
    "sensor-window-1": "Living Room Window",
  },
  "sensorDefaults": {
    "sensor-window-1": "closed",
  },
  "yolink": {
    "baseUrl": "https://api.yosmart.com/open/yolink/v2/api",
  },
  "turnOffUrl": "https://your-app.vercel.app/api/hvac-turn-off",
}
```

Key fields:

- **zones** — map of zone ID to `{ minisplits, exteriorOpenings, interiorDoors }`. Interior doors must be defined symmetrically (if zone A has a door to B, zone B must have the same door to A).
- **sensorDelays** — per-sensor delay in seconds before triggering a shutoff check. Every sensor referenced in zones must have an entry here.
- **hvacUnits** — map of unit ID to `{ name, iftttEvent, delaySeconds }`. `delaySeconds` defaults to 300 (5 min).
- **sensorNames** — optional display names for the dashboard.
- **sensorDefaults** — optional default state (`"open"` or `"closed"`) for sensors with no recorded state. Sensors not listed here default to `"closed"` when offline.
- **yolink** — YoLink API configuration.
- **turnOffUrl** — the public URL of the `hvac-turn-off` endpoint (used by QStash callbacks).

### IFTTT Applet Setup

Create two IFTTT applets per sensor:

1. **Sensor Opens**: YoLink trigger (door open) → Webhooks action: `POST https://your-app.vercel.app/api/sensor-event` with JSON body `{"sensorId":"your-sensor-id","event":"open"}`
2. **Sensor Closes**: YoLink trigger (door close) → Webhooks action: `POST https://your-app.vercel.app/api/sensor-event` with JSON body `{"sensorId":"your-sensor-id","event":"close"}`

Create one IFTTT applet per HVAC unit:

3. **Turn Off HVAC**: Webhooks trigger (event name matching `iftttEvent` in config) → Cielo/smart AC action to turn off

### Deploy

```bash
vercel deploy
```

## API Endpoints

### Core

| Method   | Endpoint             | Description                                                    |
| -------- | -------------------- | -------------------------------------------------------------- |
| POST     | `/api/sensor-event`  | Receives sensor open/close events from IFTTT                   |
| POST     | `/api/hvac-event`    | Receives HVAC on/off events; re-schedules turn-off if exposed  |
| POST     | `/api/hvac-turn-off` | QStash callback that executes the IFTTT turn-off command       |
| GET      | `/api/check-state`   | Returns full system snapshot (sensors, units, timers, offline) |
| GET/POST | `/api/system-toggle` | Read or set the system-wide enable/disable flag                |
| GET/POST | `/api/unit-delay`    | Read or set per-unit delay overrides                           |

### Auth

| Method | Endpoint               | Description                              |
| ------ | ---------------------- | ---------------------------------------- |
| POST   | `/api/auth/send-magic` | Sends a magic link login email           |
| GET    | `/api/auth/magic`      | Redeems a magic link token, sets session |
| GET    | `/api/auth/session`    | Checks current authentication status     |
| POST   | `/api/auth/logout`     | Clears the session cookie                |

## Web Dashboard

A React 19 + Vite + Tailwind CSS app in the `web/` directory. Once authenticated, it displays:

- Real-time sensor states (open/closed/offline) with friendly display names
- HVAC unit exposure status and active timer countdown badges
- Per-unit delay override controls
- System-wide enable/disable toggle

Updates arrive via SSE in development (instant) or adaptive polling in production (3–15 s depending on state). The Vite dev server proxies `/api/*` to the local backend.

## Authentication

The app uses **magic link** login — no passwords. When a user submits their email:

1. `POST /api/auth/send-magic` validates the email against `OWNER_EMAIL` and sends a login link via **Resend**
2. Clicking the link hits `GET /api/auth/magic`, which validates the token, creates a 7-day session in Redis, and redirects to `/` with an `HttpOnly` session cookie
3. Subsequent requests are authenticated via the `session` cookie checked by `/api/auth/session`

Only the `OWNER_EMAIL` address is allowed to log in. Requires `RESEND_API_KEY`, `OWNER_EMAIL`, and `APP_URL` to be set.

## Local Development

### Commands

```bash
pnpm install        # install dependencies
pnpm test           # run unit tests (vitest)
pnpm test:watch     # run tests in watch mode
pnpm test:coverage  # run tests with coverage
pnpm test:e2e       # run end-to-end tests
pnpm dev            # start local dev server (default config)
pnpm dev:fast       # start dev server with 0.033x delay scaling
pnpm type-check     # TypeScript validation
pnpm lint           # ESLint
pnpm format         # Prettier format
pnpm web:dev        # start the web dashboard dev server
pnpm web:build      # build the web dashboard for production
pnpm cli            # tenant & user management CLI (see below)
```

### Dev Server

The dev server (`dev/server.ts`) is a local Express server that emulates the full production stack — QStash scheduling, Redis state, sensor events, and the dashboard — all in-process with no external dependencies.

#### Environment files

The server loads config from `.env.<name>` files. Pass `--env` to select one:

```bash
pnpm dev:fast -- --env dev        # .env.dev  — fake sensor IDs (default)
pnpm dev:fast -- --env dev.prod   # .env.dev.prod — real production config
```

- **`.env.dev`** — placeholder sensor/zone IDs, good for quick iteration.
- **`.env.dev.prod`** — exact production `APP_CONFIG` (real device IDs, 3 zones with interior doors, friendly sensor names). The `turnOffUrl` in the config points to production but the dev server auto-overrides it to `http://localhost:3000/api/hvac-turn-off`, so it's safe to use.

#### Delay scaling

HVAC turn-off timers are multiplied by a delay scale factor:

- `pnpm dev` — real-time (1×). A 5-minute delay takes 5 minutes.
- `pnpm dev:fast` — 0.033× (~30× faster). A 5-minute delay fires in ~10 seconds.

#### Simulated sensor toggling

The dashboard shows clickable sensor cards. Clicking a sensor sends `POST /api/sensor-event` to toggle it open/closed, letting you exercise the full zone-graph evaluation and timer logic without physical hardware.

HVAC units can also be toggled via `POST /api/dev/hvac-toggle` to test re-exposure detection.

#### Real-time dashboard updates (SSE)

In dev mode the dashboard opens an SSE connection to `GET /api/events` for instant UI updates (sensor changes, timer set/fired/cancelled, HVAC state). A green "live" indicator appears when SSE is active.

If SSE fails (e.g. after 5 consecutive errors), the dashboard falls back to adaptive polling:

| Condition     | Poll interval |
| ------------- | ------------- |
| Tab hidden    | 15 s          |
| Active timers | 3 s           |
| Idle          | 5 s           |

Production always uses adaptive polling (SSE is dev-only).

#### Friendly sensor names

When `sensorNames` is present in `APP_CONFIG`, the dashboard displays human-readable names (e.g. "Front Door") instead of raw device IDs. The `.env.dev.prod` file includes these by default.

#### Dev-only introspection

`GET /api/dev/state` returns the full internal state: all sensors, HVAC units, pending timers with fire timestamps, event log, zone config, and delay scale.

## Tenant & User Management

The system supports **multi-tenancy** — each tenant has isolated data, users, and webhook endpoints scoped under `/api/t/{tenantId}/...`.

### CLI

Manage tenants and users from the command line:

```bash
pnpm cli <command> [...args]
```

#### Tenant commands

| Command                      | Description                               |
| ---------------------------- | ----------------------------------------- |
| `tenant:create <name>`       | Create a new tenant (auto-generates slug) |
| `tenant:list`                | List all tenants                          |
| `tenant:activate <tenantId>` | Activate a tenant                         |
| `tenant:suspend <tenantId>`  | Suspend a tenant                          |
| `tenant:delete <tenantId>`   | Delete tenant and all related data        |

#### User commands

| Command                              | Description                                                      |
| ------------------------------------ | ---------------------------------------------------------------- |
| `user:add <email> <tenantId> [role]` | Add a user (role: `owner`\|`admin`\|`viewer`, default: `viewer`) |
| `user:list <tenantId>`               | List users for a tenant                                          |
| `user:remove <userId>`               | Remove a user                                                    |
| `user:set-role <userId> <role>`      | Change a user's role                                             |

### Quick-start example

```bash
# Create a tenant
pnpm cli tenant:create "Acme Properties"

# Note the tenant ID from the output, then add an owner user
pnpm cli user:add admin@acme.com <tenantId> owner

# Verify
pnpm cli tenant:list
pnpm cli user:list <tenantId>
```

### Database requirement

The CLI connects directly to Postgres. Make sure `DATABASE_URL` is set in your environment (or `.env` file) before running any commands.
