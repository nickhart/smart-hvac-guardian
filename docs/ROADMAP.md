# Roadmap

Forward-looking features and explorations. See [STATUS.md](./STATUS.md) for what's already been built.

---

## Near-term

### Onboarding UX improvements

- **Interior door assignment rework**: Dedicated step or section where the user picks a sensor marked as interior, then selects which two zones it connects — instead of configuring interior doors within each zone's card. This makes the mental model clearer and avoids duplicate/conflicting entries.
- **Zone-centric HVAC/sensor assignment**: Rather than toggling items per-zone, define which zone each HVAC unit and exterior sensor belongs to (single-owner), with validation that every item is assigned exactly once.

### IFTTT applet setup wizard

Creating the IFTTT applets is the longest and most error-prone part of setup, and nothing in the app helps with it. Activation shows the two webhook URLs and the secret once; the README explains the rest. A property with S sensors and U units needs `2S + 3U` applets — 22 for five sensors and four units — each typed by hand into IFTTT's editor. A mistake is silent, because IFTTT returns 200 whether or not an applet is listening.

A second wizard, reachable from Settings after activation, that turns the tenant's config into a checklist of every applet and everything to paste into it:

| Applets         | IFTTT trigger                                              | IFTTT action                                         | Body                                             |
| --------------- | ---------------------------------------------------------- | ---------------------------------------------------- | ------------------------------------------------ |
| 2 per sensor    | YoLink: _sensor_ opens / closes                            | Webhooks: make a web request to the sensor-event URL | `{"sensorId":"<id>","event":"open"}` / `"close"` |
| 2 per HVAC unit | Cielo: _unit_ powered on / off                             | Webhooks: make a web request to the hvac-event URL   | `{"hvacId":"<id>","event":"on"}` / `"off"`       |
| 1 per HVAC unit | Webhooks: receive a web request, event `turn_off_<unitId>` | Cielo: turn _unit_ off                               | —                                                |

- **A copy button on every field**: URL, method, content type, `Authorization` header, body, event name. Device names are shown as YoLink and Cielo show them, so the right trigger is easy to find.
- **Check each applet as it's created.** The app already receives the events these applets send, so the wizard can wait for one: "open the Front Door now", then ✓ when a `sensor-event` for that sensor arrives. Powered on/off works the same way. Turn-off applets can only be checked by firing the event, as the onboarding Test step does, and asking the user to confirm the unit responded (see [Verify the shutoff actually happened](#verify-the-shutoff-actually-happened)).
- **Progress is saved**, so the applets can be done over several sittings. The checklist can be reopened when a sensor or unit is added, showing only what's new.

**Design question: the webhook secret.** Every sensor and HVAC-state applet needs the `Authorization` header, but the secret is shown once at activation and stored encrypted. Options:

1. Show the header with a placeholder and have the user paste in the secret they saved. The minimum.
2. Let the owner reveal the secret again after re-authenticating.
3. A "rotate secret" action: a new secret, shown once, used in every applet from then on. It suits a full re-setup and breaks existing applets otherwise. It's also the missing answer to a leaked secret, for which there's no path today.

**Bonus: automate applet creation with Playwright.** IFTTT has no API for managing applets (the Platform API is for companies building IFTTT services), so the only automation is driving ifttt.com in a browser. That's plausible as a script the owner runs on their own machine, headed. They sign in themselves (Playwright can reuse the session), and the script fills in each applet from the same list the wizard generates. Before building it:

- Check IFTTT's terms of service on automated use of the website.
- Expect it to break: IFTTT's editor changes without notice, and one selector change breaks the script. Worth it only if the manual wizard still proves painful at 20+ applets.
- Never store IFTTT credentials, and never run it server-side.
- Keep it a helper outside the product. The wizard's checklist and per-applet checks stay the source of truth for whether an applet works.

### Analytics dashboard

Build a dashboard page showing shutoff history, frequency charts, and per-sensor breakdown using the existing Tinybird endpoints (`shutoffs_per_day`, `sensor_trigger_frequency`, `recent_activity`, `exposure_duration`).

