# Roadmap

## Implemented

### Zone-aware AC control

Per-zone HVAC control using interior door sensors to determine connected components. Zones connected by open interior doors form a single component; only HVAC units in components exposed to an open exterior opening get shut off.

- **Zone graph evaluation:** BFS over zones connected by open interior doors determines connected components.
- **Cancellation tokens:** Each timer stores a UUID in Redis. Closing a door deletes the token; when QStash fires, a mismatched/missing token means the timer was cancelled.
- **Per-sensor delays:** Each exterior sensor has its own `delaySeconds`. When multiple are open in a component, the minimum delay is used.
- **HVAC-on re-scheduling:** When an HVAC unit turns on while in an exposed zone, a new turn-off timer is scheduled automatically.

### Remote delay configuration

Per-unit delay overrides stored in Redis (`delay:<unitId>` keys), falling back to `APP_CONFIG` defaults when no override exists. Exposed via `GET/POST /api/unit-delay` and editable from the web dashboard.

### System on/off toggle

A Redis flag (`system:enabled`) checked at the top of `sensor-event` and `hvac-event` handlers. When disabled, sensor state is still recorded but no timers are scheduled and no turn-off commands are sent. Controllable via `GET/POST /api/system-toggle` and from the web dashboard.

### Offline sensor handling

Sensors with no recorded state in Redis are treated as **closed** (safe default — AC stays on). A two-tier approach: first, per-sensor `sensorDefaults` from config are applied, then any remaining unknown sensor defaults to `"closed"`. The dashboard displays offline sensors.

### Resend integration

[Resend](https://resend.com) is integrated as the transactional email provider, used for magic link login emails.

### Magic link authentication

Email-based login with no passwords. The owner submits their email, receives a magic link via Resend, and clicking it creates a 7-day `HttpOnly` session cookie. Only `OWNER_EMAIL` is allowed to log in.

### Web dashboard

React 19 + Vite + Tailwind CSS app (`web/` directory). Shows real-time sensor states, HVAC unit exposure status, active timers, per-unit delay overrides, and a system toggle. Polls `/api/check-state` every 10 seconds.

### Tinybird analytics

Event tracking via [Tinybird](https://tinybird.co) for sensor events, HVAC commands, and HVAC state changes. Includes query pipes for shutoffs per day, sensor trigger frequency, and recent activity. Gracefully degrades to a no-op when `TINYBIRD_TOKEN` is not set.

---

## Planned / Future

### Email notifications

- Sensor open alerts (e.g. "Kitchen window has been open for 10 minutes")
- HVAC turn-off confirmations
- System error alerts (provider failures, QStash issues)

### Web configuration UI

Browser-based UI to manage sensors, HVAC units, IFTTT event names, and delay timers. Replaces manual `APP_CONFIG` environment variable editing.

### Shutoff analytics dashboard

- History view showing sensor, HVAC, timer, and shutoff activity over time
- Metrics view showing shutoff frequency over configurable time periods (day, week, month, custom ranges)
- Per-sensor breakdown of trigger frequency

### HVAC state tracking in Redis

Persist HVAC on/off state from `hvac-event` to avoid scheduling redundant turn-off timers for units that are already off. Currently the system uses "fire and forget" — a redundant IFTTT turn-off call is harmless but wasteful.

Considerations:

- Potential side effects of firing "off" to an already-off unit (extra beep from the HVAC)
- Race condition: user turns on HVAC locally while a pending turn-off fires at the same time
