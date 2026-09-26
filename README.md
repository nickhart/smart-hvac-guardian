# Smart HVAC Guardian

A zone-aware webhook service that automatically turns off HVAC systems when doors or windows are left open. Supports YoLink sensors and Cielo controllers with per-unit configurable delays, zone graph evaluation, magic link authentication, a real-time web dashboard, and Tinybird analytics.

## How It Works

1. **IFTTT** sends a webhook to `POST /api/t/{tenantId}/sensor-event` when a YoLink door/window sensor opens or closes
2. The server writes sensor state to **Redis** and re-evaluates the **zone graph** — a BFS over zones connected by open interior doors determines which zones form a single connected component
3. If any exterior opening in a component is open, all HVAC units in that component are considered **exposed** and a delayed turn-off is scheduled via **Upstash QStash**
4. Each HVAC unit gets its own timer with a **cancellation token** stored in Redis. Closing a door deletes the token, cancelling the pending turn-off
5. When QStash fires `POST /api/t/{tenantId}/hvac-turn-off`, the handler checks the token still matches, asks **YoLink** directly whether the openings are really still open, and only then triggers an **IFTTT webhook** to turn the unit off
6. If an HVAC unit turns **on** while already in an exposed zone, `POST /api/t/{tenantId}/hvac-event` detects the exposure and re-schedules a turn-off

Sensors with no recorded state (offline/dead battery) default to **closed** so they never cause unnecessary shutoffs.

While the system is **disabled** it runs in **shadow mode**: every decision is still evaluated, scheduled and recorded, but no turn-off is sent to IFTTT. A new deployment starts disabled.

## Self-Hosting

This walks through running your own deployment for one property. Budget an afternoon, most of it in IFTTT.

### What you need

**Hardware**

- YoLink door/window sensors, connected to a YoLink hub
- HVAC units controlled by Cielo (or anything else IFTTT can switch off)

**Accounts**