- Time-range picker: past 24h, past week, specific date range
- Per-sensor and per-unit drill-down
- Trend visualization (are guests learning the system?)

### Dashboard surfacing for health and sensor verification

Both diagnostics exist as endpoints but have no UI, so using them means typing a
URL. Put them on the SPA dashboard — with different exposure rules, because they
are not the same kind of endpoint.

**`/api/health`** stays unauthenticated. That is deliberate: it has to be
pollable by an uptime monitor precisely when auth is broken, and it reports only
`ok` / `fail` / `not_configured` per check, never config values or error
details. So the endpoint itself is safe to leave open — the ask is not to
_advertise_ it. Render the health widget only for signed-in users; no link, no
status badge, nothing in the signed-out shell for a bot to follow. Keep it out
of any sitemap, and `noindex` the route if one is added.

**`/api/check-state?verify=yolink`** is the opposite: it is authenticated and
must stay that way, because sensor states reveal the property's occupancy
pattern. It also costs a YoLink round trip per sensor, so it must be a
deliberate button press, never something that fires on page load or on a poll.
Show `checked` / `agreed` / `drifted` with sensor names rather than raw device
IDs, and treat `unavailable` and `deadlineExceeded` as distinct from drift —
the first two mean we could not ask, not that anything disagrees.

Worth showing alongside: circuit state per provider, which "Service outage
auto-disable" below also wants.

### HVAC state tracking in Redis

**Priority: before the shutoff applets go live in February.** Today the system
has no idea whether a unit is already off, so it re-issues turn-offs for as long
as a zone stays exposed. On 2026-09-26 one door stood open for four hours; each
turn-off cleared its timer, the next door event anywhere scheduled another, and
three units each collected **11 turn-offs** for that one exposure. In the dry run
that is only noise. Live, it is eleven redundant IFTTT calls per unit — each a
beep, and each a chance to switch off a unit a guest has just turned back on.

**The reported state can't be the source of truth.** It arrives through Cielo's
IFTTT triggers, and the September data shows how thin that is: the "powered
off" applets have never run except in a manual test (guests leave the AC on),
and on 2026-09-26 a "powered on" trigger failed on Cielo's side — _"There was a
problem with the trigger"_ — so the event never reached us at all. Cielo offers
no API to ask instead.

So track what the system itself knows, and treat reported events as hints:

- After a turn-off, record the unit as off-by-us, and don't issue another while
  the same exposure lasts. A reported `on` clears it; so does the exposure
  ending.
- The cost: if the turn-off silently failed, nothing retries it. Worth a bounded
  retry — say one more after a set interval — rather than none or unlimited.
- Open concerns carried over:
  - Does a redundant IFTTT "off" command cause an extra beep?
  - Race: a guest turns the unit on just as a stale turn-off fires.

### Order sensor events by when they happened

Events are applied in the order they arrive, and the last write wins. On
2026-09-25 at 21:40:25 a door bounced; its `close` and `open` webhooks arrived
in the same second and were applied open-last, so the system believed the door
open while it was shut. The pre-shutoff YoLink check caught it ten minutes later
and aborted the turn-offs — the safety net working — but the belief was wrong
until then, and any other decision in that window used it.

IFTTT exposes when the trigger fired (the YoLink trigger's `CreatedAt`
ingredient). Add it to the applet body as an optional `occurredAt`, keep the
latest time applied per sensor, and ignore anything older. Without the field,
behave as today, so existing applets keep working. Check the ingredient's format
and precision first — if it is only to the minute, it can't order a bounce.

### Flag sensors that go quiet

One of five sensors reported 18 events in its first week, then nothing
after 2026-09-24 while the other four stayed busy. It may be a door nobody uses;
it may be a dead battery or a broken applet. The system fails safe — a silent
sensor is treated as closed, so the AC keeps running — but that also means the
protection for that opening is quietly gone.

