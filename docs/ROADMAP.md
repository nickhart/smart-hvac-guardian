# Roadmap

Forward-looking features and explorations. See [STATUS.md](./STATUS.md) for what's already been built.

---

## Near-term

### Onboarding UX improvements

- **Interior door assignment rework**: Dedicated step or section where the user picks a sensor marked as interior, then selects which two zones it connects — instead of configuring interior doors within each zone's card. This makes the mental model clearer and avoids duplicate/conflicting entries.
- **Zone-centric HVAC/sensor assignment**: Rather than toggling items per-zone, define which zone each HVAC unit and exterior sensor belongs to (single-owner), with validation that every item is assigned exactly once.

### Analytics dashboard

Build a dashboard page showing shutoff history, frequency charts, and per-sensor breakdown using the existing Tinybird endpoints (`shutoffs_per_day`, `sensor_trigger_frequency`, `recent_activity`, `exposure_duration`).

- Time-range picker: past 24h, past week, specific date range
- Per-sensor and per-unit drill-down
- Trend visualization (are guests learning the system?)

### HVAC state tracking in Redis

Persist HVAC on/off state from `hvac-event` handler to avoid scheduling redundant turn-off timers.

- Store `hvac-state:{unitId}` in Redis on each on/off event
- Check state before scheduling a timer — skip if unit is already off
- Open concerns:
  - Does a redundant IFTTT "off" command cause an extra beep?
  - Race condition: user manually turns on AC, server fires a stale turn-off

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

**Migrate from existing env-based config:**

- Detect pre-existing `APP_CONFIG` / `OWNER_EMAIL` / provider credentials
- Pre-populate the bootstrap wizard fields from current env values
- After bootstrap, offer to import the existing single-tenant setup as the first tenant (reuse the env-to-tenant migration)

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

### Web configuration UI

Browser-based management to replace manual `APP_CONFIG` editing.

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

### Migrate from environment config

For existing single-tenant deployments (like ours), provide a migration path that imports the current `APP_CONFIG`, `ENV_SECRETS`, and related environment variables into a new tenant record.

- Detect existing env-based config on first login (`APP_CONFIG` is set, no tenants in DB yet)
- Offer to run the onboarding wizard with all fields pre-filled from the environment
  - Zones, sensors, sensor names, delays — from `APP_CONFIG`
  - YoLink credentials, IFTTT webhook key, Resend key — from env secrets
  - Owner email — from `OWNER_EMAIL`
- User walks through each step to review and confirm (not a silent import — they should see and understand what's configured)
- On completion, tenant + config + credentials are stored in the database
- The system switches to reading from DB; env vars are no longer consulted at runtime
- Print a summary of which env vars are now safe to remove (or convert to example values in `.env.example`)

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
