# Status

Current state of implemented features and known gaps.

## Completed

### Zone-aware AC control

Per-zone HVAC control using interior door sensors. BFS over zones connected by open interior doors determines connected components. Only HVAC units in exposed components get shut off. Per-unit timers with UUID-based cancellation tokens in Redis.

### Remote delay configuration

Per-HVAC-unit delay overrides stored in Redis (`delay:{hvacUnitId}` keys), with fallback to `APP_CONFIG` defaults. Exposed via `POST /api/unit-delay`. Configurable from the dashboard via a delay preset dropdown on each HVAC unit card.

### System on/off toggle

Redis flag (`system:enabled`) checked in `sensor-event`, `hvac-event`, and `hvac-turn-off` handlers. Controllable from the dashboard via the `SystemToggle` component. On re-enable, zones are re-evaluated and timers scheduled as needed.

**Disabled now means shadow mode**, not silence: zones are still evaluated, timers are still scheduled, and `hvac-turn-off` still records the turn-off it would have performed, flagged `shutoff_enabled = 0`. Only the IFTTT call is withheld, by the guard in `api/hvac-turn-off.ts`. This makes it possible to review the system's decisions before trusting it to act. `tests/integration/shadow-mode.test.ts` pins the guarantee that a disabled system never reaches the HVAC.

### Resend.dev integration

Resend is used as the transactional email provider for magic-link login emails, sending from a verified `acsavr.com` address (override with `EMAIL_FROM`).

All sending goes through `createResendSender()` in `src/utils/email.ts`, which **throws when Resend returns an error**. `resend.emails.send()` resolves with `{ data, error }` rather than rejecting, so an unchecked call reports success on a rejected send — that silently broke login for months.

### User authentication (magic links)

Email/magic-link login flow — no passwords, no OTP entry. Users are looked up in the database for multi-tenant deployments, falling back to `OWNER_EMAIL` for single-tenant. Sessions stored in Redis with 7-day TTL. Logout clears the session.

### Web dashboard

Production SPA (`web/`) with adaptive polling (3s active / 5s idle / 15s hidden) and SSE in dev mode. Shows sensor cards (open/closed/offline), HVAC unit cards (exposed/safe/timer countdown), system toggle, and per-unit delay configuration.

### Dev dashboard

Vanilla HTML/JS dashboard served by `dev/server.ts` with full SSE real-time updates. Live sensor/HVAC toggle buttons, countdown timers, and event log.

### Offline sensor handling (partial)

Offline or unknown sensors are treated as closed (safe default — AC stays on). Dashboard renders offline sensors with a yellow badge. Service outage auto-disable is **not** implemented.

### Shutoff analytics (partial)

Event tracking via Tinybird (not Redis sorted sets as originally planned). Four datasources: `sensor_events_v2`, `hvac_commands_v2`, `hvac_state_events_v2` and `provider_events_v2`, all carrying `tenant_id` and `shutoff_enabled`. Endpoints exist for `shutoffs_per_day`, `sensor_trigger_frequency`, `recent_activity`, `exposure_duration` and `hvac_runtime`.

`src/lib/tinybird.ts` is the deploy source of truth — see [analytics.md](./analytics.md). The `.datasource` files are documentation.

The `provider_health` endpoint groups provider calls by provider and outcome, so circuit-breaker state and upstream failures are queryable without opening the Tinybird console.

Gap: **no analytics dashboard page** — the endpoints exist, nothing renders them.

### System shutoff integration (partial)

Race condition fix: `hvac-turn-off.ts` checks `system:enabled` before executing, even if the timer fired. Active timers are deliberately **not** cancelled on disable — they fire and are recorded as shadow decisions, which is the point of shadow mode.

### Health endpoint

`GET /api/health` — unauthenticated probe for an external uptime monitor, reporting per-dependency status without exposing config or credentials. Returns 503 when Redis or config fails; unconfigured optional services report `not_configured`. See the README.

### CI safety nets

- `no-floating-promises` and `no-misused-promises` are enabled (type-aware, scoped to files `tsconfig.json` covers). A dropped analytics promise on Edge runtime is now a lint error rather than a silent data loss.
- `pnpm test:e2e` runs in CI — 7 full sensor-to-turn-off scenarios that previously only ran locally.
- Node 24 across CI, the devcontainer and `engines`, with actions on their Node 24-native majors.

## Not Started

### Analytics dashboard

Charts and visualizations for shutoff history, frequency trends, per-sensor breakdown. Time-range picker for viewing specific periods.

### Web configuration UI

Browser-based management of sensors, HVAC units, zones, IFTTT event names. Currently all config lives in the `APP_CONFIG` environment variable.

### Email notifications

- Sensor open alerts (e.g. "Kitchen window open for 10 minutes")
- HVAC turn-off confirmations
- System error alerts (provider failures, QStash issues)

### HVAC state tracking in Redis

Persist HVAC on/off state from `hvac-event` to avoid redundant turn-off commands. Open questions: extra beep from redundant off command, race condition with manual on.

### Service outage auto-disable (partial)

A Redis-backed circuit breaker (`src/utils/circuit-breaker.ts`) opens after repeated IFTTT failures and skips calls for a cooldown, tripping immediately on a terminal failure such as a bad webhook key. QStash retries are capped at 1 so one turn-off cannot become four failure notifications, and terminal or circuit-open failures return 200 so QStash stops retrying. Outcomes are recorded to `provider_events_v2`.

Still open: extending the breaker to YoLink, and surfacing circuit state in the dashboard.

### Onboarding experience

Stepper wizard to walk new users through: adding service keys/tokens, configuring zones, setting default delays, setting up IFTTT applets.

### Multi-tenant hosted service

See [ROADMAP.md](./ROADMAP.md) for the full exploration of what it would take to support multiple clients.