Flag a sensor whose silence is long for its usual rate, and confirm with YoLink
(the `?verify=yolink` check already reports unreachable devices). Belongs on the
dashboard next to the sensor check ("Dashboard surfacing for health and sensor
verification"), not in `/api/health`.

### ~~Proactive timer cancellation on system disable~~ (superseded)

Dropped in favour of **shadow mode**, which needs those timers to keep firing.
When the system is disabled it now still evaluates zones, schedules timers and
records the turn-offs it _would_ have performed, flagged `shutoff_enabled = 0`.
Only the IFTTT call is withheld. Cancelling the timers on disable would destroy
exactly the signal shadow mode exists to capture.

### Energy correlation dashboard

Measure how long each HVAC unit runs _while exposed to the exterior_ — the
wasted runtime the whole system exists to prevent — and correlate it with
utility bills, with alerts when kWh over a period crosses a threshold.

Most of the raw material already exists:

- `exposure_duration` computes how long each unit was exposed, by ASOF-joining
  open/close events in `sensor_events_v2`.
- `hvac_runtime` computes how long each unit ran, by ASOF-joining on/off events
  in `hvac_state_events_v2`.

The missing piece is the **intersection** of those two interval sets: runtime
that overlaps an exposure window. That is one more pipe, not a new pipeline.

Then:

- A per-unit kWh estimate needs a rated draw per unit, which is a config
  addition (`hvacUnits[].wattsRated` or similar) — the system has no way to
  know it otherwise, and without it the dashboard can report wasted _hours_ but
  not wasted _dollars_.
- Threshold alerts want a scheduled job reading the pipe, reusing the email
  sender in `src/utils/email.ts`.
- With `shutoff_enabled` now recorded, the same query answers the question that
  justifies the project: wasted runtime with shutoff on versus off.

### Measure the savings while the shutoff applets are still disabled

The dry run is a natural experiment, and it expires. With the IFTTT shutoff
applets disabled, units keep running past the point where they would have been
shut off — so the wasted runtime the system exists to prevent is **directly
observable** rather than inferred. Once the applets are enabled the waste stops
happening, and with it the ability to measure what it was worth.

The measurement is the intersection described under "Energy correlation
dashboard": runtime that overlaps an exposure window, restricted to the portion
**past the configured delay**, since everything before it is intended behaviour.
`hvac_commands_v2` marks where each shutoff would have fired.

Worth capturing enough of this window to compare against February onwards. It
does not need the dashboard built first — a query and a note of the result is
enough to preserve the observation.

**Decide the question before picking a metric.** "How much does this save" is
four questions whose confidence degrades sharply:

1. How much wasted runtime occurs — measurable from data already collected.
2. What that runtime would have cost — needs a power model per unit, so it is
   only as good as the duty-cycle assumption.
3. What the system nets — needs a counterfactual and an allowance for load
   deferred to recovery rather than eliminated.
4. Whether the utility bill shows it — needs weather and occupancy controls,
   and the effect may be smaller than either confounder.

They are not stages of one calculation; they are separate claims with separate
evidence. Worth settling which one is being made, and stopping at the last one
the data actually supports, rather than quoting a figure from (4) that only (1)
underwrites.

Three things that will make the number wrong if ignored:

- **Nameplate wattage is a maximum, not an average.** Inverter minisplits
  modulate, often running far below rated draw once a room is near setpoint.
  Multiplying rated watts by wasted hours can overstate by a factor of two or
  more. Either measure actual draw, or state the duty-cycle assumption next to
  the number.
- **Avoided runtime is not all avoided energy.** Shutting a unit off with a
  door open defers cooling load; when the door closes, the unit works harder to
  recover. Some of the "saving" is deferred rather than eliminated. The gross
  figure is still worth having — it just is not the net.
- **Exposure alone is not waste.** Only exposure while the unit is actually
  running costs anything, which is why the intersection matters and why this
  depends on `hvac_state_events_v2` continuing to arrive. Those events come
  through IFTTT too, so confirm the state-reporting applets are enabled even
  while the shutoff ones are not.

### Verify the shutoff actually happened

IFTTT's webhook endpoint returns 200 whether an applet is listening or not, so
a successful trigger says nothing about whether the HVAC unit changed state. In
September 2026, 72 turn-offs recorded `outcome: ok` against IFTTT while every
applet was deliberately disabled and no unit moved. `provider_events_v2` looked
perfectly healthy throughout.

There is no way to ask IFTTT directly — no public API exposes applet status to
an end user; the Platform API is for companies building IFTTT services, and
applet management is UI-only. So the only honest signal is the effect:

```
hvac_commands_v2      action='turned_off'  @ T
hvac_state_events_v2  event='off'          @ T + δ   ← did this follow?
```

A turn-off with no corresponding state change within a couple of minutes is a
failed shutoff, whatever IFTTT reported. Run against the September data it would
have been 0 for 72.

**But a missing `off` is not proof of failure.** The `off` itself arrives
through a Cielo trigger, and those fail on Cielo's side: on 2026-09-26 a
"powered on" trigger reported _"There was a problem with the trigger"_ and never
posted. So the result is **confirmed** or **unconfirmed**, not succeeded or
failed — and an unconfirmed rate that stays high says more about the trigger
than about the shutoff.

**Prerequisite, now mostly met.** The "Device is powered off" applets did not
exist until 2026-09-25 — only "powered on" had ever been created — so this item
could not have produced a result at all, the signal it correlates against being
absent. All four now exist. `loft_bedroom` is verified in both directions. As of
2026-09-27 the other three "powered off" applets have never run — consistent
with guests never switching a unit off, but not yet proof they work — and a
typo in one of four is a per-unit failure nothing else reports.

One caveat to design around: HVAC state also arrives through IFTTT, so a silent
result means the chain is broken but not which link. It cannot separate "the
turn-off applet is disabled" from "the state-reporting applet is disabled".

Two weaker signals worth considering alongside, neither sufficient alone:

- **Silence detection.** A sensor that has not reported in N hours while others
  have. Costs nothing — the data is already in `sensor_events_v2` — but a
  uniformly dead IFTTT looks the same as a quiet house.
- **A loopback applet.** A dedicated `hvac_guardian_ping` webhook whose action
  posts back to us, proving the IFTTT path is alive. Tests the round trip
  without touching HVAC, but proves only that _that_ applet is enabled.

Belongs in the authenticated diagnostics, not `/api/health`: it needs real
queries, and it is per-tenant.

### Mark a completed shutoff so its retry cannot re-arm

**Low priority — do not build until the trigger condition below is met.**

A turn-off that succeeds but responds slowly is retried by QStash. The retry
finds no timer token (the successful run deleted it), sees the door still open,
and re-arms — leaving a timer nobody asked for:

```
t=0      Door opens. Token A, message queued for t=600.
t=600    Message arrives, token matches, IFTTT turn-off, AC off.
         Token deleted. Response is slow; QStash never sees the 200.
t=630    QStash retries with token A. No token stored, door still open
         → RE-ARM → token B, message queued for t=1230.
t=1200   Guest turns the AC on. Their hvac-event webhook is lost.
t=1230   The re-armed timer fires → AC off.
```

The guest gets 30 seconds instead of ten minutes, cut off by a timer they never
triggered. It needs two failures at once — a slow turn-off response and a lost
`on` event — but both have the same root cause, so they are correlated rather
than independent.

**The fix:** after a successful turn-off, write `shutoff-done:{unitId}:{token}`
with a short TTL. In the absent-token branch, check it before re-arming; if this
exact token already actuated, return 200 and do nothing.

**Key by token, never by unit.** A per-unit marker would suppress a _legitimate_
re-arm for a different, genuinely lost timer on the same unit inside the TTL —
trading one silent failure for another. Tokens are minted per exposure, so a
token-keyed marker suppresses only the message that already ran.

**Rejected alternative:** overwriting the timer token with a `"completed"`
sentinel, so the retry falls into the existing `superseded` branch. Elegant, but
`getActiveTimerUnitIds` scans `timer:*`, so the sentinel would make the unit look
armed and sensor events would decline to reschedule it for the whole TTL. A
separate key namespace avoids that.

If the marker write fails, behaviour degrades to today's. A try/catch is enough.

**Trigger condition:** `rearmed` rows with a small `late_by_seconds`, meaning
retries are landing on turn-offs that already completed. Parallelising the
scheduling loop may have removed the timeouts that make this reachable at all —
if that count stays at zero, this is machinery guarding an empty room. Build it
when the count is non-zero, and use the observed lateness to size the TTL.

### Service outage auto-disable

If IFTTT, Cielo, or YoLink is unreachable, temporarily disable AC shutoff to avoid locking guests out of AC. Re-enable automatically when services recover.

**Partially shipped**: a Redis-backed circuit breaker now trips after repeated
IFTTT failures and skips calls for a cooldown, and QStash retries are capped so
one turn-off cannot become four failure notifications. Still open: extending the
breaker to YoLink, and surfacing circuit state in the dashboard.

### Staging environment with simulated YoLink and IFTTT

Merging control-path changes while guests are on site is the riskiest moment in
this project. The goal is to exercise a real deployment end to end without any
possibility of touching real HVAC.

Three tiers, in increasing cost and fidelity:

**1. Run the existing E2E suite in CI (cheap, do first).** `dev/e2e/scenarios.test.ts`
already drives 7 full sensor-to-turn-off scenarios against the dev server, with
`--delay-scale` compressing timers to milliseconds. `.github/workflows` runs
`type-check`, `lint`, `format:check` and `test:coverage`, but **not**
`pnpm test:e2e`. Adding it is one line and catches control-flow regressions on
every PR.

**2. Fault injection in the existing dev harness.** `dev/providers.ts` is already
a full set of fakes. Add controllable failure modes — IFTTT returning 500 or
401, YoLink timing out, the state store throwing — and write scenarios for the
resilience behaviour that currently has only unit coverage: circuit opens after
N failures, turn-offs are skipped while open, the circuit heals after cooldown,
a terminal failure is not retried. No cloud infrastructure required.

**3. A real staging deployment.** A second Vercel project deploying from a
`staging` branch, with its own Upstash Redis and QStash instances and its own
Tinybird workspace (or a reserved tenant prefix), seeded with a synthetic tenant
and fake sensors.

The critical constraint: staging must **never** reach real IFTTT, since that
controls real HVAC. That requires a mock service impersonating the IFTTT Maker
and YoLink APIs, with failure injection driven by a control endpoint.

Prerequisite: `IFTTT_BASE_URL` is currently a hardcoded constant in
`src/providers/cielo/client.ts`. It must become configurable before a staging
environment can be safe. `yolink.baseUrl` is already config-driven.

Expected cost: roughly zero — additional Vercel projects, a second Upstash free
tier database, and the Tinybird free tier all fit existing plans.

Watch for staging drift: keep the same repository, the same environment
variable names, and deploy staging from a branch rather than a separate repo.

### Emergency kill switch

A way to stop the system that does not depend on being able to log in. The
motivating incident: magic-link emails were silently failing, so the dashboard
toggle — the only way to stop a flood of IFTTT failure notifications — was
unreachable. Disabling the IFTTT applets by hand is impractical because there
are several.

Design agreed:

- **Disable-only.** The emergency path can only set the system to disabled;
  re-enabling stays behind normal session auth. Enabling schedules turn-offs
  for every exposed unit, so a leaked credential that could enable is a real
  risk, while one that can only disable costs money at worst.
- **`api/emergency-stop.ts`**, deliberately bypassing `resolveTenantFromSession()`
  since the premise is that sessions are unavailable.
- **Token stored as a SHA-256 hash** in Postgres, not encrypted — a hash needs
  no key management and cannot be reversed if the database leaks. Format
  `<tenantShortId>.<secret>` so lookup hits one row instead of scanning.
- **`GET` renders a confirmation page, `POST` performs the stop**, so the
  bookmarkable URL cannot be fired by a prefetcher, scanner, or link preview.
- **Redis rate limiting** per tenant and per IP, since this is a bearer secret
  on a public endpoint.
- Reuse `timingSafeEqual()` from `src/utils/crypto.ts`; show the token once at
  generation; support rotate and revoke; audit every attempt and email on use.

Known limitation: it still depends on Upstash, so it is not a true out-of-band
control. Note also that `getSystemEnabled()` treats a missing key as enabled, so
a Redis flush re-enables the system — `pnpm redis:flush` would undo a stop.

### System bootstrap / first-run setup

A first-run experience that configures the platform-level infrastructure secrets before any tenant exists. Today these are manually set as Vercel environment variables — this should be a guided flow.

**Required secrets:**

- `DATABASE_URL` — Neon Postgres connection string
- `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN` — Redis for sessions, state, timers
- `QSTASH_TOKEN` / `QSTASH_CURRENT_SIGNING_KEY` / `QSTASH_NEXT_SIGNING_KEY` — delayed job scheduling
- `TINYBIRD_TOKEN` — analytics ingestion
- `RESEND_API_KEY` — transactional email (magic links)
- `APP_URL` — canonical deployment URL (for QStash callbacks, magic link URLs)
- `SITE_NAME` — branding shown in UI and emails

**Flow:**

1. Deploy to Vercel (or similar) with no env vars set
2. First visit detects no `DATABASE_URL` → shows a bootstrap wizard
3. Wizard walks through each service: create account, paste credentials, test connection
4. On completion, secrets are written to Vercel env vars (via Vercel API) or a `.env` file (self-hosted)
5. Run DB migrations automatically
6. Redirect to tenant creation → existing onboarding wizard

**Goal:** A new user can deploy, walk through system setup in a browser, create their first tenant, and go directly into the tenant onboarding flow — no manual env var editing required.

---

## Medium-term

### Email notifications

Requires Resend (already integrated for auth).

- Sensor open alerts (e.g. "Kitchen window has been open for 10 minutes")
- HVAC turn-off confirmations
- System error alerts (provider failures, QStash issues)
- User preferences for which notifications to receive

### Energy usage insights

Upload historical energy data (CSV with `date` and `kwh` columns) to track consumption over time and correlate with weather conditions. Enables comparisons across periods (e.g. this summer vs last summer) to quantify savings from automated HVAC shutoffs.

**Data model:**

- New `energy_readings` table in Postgres: `tenant_id`, `date`, `kwh`, `created_at`
- Simple CSV upload — two columns (`date`, `kwh`), one row per day/billing period
- Tenant property zip code stored in `tenants` table (new column) or in `tenant_config` JSONB

**Weather correlation:**

- Fetch historical daily temperature + humidity from [Open-Meteo](https://open-meteo.com/) (free, no API key, 10k requests/day)
- Cache in Redis by zip code + date range (`weather:{zipCode}:{year}`) with 30-day TTL
- Shared across tenants in the same zip code — avoids redundant API calls
- One API call fetches up to a year of daily data, so cache hit rate should be high

**Upload flow:**

- API endpoint accepts CSV, validates columns, upserts rows into `energy_readings`
- On upload, auto-fetch weather data for the same date range + zip code (cache-first)
- Return summary: rows imported, date range, any duplicates/overwrites

**Future insights (visualization TBD):**

- Energy usage over time (daily/monthly chart)
- Energy vs outdoor temperature scatter plot (shows AC correlation)
- Period-over-period comparison (same month, different years)
- Estimated savings: compare energy during HVAC-guardian-active periods vs baseline
- Cooling degree days (CDD) normalization for fair year-over-year comparison

**Why the naive comparison will not work:**

Whole-condo kWh is dominated by outdoor temperature and by whether anyone is
staying there. Both swamp the effect being measured, so a before/after average
is close to meaningless on its own.

- **Normalize by cooling degree days before comparing anything.** A warm week
  with the system on will out-consume a mild week with it off, and say nothing.
- **Occupancy is a second confounder.** An empty condo uses little regardless.
  The sensor data already indicates occupancy — days with no sensor events at
  all are almost certainly empty — so it can be used as a covariate rather than
  guessed at.
- **Prefer matched days over period averages.** Comparing days with similar CDD
  and similar occupancy, across the dry-run and live periods, is more honest
  than two monthly means.
- **Expect the effect to be small relative to the noise.** The system saves
  runtime on doors left open, which is a fraction of total HVAC load, which is
  itself a fraction of the bill. A few weeks of live data may not be enough to
  separate it from weather variation — which is a finding worth stating plainly
  rather than reporting a number the data cannot support.

Utility CSVs and the sensor data both reveal when the property is occupied, so
neither belongs in this public repository.

### More sign-in options

Magic links are the only way in today. Add OAuth sign-in (Google first, then
others such as GitHub or Apple) and possibly passkeys.

- Keep sign-in invite-only: an OAuth identity maps to an existing `users` row
  by verified email; it never creates a user or a tenant on its own.
- Must run on the Edge runtime (Web Crypto, PKCE), like the rest of auth.
- Makes Resend optional for deployments that don't want email at all.

### Swappable service providers

A contributor who prefers other services should only have to write a small
shim, not edit handlers. Part of this exists: `src/providers/types.ts` already
defines interfaces for sensors, HVAC control, scheduling, analytics and state.
What's missing:

- **Selection.** `createDependencies` constructs YoLink, Cielo-via-IFTTT,
  QStash, Upstash Redis and Tinybird directly. Choose implementations from
  config instead, with a registry a shim can add itself to.
- **Leaks through the interfaces.** QStash's signature check sits in the
  turn-off handler (`qstashReceiver` in `Dependencies`); callback
  authentication belongs to the scheduler. The database is hardwired to Neon's
  HTTP driver (`src/db/client.ts`), though Drizzle supports other Postgres
  drivers. Email is Resend-only.
- **Config.** The env schema requires QStash and Upstash variables
  unconditionally; each provider should declare and validate its own.
- **Analytics is more than a writer.** The Tinybird datasources, pipes and CD
  deploy are Tinybird-specific, so another backend needs its own schema, not
  just a new `AnalyticsProvider`.

**Make the wizards provider-aware.** The setup wizard, first-run bootstrap and
IFTTT applet wizard should ask for — and test — only what the chosen providers
need, rather than assuming YoLink, IFTTT and Cielo.

### Web configuration UI

Browser-based management of the tenant's configuration.

- Manage sensors (names, types, assignments to zones)
- Manage HVAC units (names, IFTTT event names, default delays)
- Manage zones (rooms, interior/exterior door assignments)
- Live validation and preview of zone graph

### Onboarding experience

Web-based stepper wizard that walks a new client through the entire setup process, from hardware to working automations. Each step validates before allowing the user to continue. Progress is saved so the user can leave and come back.

**Step 1 — Account creation**

- Sign up with email (magic link)
- Name your property (e.g. "Kona Beach House")

**Step 2 — Install and connect YoLink hub**

- Guide: unbox hub, plug in, download YoLink app, create account
- Enter YoLink API credentials (UA CID + secret key)
- Test connection — fetch device list from YoLink API to confirm credentials work

**Step 3 — Install door/window sensors**

- Guide: pair sensors in YoLink app, place on doors/windows
- Auto-discover sensors from YoLink account (show device list)
- Name each sensor (e.g. "Front Door", "Kitchen Window")
- Mark each as interior or exterior

**Step 4 — Configure zones**

- Guide: explain the zone concept (rooms connected by interior doors form a group)
- Visual zone builder — drag sensors into zones, name each zone
- Assign interior sensors as connections between zones
- Preview the zone graph (show which zones connect to which)

**Step 5 — Install and connect Cielo Breez**

- Guide: install Cielo Breez units, create Cielo account, pair with AC units
- Name each HVAC unit (e.g. "Living Room AC", "Master Bedroom AC")
- Assign each HVAC unit to a zone

**Step 6 — Connect IFTTT**

- Guide: create IFTTT account, enable webhooks service
- Enter IFTTT webhook key
- Test connection — fire a test webhook event

**Step 7 — Create IFTTT applets**

_Superseded by [IFTTT applet setup wizard](#ifttt-applet-setup-wizard), which covers all three applet kinds, not only turn-off._

- For each HVAC unit, show exact step-by-step instructions to create the "turn off" applet
  - Which IFTTT trigger (webhook event name) to use
  - Which Cielo Breez action to configure
- Ideally: deep-link into IFTTT applet creation with pre-filled values
- Test each applet — fire the webhook event and ask user to confirm the AC responded

**Step 8 — Set delays and preferences**

- Pick a default shutoff delay for all units (e.g. 3 minutes)
- Optionally customize per-unit delays
- Enable/disable email notifications

**Step 9 — Verify and go live**

- Run a full end-to-end test: simulate a sensor open event, show the timer, confirm shutoff fires
- Show a summary of the complete configuration
- Enable the system

### ~~Migrate from environment config~~ (done, then removed)

The one existing single-tenant deployment was migrated into a tenant, after
which single-tenant mode and the import path were removed together. See
"Single-tenant mode removed" in [STATUS.md](./STATUS.md).

---

## Future — Multi-tenant hosted service

Turn this into a hosted platform where multiple vacation rental owners can sign up, each with their own sensors, HVAC units, IFTTT account, YoLink account, etc.

### Architecture assessment

The codebase is well-structured (provider interfaces, dependency injection, `Dependencies` object), but is **end-to-end single-tenant by construction**. No tenant identifier flows through any request today. Major work areas:

| Area                     | Current state                                         | What changes                                                                                        | Effort |
| ------------------------ | ----------------------------------------------------- | --------------------------------------------------------------------------------------------------- | ------ |
| **Database**             | Redis only, no relational store                       | Add Postgres (Neon/Supabase) for `tenants`, `users`, `tenant_secrets` tables. Add ORM + migrations. | Large  |
| **Config system**        | Global singleton from `process.env`                   | Per-tenant config loaded from DB at request time, replace module-level cache                        | Large  |
| **Auth / user model**    | Single `OWNER_EMAIL` env var, no user table           | Users table, tenant association, session carries `tenantId`                                         | Large  |
| **API routes**           | No tenant context in any request                      | All routes extract `tenantId` from session (browser) or URL (webhooks) and thread it through        | Large  |
| **External credentials** | One global set of YoLink/IFTTT/Resend env vars        | Per-tenant encrypted credential storage, per-request client instantiation                           | Large  |
| **Redis keys**           | Flat global (`sensor:x`, `timer:x`, `system:enabled`) | Prefix all keys with `{tenantId}:`, scope SCAN patterns                                             | Medium |
| **QStash callbacks**     | Fixed global `turnOffUrl`, no tenant in payload       | Include `tenantId` in callback URL/payload, prefix deduplication IDs                                | Medium |
| **Tinybird analytics**   | No `tenant_id` column in any datasource               | Add `tenant_id` to all schemas, ingest calls, and endpoint SQL                                      | Medium |

### Recommended approach (dependency order)

1. **Add a relational database** — `tenants`, `users`, `tenant_secrets` tables. This unblocks everything else.
2. **Namespace Redis keys** — prefix all keys with `{tenantId}:`. Mechanical but must happen before real tenants exist.
3. **Refactor auth** — sessions carry `tenantId`, login looks up email across tenants.
4. **Refactor API routes** — extract `tenantId` from session (dashboard) or URL (webhooks), thread through `createDependencies`.
5. **Per-tenant credentials** — `createDependencies` receives tenant-specific secrets, instantiates per-tenant `IFTTTClient`, `YoLinkClient`, etc.
6. **Update QStash** — tenant-scoped `turnOffUrl` and deduplication IDs.
7. **Update Tinybird** — add `tenant_id` to all datasource schemas and endpoint queries.

### Key strengths for multi-tenancy

- Provider interfaces (`StateStore`, `Scheduler`, `AnalyticsProvider`) already abstract implementations
- `Dependencies` object is passed through handlers — easy to make per-tenant
- Zone graph, timer/cancellation logic, and analytics tracking are tenant-agnostic internally
- Business logic doesn't directly touch Redis or external APIs — it goes through the dependency layer

### Key risks

- Credential management (encrypted storage, rotation, per-tenant secret scoping)
- Webhook routing — IFTTT applets are configured per-user with hardcoded payloads; adding `tenantId` requires re-configuring every applet
- Cost model — each tenant adds QStash, Redis, Tinybird, and IFTTT usage
- Isolation — bugs in one tenant's config shouldn't affect others
