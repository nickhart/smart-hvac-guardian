# Roadmap

## Zone-aware AC control via internal door sensors

**Status: Implemented**

Per-zone HVAC control using interior door sensors to determine connected components. Zones connected by open interior doors form a single component; only HVAC units in components exposed to an open exterior opening get shut off. Includes per-HVAC-unit timers with proactive cancellation via Redis tokens.

- **Zone graph evaluation:** BFS over zones connected by open interior doors determines connected components.
- **Cancellation tokens:** Each timer stores a UUID in Redis. Closing a door deletes the token; when QStash fires, a mismatched/missing token means the timer was cancelled.
- **Per-sensor delays:** Each exterior sensor has its own `delaySeconds`. When multiple are open in a component, the minimum delay is used.

## Remote delay configuration

Ability to change per-sensor delay values without redeploying. Store delay overrides in Redis (`delay-override:{sensorId}` keys), falling back to `APP_CONFIG.sensorDelays` defaults when no override exists.

- Expose a simple API endpoint (`POST /api/config/delays`) for updating overrides.
- Read overrides in `sensor-event` and `hvac-event` handlers when computing timer delays.
- Future: integrate into web configuration UI.

## System on/off toggle

A Redis flag (`system:enabled`) checked at the top of `sensor-event` and `hvac-event` handlers. When disabled:

- All events are logged as usual.
- No timers are scheduled and no turn-off commands are sent.
- Active timers are not cancelled (they will expire naturally or be cancelled on re-enable).

Controllable via a simple API endpoint (`POST /api/system/toggle`) or future dashboard.

## Shutoff analytics (Upstash Redis)

Track how often auto-shutoffs happen, which sensors trigger them, and observe patterns over time (e.g. guests learning the system).

Uses **Upstash Redis** (already an Upstash customer via QStash; free tier: 10K commands/day, 256 MB).

- **Storage model:** Each shutoff event is stored as a sorted-set entry (score = Unix timestamp).
  - Key structure: `shutoffs:{YYYY-MM}` — monthly buckets for easy range queries and automatic expiry.
  - Event payload: `{ timestamp, sensorId, sensorName, hvacUnitsAffected, triggerSource }` where `triggerSource` is `"hvac-on"` or `"sensor-open"`.
- **Query patterns:** shutoffs per day/week, most-triggered sensor, frequency trends over time.
- **Phase 1 — instrument:** Write events to Redis from `api/hvac-turn-off.ts` on each successful turn-off.
- **Phase 2 — dashboard:** Build a simple Next.js page showing shutoff history, frequency charts, and per-sensor breakdown.
- **Future:** Add guest/unit context (which HVAC unit was on that triggered the check).

## Resend.dev integration

Add [Resend](https://resend.com) as the transactional email provider for user-facing features.

## User accounts and authentication

- Email/OTP (magic link) login — no passwords
- Account ties together a user's sensor and HVAC configuration

## Web configuration UI

- Browser-based UI to manage sensors, HVAC units, IFTTT event names, and delay timers
- Replaces manual environment variable / config file editing

## Web dashboard

- Live view of sensor states (open/closed) and HVAC unit status (on/off)
- Event history log (sensor events, HVAC commands, errors)

## Email notifications

- Sensor open alerts (e.g. "Kitchen window has been open for 10 minutes")
- HVAC turn-off confirmations
- System error alerts (provider failures, QStash issues)
