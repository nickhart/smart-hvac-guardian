# IFTTT applet reference

Every applet in this system, what it carries, and how to verify it works.

There is no API for managing your own IFTTT applets — the Platform API is for
companies building IFTTT services, not end users — so this is a manual job
forever, and the record matters more than it otherwise would.

## Property-specific values

Not recorded here: this repository is public, and the tenant id together with
the webhook secret is what authenticates a webhook. Keep them in a password
manager alongside the YoLink device ids.

| Placeholder  | Where to find it                                          |
| ------------ | --------------------------------------------------------- |
| `{domain}`   | The deployed app's hostname                               |
| `{tenantId}` | The tenant's id — appears in every webhook path           |
| `{secret}`   | The tenant's webhook secret, if one is configured         |
| `{sensorId}` | YoLink device id, e.g. `d88b4c…` — one per door or window |

`{secret}` is optional: `resolveTenantFromWebhook` only checks it when the
tenant has one configured. When it does, a request without it 404s — which
looks exactly like a wrong tenant id, so check both before concluding either.

## Inbound: YoLink door and window sensors

Two applets per sensor. Both post to the same endpoint; only `event` differs.

- **Trigger** — YoLink, "Sensor opened" / "Sensor closed", for one device
- **Action** — Webhooks, "Make a web request"
  - URL `https://{domain}/api/t/{tenantId}/sensor-event`
  - Method `POST`, content type `application/json`
  - Header `Authorization: Bearer {secret}` (omit if no secret is configured)

```json
{ "sensorId": "{sensorId}", "event": "open" }
```

`event` is `"open"` or `"close"` — note **`close`, not `closed`**, which is the
easiest thing to get wrong here. The handler rejects anything else with a 400.

## Inbound: Cielo HVAC state

Two applets per unit. These are what make a shutoff verifiable — without the
"powered off" side there is no evidence any shutoff took effect, because IFTTT
returns 200 whether an applet is listening or not.

- **Trigger** — Cielo, "Device is powered on" / "Device is powered off", one device
- **Action** — Webhooks, "Make a web request"
  - URL `https://{domain}/api/t/{tenantId}/hvac-event`
  - Method `POST`, content type `application/json`

```json
{ "hvacId": "living_room", "event": "off" }
```

| `hvacId`       | Unit         |
| -------------- | ------------ |
| `living_room`  | Living Room  |
| `main_bedroom` | Main Bedroom |
| `loft_bedroom` | Loft Bedroom |
| `back_bedroom` | Back Bedroom |

An unrecognised `hvacId` returns 404, which surfaces as a failed run in IFTTT's
own activity log — so that particular typo fails loudly at both ends.

## Outbound: shutoff commands

These are triggered by us, not by a device, so they are the one set that cannot
be consolidated: each carries a distinct event name.

- **Trigger** — Webhooks, "Receive a web request", event name below
- **Action** — Cielo, "Turn off device", for the matching unit

| Event name              | Unit         |
| ----------------------- | ------------ |
| `turn_off_living_room`  | Living Room  |
| `turn_off_main_bedroom` | Main Bedroom |
| `turn_off_loft_bedroom` | Loft Bedroom |
| `turn_off_back_bedroom` | Back Bedroom |

The event names must match `hvacUnits[].iftttEvent` in the app config exactly.
A mismatch is silent: the trigger fires, IFTTT accepts it, and no applet acts.

## Count

```
10  sensor      (5 × opened/closed)
 8  hvac state  (4 × on/off)
 4  shutoff
──
22               requires Pro+; Pro caps at 20
```

None of the inbound ones can be consolidated. Both services expose per-device
triggers only, and filter code runs _after_ a trigger fires, so it cannot widen
what an applet listens to.

## Verifying an applet actually works

Creating an applet is not evidence it works. Each one has a query that shows it.

**A sensor applet** — open or close the door, then:

```sql
SELECT timestamp, sensor_id, event FROM sensor_events_v2
ORDER BY timestamp DESC LIMIT 5
```

**An HVAC state applet** — switch the unit on or off in the Cielo app, then:

```sql
SELECT timestamp, hvac_id, event FROM hvac_state_events_v2
ORDER BY timestamp DESC LIMIT 5
```

Check each unit individually. A typo in one of four is a per-unit failure, and
nothing else in the system will tell you about it.

**A shutoff applet** cannot be verified by its HTTP response — that is the whole
problem. It needs the state applet above: fire the turn-off, then confirm an
`off` event follows within a minute or two.
