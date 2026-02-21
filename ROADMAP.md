# Roadmap

## Zone-aware AC control via internal door sensors

Currently, when any sensor detects an open window or door, all HVAC units are turned off. A smarter approach would allow per-zone control:

- **Concept:** If a bedroom door is shut and that bedroom's window is also shut, the AC in that bedroom can stay on — even if open windows/doors elsewhere in the condo require AC to be off in those areas.
- **Hardware needed:** Internal door sensors (e.g. YoLink door sensors on bedroom doors). Not yet purchased.
- **Config changes:** Define zones (rooms), associate each sensor and HVAC unit with a zone. A zone is "sealed" when all its entry points (door + windows) are closed.
- **Logic changes:** Turn-off decisions become per-zone. A zone's HVAC is only turned off if that zone has an open sensor, or if the zone's door is open and an adjacent zone has an open sensor (cascading exposure).

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
