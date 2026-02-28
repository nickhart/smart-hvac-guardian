# Roadmap

Forward-looking features and explorations. See [STATUS.md](./STATUS.md) for what's already been built.

---

## Near-term

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

### Proactive timer cancellation on system disable

When the system is toggled off, cancel all active timers in Redis (delete `timer:*` keys) rather than letting them fire and no-op.

### Service outage auto-disable

If IFTTT, Cielo, or YoLink is unreachable, temporarily disable AC shutoff to avoid locking guests out of AC. Re-enable automatically when services recover.

---

## Medium-term

### Email notifications

Requires Resend (already integrated for auth).

- Sensor open alerts (e.g. "Kitchen window has been open for 10 minutes")
- HVAC turn-off confirmations
- System error alerts (provider failures, QStash issues)
- User preferences for which notifications to receive

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