| Service                                                             | Used for                                | Required |
| ------------------------------------------------------------------- | --------------------------------------- | -------- |
| [Vercel](https://vercel.com)                                        | Hosting (Edge Functions + the web app)  | Yes      |
| [Neon](https://neon.tech) (or any Postgres reachable over HTTP)     | Tenants, users, configuration, secrets  | Yes      |
| [Upstash Redis](https://upstash.com/redis)                          | Sensor state, timers, sessions          | Yes      |
| [Upstash QStash](https://upstash.com/qstash)                        | Delayed turn-off callbacks              | Yes      |
| [Resend](https://resend.com), with a verified sending domain        | Magic-link sign-in emails               | Yes      |
| [YoLink](https://www.yosmart.com/) API access (UA-CID + Secret Key) | Reading real sensor state               | Yes      |
| [IFTTT](https://ifttt.com/) with the Webhooks service               | Receiving sensor/HVAC events, turn-offs | Yes      |
| [Tinybird](https://www.tinybird.co/)                                | Analytics                               | No       |

**IFTTT plan.** You need one applet per sensor event and per HVAC event (see [step 8](#8-create-the-ifttt-applets)): `2 × sensors + 3 × HVAC units`. Six sensors and three units is 21 applets, beyond what the lower IFTTT tiers allow. Check IFTTT's current plan limits against your count before you start.

**Tools**: Node.js 24+, [pnpm](https://pnpm.io/) 9, and the [Vercel CLI](https://vercel.com/docs/cli) if you deploy from the command line.

### 1. Clone and install

```bash
git clone https://github.com/nickhart/smart-hvac-guardian.git
cd smart-hvac-guardian
pnpm install
```

### 2. Configure environment variables

Set these in your Vercel project (Settings → Environment Variables). Also put them in a local `.env` file, which is gitignored, for the database and CLI steps below.

#### Required

| Variable                     | Where to get it                                                                                          |
| ---------------------------- | -------------------------------------------------------------------------------------------------------- |
| `DATABASE_URL`               | Neon connection string                                                                                   |
| `MASTER_ENCRYPTION_KEY`      | Generate with `openssl rand -hex 32` (64 hex chars). Encrypts tenant secrets at rest — **back it up**    |
| `UPSTASH_REDIS_REST_URL`     | Upstash console → Redis → REST API                                                                       |
| `UPSTASH_REDIS_REST_TOKEN`   | Upstash console → Redis → REST API                                                                       |
| `QSTASH_TOKEN`               | Upstash console → QStash                                                                                 |
| `QSTASH_CURRENT_SIGNING_KEY` | Upstash console → QStash → Signing keys                                                                  |
| `QSTASH_NEXT_SIGNING_KEY`    | Upstash console → QStash → Signing keys                                                                  |
| `RESEND_API_KEY`             | Resend dashboard → API Keys                                                                              |
| `EMAIL_FROM`                 | A sender address on your Resend-verified domain, e.g. `noreply@example.com`                              |
| `APP_URL`                    | Your deployment's public URL, e.g. `https://your-app.vercel.app`. Used in sign-in links and webhook URLs |

`MASTER_ENCRYPTION_KEY` cannot be rotated in place. If you lose or change it, every tenant's stored YoLink and IFTTT credentials become unreadable and have to be re-entered.

#### Optional

| Variable         | Description                                                                                                |
| ---------------- | ---------------------------------------------------------------------------------------------------------- |
| `QSTASH_URL`     | QStash API base URL. Set it if the Upstash console shows a region-specific one; defaults to the global URL |
| `TINYBIRD_TOKEN` | Tinybird token with **append** access to the datasources (enables analytics)                               |
| `TINYBIRD_URL`   | Tinybird API base URL for your workspace's region, e.g. `https://api.us-east.aws.tinybird.co`              |
| `SITE_NAME`      | Branding name shown in the app and emails (default: `HVAC Guardian`)                                       |
| `LOGO_URL`       | Branding logo URL                                                                                          |
| `PRIMARY_COLOR`  | Branding color                                                                                             |

YoLink and IFTTT credentials are **not** environment variables. They're entered in the setup wizard and stored encrypted per tenant.

> **Do not set `APP_CONFIG`, `YOLINK_UA_CID`, `YOLINK_SECRET_KEY`, `IFTTT_WEBHOOK_KEY` or `OWNER_EMAIL` in a deployed environment.** They belong to a legacy single-tenant mode that is being removed, and they're only used by the local dev server.

### 3. Create the database schema

```bash
DATABASE_URL="<your Neon connection string>" pnpm db:push
```

This runs `drizzle-kit push`, creating the tables defined in `src/db/schema.ts`. It reads `DATABASE_URL` from the shell environment, not from `.env`. Re-run it after pulling changes that touch the schema.

### 4. Deploy the Tinybird analytics (optional)

Skip this step if you're not using Tinybird. The app runs without it.

`src/lib/tinybird.ts` is the source of truth for datasources and pipes. Deploy it with a **workspace admin** token. This is a different token from the append-only one the app uses at runtime; don't put the admin token in Vercel.

```bash
TINYBIRD_TOKEN=<admin token> pnpm tinybird:deploy
```

`tinybird.config.json` points at the `us-east` region. If your workspace is elsewhere, change its `baseUrl` first.

### 5. Deploy to Vercel

Link the repository to a Vercel project (or run `vercel link`), then deploy:

```bash
vercel deploy --prod
```

`vercel.json` builds the web app from `web/` and routes the tenant webhook URLs. Once deployed, `GET https://your-app.vercel.app/api/health` should return `"status": "ok"`.

### 6. Create your tenant and owner account

Sign-in only works for users who already exist in the database. Create your property (a "tenant") and your owner user with the CLI, which reads `DATABASE_URL` from the env file you pass it:

```bash
pnpm cli --env-file .env tenant:create "My House"
# note the tenant ID it prints
pnpm cli --env-file .env user:add you@example.com <tenantId> owner
```

### 7. Sign in and run the setup wizard

Open your `APP_URL`, enter your email and click the link Resend delivers. A new tenant starts in onboarding, so you land in a nine-step wizard:

1. **Welcome**
2. **YoLink credentials**: your UA-CID and Secret Key, from the YoLink app under Account → Advanced Settings → User Access Credentials. The wizard tests them.
3. **Sensors**: imported from your YoLink account. Set a display name and delay for each.
4. **Zones**: which sensors are exterior openings, which are interior doors, and which zones they connect.
5. **HVAC units**: one per unit, each with its own turn-off delay. Each unit gets an IFTTT event name, `turn_off_<unitId>`.
6. **IFTTT webhook key**: from [ifttt.com/maker_webhooks](https://ifttt.com/maker_webhooks) → Documentation.
7. **Test applets**: fires each unit's turn-off event so you can confirm the shutoff applets from step 8 work. **This really turns the unit off.**
8. **Review**
9. **Activate**: shows your **webhook secret** and the two webhook URLs. **The secret is shown only once**, so save it now.

You can change zones, sensors, units and delays later in Settings.

### 8. Create the IFTTT applets

Every applet that calls this app uses the **Webhooks → Make a web request** action with:

- **URL**: the sensor or HVAC webhook URL from step 9 of the wizard: `https://your-app.vercel.app/api/t/<tenantId>/sensor-event` or `.../hvac-event`
- **Method**: `POST`
- **Content Type**: `application/json`
- **Additional Headers**: `Authorization: Bearer <webhook secret>`
- **Body**: as below, using the IDs shown in Settings

| Applets                       | Trigger                                                         | Action                                                                      |
| ----------------------------- | --------------------------------------------------------------- | --------------------------------------------------------------------------- |
| Two per sensor                | YoLink: sensor opens / sensor closes                            | `sensor-event` with `{"sensorId":"<sensorId>","event":"open"}` or `"close"` |
| Two per HVAC unit             | Cielo: unit powered on / unit powered off                       | `hvac-event` with `{"hvacId":"<unitId>","event":"on"}` or `"off"`           |
| One per HVAC unit (turn-offs) | Webhooks: receive a web request, event name `turn_off_<unitId>` | Cielo: turn the unit off                                                    |

The powered on/off applets matter. Without them the system can't tell that a unit was switched back on in a zone that's still exposed.

IFTTT answers every webhook with `200` whether or not an applet is listening for that event. A missing or misnamed turn-off applet therefore fails silently, which is what the wizard's test step is for.

Keep the webhook secret private. Anyone who has it and your tenant ID can send events for your property.

### 9. Watch it in shadow mode, then enable it

The system starts **disabled**, which means shadow mode. Open and close some doors and watch the dashboard. If you set up Tinybird, the `hvac_commands_v2` rows with `shutoff_enabled = 0` record every turn-off the system _would_ have sent. When the decisions look right, switch the system on from the dashboard.

For a hard stop that doesn't depend on this app, disable the turn-off applets in IFTTT. Everything else keeps running and recording.

## Configuration model

The wizard builds this configuration and stores it per tenant. The structure, validated by `AppConfigSchema` in `src/config/schema.ts`:

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
    "unit-lr": { "name": "Living Room AC", "iftttEvent": "turn_off_unit-lr", "delaySeconds": 300 },
    "unit-br": { "name": "Bedroom AC", "iftttEvent": "turn_off_unit-br", "delaySeconds": 300 },
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
  "turnOffUrl": "https://your-app.vercel.app/api/t/<tenantId>/hvac-turn-off",
}
```

- **zones**: map of zone ID to `{ minisplits, exteriorOpenings, interiorDoors }`. Interior doors must be defined symmetrically (if zone A has a door to B, zone B must have the same door to A).
- **sensorDelays**: per-sensor delay in seconds before triggering a shutoff check. Every sensor referenced in zones must have an entry here.
- **hvacUnits**: map of unit ID to `{ name, iftttEvent, delaySeconds }`. `delaySeconds` defaults to 300 (5 min) and can be overridden per unit from the dashboard.
- **sensorNames**: optional display names for the dashboard.
- **sensorDefaults**: optional default state (`"open"` or `"closed"`) for sensors with no recorded state. Sensors not listed here default to `"closed"` when offline.
- **yolink**: YoLink API configuration.
- **turnOffUrl**: the public URL QStash calls back when a timer fires. The wizard sets it from `APP_URL`.

## API Endpoints

Webhook endpoints are scoped to a tenant and authenticated with the tenant's webhook secret (`Authorization: Bearer ...`). QStash callbacks are authenticated by QStash signature. Dashboard endpoints use the session cookie.

### Webhooks

| Method | Endpoint                          | Auth             | Description                                                     |
| ------ | --------------------------------- | ---------------- | --------------------------------------------------------------- |
| POST   | `/api/t/{tenantId}/sensor-event`  | Webhook secret   | Sensor open/close events from IFTTT                             |
| POST   | `/api/t/{tenantId}/hvac-event`    | Webhook secret   | HVAC on/off events; re-schedules turn-off if exposed            |
| POST   | `/api/t/{tenantId}/hvac-turn-off` | QStash signature | Timer callback that verifies exposure and triggers the turn-off |

### Dashboard

| Method   | Endpoint               | Description                                                                        |
| -------- | ---------------------- | ---------------------------------------------------------------------------------- |
| GET      | `/api/check-state`     | System snapshot (sensors, units, timers). `?verify=yolink` compares against YoLink |
| GET/POST | `/api/system-toggle`   | Read or set the system-wide enable/disable flag                                    |
| GET/POST | `/api/unit-delay`      | Read or set per-unit delay overrides                                               |
| GET/PUT  | `/api/settings/config` | Read or update the tenant's configuration                                          |

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

1. `POST /api/auth/send-magic` looks the email up in the `users` table and, if it's there, sends a login link via **Resend**. Unknown addresses get the same response, so the form doesn't reveal who has an account
2. Clicking the link hits `GET /api/auth/magic`, which validates the token, creates a 7-day session in Redis, and redirects to `/` with an `HttpOnly` session cookie
3. Subsequent requests are authenticated via the `session` cookie

Users are added with the CLI (`user:add`); see [Tenant & User Management](#tenant--user-management).

## Health & Monitoring

`GET /api/health` is an unauthenticated probe for an external uptime monitor
(Better Stack, UptimeRobot, Grafana Cloud). It reports per-dependency status
without exposing config values or credentials:

```json
{
  "status": "ok",
  "checks": { "config": "ok", "redis": "ok", "analytics": "ok", "email": "ok" },
  "durationMs": 42
}
```

Redis is the only hard dependency — it returns **503** when Redis is unreachable
or config fails to validate, so a monitor can alert on status code alone.
Unconfigured optional services report `not_configured` rather than failing.

Provider health is also recorded to the Tinybird `provider_events_v2` datasource
(success, failure, or `skipped_circuit_open`), which is what shows an upstream
outage rather than just an endpoint being down.

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
pnpm db:push        # apply the database schema to DATABASE_URL
pnpm web:dev        # start the web dashboard dev server
pnpm web:build      # build the web dashboard for production
pnpm cli            # tenant & user management CLI (see below)
```

### Dev Server

The dev server (`dev/server.ts`) is a local server that emulates the full production stack — QStash scheduling, Redis state, sensor events, and the dashboard — all in-process with no external dependencies. It doesn't use the database: it reads a single configuration from an `APP_CONFIG` value in a local env file, in the format shown under [Configuration model](#configuration-model).

#### Environment files

The server loads config from `.env.<name>` files. Pass `--env` to select one:

```bash
pnpm dev:fast -- --env dev          # .env.dev — fake sensor IDs (default)
pnpm dev:fast -- --env dev.myhouse  # .env.dev.myhouse — your own config, kept out of git
```

- **`.env.dev`** — placeholder sensor/zone IDs, good for quick iteration.
- **Your own `.env.dev.<name>`** — a copy of your real configuration, for reproducing behaviour against your actual layout. Any `turnOffUrl` in it is overridden to `http://localhost:3000/api/hvac-turn-off`, so it never calls production.

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

#### Dev-only introspection

`GET /api/dev/state` returns the full internal state: all sensors, HVAC units, pending timers with fire timestamps, event log, zone config, and delay scale.

## Tenant & User Management

Each tenant has isolated data, users, and webhook endpoints scoped under `/api/t/{tenantId}/...`. A self-hosted deployment normally has exactly one.

### CLI

The CLI connects directly to Postgres and Redis. Pass the env file that holds `DATABASE_URL` (and the Upstash variables, for `redis:flush`):

```bash
pnpm cli --env-file .env <command> [...args]
```

#### Tenant commands

| Command                      | Description                               |
| ---------------------------- | ----------------------------------------- |
| `tenant:create <name>`       | Create a new tenant (auto-generates slug) |
| `tenant:list`                | List all tenants                          |
| `tenant:activate <tenantId>` | Activate a tenant                         |
| `tenant:suspend <tenantId>`  | Suspend a tenant                          |
| `tenant:delete <tenantId>`   | Delete tenant and all related data        |
| `redis:flush <tenantId>`     | Delete all Redis state keys for a tenant  |

#### User commands

| Command                              | Description                                                      |
| ------------------------------------ | ---------------------------------------------------------------- |
| `user:add <email> <tenantId> [role]` | Add a user (role: `owner`\|`admin`\|`viewer`, default: `viewer`) |
| `user:list <tenantId>`               | List users for a tenant                                          |
| `user:remove <userId>`               | Remove a user                                                    |
| `user:set-role <userId> <role>`      | Change a user's role                                             |
