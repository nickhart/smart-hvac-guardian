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

| Variable                      | Description                                    |
| ----------------------------- | ---------------------------------------------- |
| `APP_CONFIG`                  | JSON string with app configuration (see below) |
| `YOLINK_UA_CID`              | YoLink API UA Client ID                        |
| `YOLINK_SECRET_KEY`           | YoLink API Secret Key                          |
| `IFTTT_WEBHOOK_KEY`           | IFTTT Webhooks service key                     |
| `QSTASH_TOKEN`                | Upstash QStash token                           |
| `QSTASH_CURRENT_SIGNING_KEY`  | QStash current signing key                     |
| `QSTASH_NEXT_SIGNING_KEY`     | QStash next signing key                        |
| `UPSTASH_REDIS_REST_URL`      | Upstash Redis REST URL                         |
| `UPSTASH_REDIS_REST_TOKEN`    | Upstash Redis REST token                       |

#### Optional

| Variable         | Description                                          |
| ---------------- | ---------------------------------------------------- |
| `RESEND_API_KEY`  | Resend API key (required for magic link auth)        |
| `OWNER_EMAIL`     | Email address allowed to log in to the dashboard     |
| `APP_URL`         | Public app URL for magic link emails (e.g. `https://your-app.vercel.app`) |
| `TINYBIRD_TOKEN`  | Tinybird auth token (enables analytics tracking)     |
| `TINYBIRD_URL`    | Tinybird API base URL                                |

### APP_CONFIG Format

The `APP_CONFIG` environment variable is a JSON string validated against a Zod schema:

```jsonc
{
  "zones": {
    "living-room": {
      "minisplits": ["unit-lr"],
      "exteriorOpenings": ["sensor-front-door", "sensor-window-1"],
      "interiorDoors": [{ "id": "sensor-hallway-door", "connectsTo": "bedroom" }]
    },
    "bedroom": {
      "minisplits": ["unit-br"],
      "exteriorOpenings": ["sensor-bedroom-window"],
      "interiorDoors": [{ "id": "sensor-hallway-door", "connectsTo": "living-room" }]
    }
  },
  "sensorDelays": {
    "sensor-front-door": 90,
    "sensor-window-1": 120,
    "sensor-bedroom-window": 120,
    "sensor-hallway-door": 0
  },
  "hvacUnits": {
    "unit-lr": { "name": "Living Room AC", "iftttEvent": "turn_off_lr", "delaySeconds": 300 },
    "unit-br": { "name": "Bedroom AC", "iftttEvent": "turn_off_br", "delaySeconds": 300 }
  },
  "sensorNames": {
    "sensor-front-door": "Front Door",
    "sensor-window-1": "Living Room Window"
  },
  "sensorDefaults": {
    "sensor-window-1": "closed"
  },
  "yolink": {
    "baseUrl": "https://api.yosmart.com/open/yolink/v2/api"
  },
  "turnOffUrl": "https://your-app.vercel.app/api/hvac-turn-off"
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

| Method | Endpoint              | Description                                                    |
| ------ | --------------------- | -------------------------------------------------------------- |
| POST   | `/api/sensor-event`   | Receives sensor open/close events from IFTTT                   |
| POST   | `/api/hvac-event`     | Receives HVAC on/off events; re-schedules turn-off if exposed  |
| POST   | `/api/hvac-turn-off`  | QStash callback that executes the IFTTT turn-off command       |
| GET    | `/api/check-state`    | Returns full system snapshot (sensors, units, timers, offline) |
| GET/POST | `/api/system-toggle` | Read or set the system-wide enable/disable flag              |
| GET/POST | `/api/unit-delay`   | Read or set per-unit delay overrides                          |

### Auth

| Method | Endpoint              | Description                              |
| ------ | --------------------- | ---------------------------------------- |
| POST   | `/api/auth/send-magic`| Sends a magic link login email           |
| GET    | `/api/auth/magic`     | Redeems a magic link token, sets session |
| GET    | `/api/auth/session`   | Checks current authentication status     |
| POST   | `/api/auth/logout`    | Clears the session cookie                |

## Web Dashboard

A React 19 + Vite + Tailwind CSS app in the `web/` directory. Once authenticated, it displays:

- Real-time sensor states (open/closed/offline) with 10-second polling
- HVAC unit exposure status and active timer badges
- Per-unit delay override controls
- System-wide enable/disable toggle

The Vite dev server proxies `/api/*` to the local backend.

## Authentication

The app uses **magic link** login — no passwords. When a user submits their email:

1. `POST /api/auth/send-magic` validates the email against `OWNER_EMAIL` and sends a login link via **Resend**
2. Clicking the link hits `GET /api/auth/magic`, which validates the token, creates a 7-day session in Redis, and redirects to `/` with an `HttpOnly` session cookie
3. Subsequent requests are authenticated via the `session` cookie checked by `/api/auth/session`

Only the `OWNER_EMAIL` address is allowed to log in. Requires `RESEND_API_KEY`, `OWNER_EMAIL`, and `APP_URL` to be set.

## Local Development

```bash
pnpm install        # install dependencies
pnpm test           # run unit tests (vitest)
pnpm test:watch     # run tests in watch mode
pnpm test:coverage  # run tests with coverage
pnpm test:e2e       # run end-to-end tests
pnpm dev            # start local dev server
pnpm dev:fast       # start dev server with 0.033x delay scaling
pnpm type-check     # TypeScript validation
pnpm lint           # ESLint
pnpm format         # Prettier format
pnpm web:dev        # start the web dashboard dev server
pnpm web:build      # build the web dashboard for production
```
