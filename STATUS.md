# Status

Current state of implemented features and known gaps.

## Completed

### Zone-aware AC control

Per-zone HVAC control using interior door sensors. BFS over zones connected by open interior doors determines connected components. Only HVAC units in exposed components get shut off. Per-unit timers with UUID-based cancellation tokens in Redis.

### Remote delay configuration

Per-HVAC-unit delay overrides stored in Redis (`delay:{hvacUnitId}` keys), with fallback to `APP_CONFIG` defaults. Exposed via `POST /api/unit-delay`. Configurable from the dashboard via a delay preset dropdown on each HVAC unit card.

### System on/off toggle

Redis flag (`system:enabled`) checked in `sensor-event`, `hvac-event`, and `hvac-turn-off` handlers. When disabled, events are logged but no timers are scheduled and no turn-off commands are sent. Controllable from the dashboard via `SystemToggle` component. On re-enable, zones are re-evaluated and timers scheduled as needed.

### Resend.dev integration

Resend is used as the transactional email provider for magic-link login emails.

### User authentication (magic links)

Email/magic-link login flow — no passwords, no OTP entry. Only `OWNER_EMAIL` is supported. Sessions stored in Redis with 7-day TTL. Logout clears session.

### Web dashboard

Production SPA (`web/`) with adaptive polling (3s active / 5s idle / 15s hidden) and SSE in dev mode. Shows sensor cards (open/closed/offline), HVAC unit cards (exposed/safe/timer countdown), system toggle, and per-unit delay configuration.

### Dev dashboard

Vanilla HTML/JS dashboard served by `dev/server.ts` with full SSE real-time updates. Live sensor/HVAC toggle buttons, countdown timers, and event log.

### Offline sensor handling (partial)

Offline or unknown sensors are treated as closed (safe default — AC stays on). Dashboard renders offline sensors with a yellow badge. Service outage auto-disable is **not** implemented.

### Shutoff analytics (partial)

Event tracking via Tinybird (not Redis sorted sets as originally planned). Three datasources: `sensor_events`, `hvac_commands`, `hvac_state_events`. Tinybird endpoints defined for `shutoffs_per_day`, `sensor_trigger_frequency`, `recent_activity`, `exposure_duration`. **No analytics dashboard page** exists yet.

### System shutoff integration (partial)

Race condition fix: `hvac-turn-off.ts` checks `system:enabled` before executing, even if the timer fired. However, active timers are **not proactively cancelled** on disable — they simply no-op when they fire.

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

### Service outage auto-disable

If IFTTT, Cielo, or YoLink is down, temporarily disable the AC shutoff system to avoid locking guests out of AC.

### Onboarding experience

Stepper wizard to walk new users through: adding service keys/tokens, configuring zones, setting default delays, setting up IFTTT applets.

### Multi-tenant hosted service

See [ROADMAP.md](./ROADMAP.md) for the full exploration of what it would take to support multiple clients.
