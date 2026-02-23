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

## handle offline sensors

- if a sensor is offline treat it as closed
- if IFTTT, Cielo, or YoLink is down, temporarily disable the AC shutoff system
- we don't want dead batteries or service outages to result in guests being unable to use the AC

## minimal web UI

- have a basic index with an email login form
- add OWNER_EMAIL to the environment (eg: OWNER_EMAIL=<nickhart@gmail.com>)
- add support for email/OTP auth with resend.dev
- for now we only support the OWNER_EMAIL
- once logged in show a dashboard with the current state of the sensors and hvac units
- if possible use the qstash/redis state to show any active timers for the hvac units
- at some point plan a history view which shows sensor, hvac, timer, and shutoff activity
- at some point plan a metrics view which shows how often shutoff activity occurs over a time period
  - over a day, week, month, year?
  - allow one to choose the exact time period
  - eg: the past 24 hours, or a previous 24 hour period
  - eg: over the past week, or a specific 7 day period
  - etc...

## tracking HVAC state in redis

Your first question — valid concern. The system currently has no concept of HVAC power state. It treats "exposed" as "needs a turn-off timer" regardless of whether the unit is already off. So yes, if you open the front door, the living room AC gets turned off, and then you open the lanai door, it would schedule another turn-off for the already-off AC (which is harmless but wasteful — IFTTT just gets a redundant call).

The system doesn't track HVAC on/off state in Redis today. The hvac-event endpoint receives on/off events but doesn't persist them. To skip unnecessary timers, you'd need to store HVAC power state and check it before scheduling. That's a production code change though — want me to look into it, or are you happy with the current "fire and forget" behavior since the redundant turn-off is a no-op?

concerns:

- potential side effects of firing an "off" to an already off hvac
  - an extra unwanted "beep" from the hvac if it is already off? (not sure, need to test this!)
  - race condition: maybe I turned it on locally and the turn off logic on the server fires at the same time, immediately shutting off the hvac that I just turned on. probably an edge case, but could be annoying

## improve login to use magic links

- support magic links and don't require the user to enter the OTP

## build an onboarding experience

- use a stepper flow (show how many steps are in the flow, show progress as each step is complete)
- walk the user through adding keys/tokens for each service
  - offer some basic how-to info on setting up an account with the service down below
- walk the user through configuring zones
- let the user pick a default delay for all the hvac units
- walk the user through setting up all of the IFTTT applets

## better integrate system shutoff into the overall architecture

- bug: shutoff was still sent when timer was fired!
- system shutoff should cancel timers
- system shutoff should prevent firing shutoff events, in case of a race condition
- verify we keep performing analytics even when off

## ~~consolidate all my third party services to the same region~~

All regionable services already consolidated in **US-East**:
- Tinybird: us-east AWS
- Upstash Redis: us-east-1
- Upstash QStash: us-east-1
- IFTTT, YoLink, Resend: global services (no region selection)
