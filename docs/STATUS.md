# Status

Current state of implemented features and known gaps.

## Operating mode

**Dry run since 2026-09-20.** The app is enabled and makes real decisions, but
the IFTTT shutoff applets are disabled, so no HVAC unit actually changes state.

An IFTTT trigger returns 200 whether an applet is listening or not, so
`provider_events_v2` reads healthy throughout. That is expected, not evidence
the shutoffs work — see "Verify the shutoff actually happened" in the roadmap.

One unit (`loft_bedroom`) has its state-reporting applets verified in both
directions; the other three are created but untested. HVAC state events are
sparse: as of 2026-09-27 no "powered off" applet has run outside a test, and
one "powered on" trigger failed on Cielo's side and never posted — see "HVAC
state tracking" in the roadmap.

Nothing in the data distinguishes a dry run from real operation, and several
other dates change what a query means. They are listed together in
[analytics.md](./analytics.md) — check there before comparing across a date.

## Completed

### Zone-aware AC control

Per-zone HVAC control using interior door sensors. BFS over zones connected by open interior doors determines connected components. Only HVAC units in exposed components get shut off. Per-unit timers with UUID-based cancellation tokens in Redis.

### Remote delay configuration

Per-HVAC-unit delay overrides stored in Redis (`delay:{hvacUnitId}` keys), with fallback to the unit's configured delay. Exposed via `POST /api/unit-delay`. Configurable from the dashboard via a delay preset dropdown on each HVAC unit card.

### System on/off toggle

Redis flag (`system:enabled`) checked in `sensor-event`, `hvac-event`, and `hvac-turn-off` handlers. Controllable from the dashboard via the `SystemToggle` component. On re-enable, zones are re-evaluated and timers scheduled as needed.

**Disabled now means shadow mode**, not silence: zones are still evaluated, timers are still scheduled, and `hvac-turn-off` still records the turn-off it would have performed, flagged `shutoff_enabled = 0`. Only the IFTTT call is withheld, by the guard in `api/hvac-turn-off.ts`. This makes it possible to review the system's decisions before trusting it to act. `tests/integration/shadow-mode.test.ts` pins the guarantee that a disabled system never reaches the HVAC.

### Resend.dev integration

Resend is used as the transactional email provider for magic-link login emails, sending from `EMAIL_FROM`, which must be on a domain verified in the same Resend account. There is no default sender: a Resend key without `EMAIL_FROM` counts as misconfigured, and `/api/health` reports `email: fail`.

All sending goes through `createResendSender()` in `src/utils/email.ts`, which **throws when Resend returns an error**. `resend.emails.send()` resolves with `{ data, error }` rather than rejecting, so an unchecked call reports success on a rejected send — that silently broke login for months.

### User authentication (magic links)

Email/magic-link login flow — no passwords, no OTP entry. Users are looked up in the database. Sessions stored in Redis with 7-day TTL. Logout clears the session.

### Web dashboard

Production SPA (`web/`) with adaptive polling (3s active / 5s idle / 15s hidden) and SSE in dev mode. Shows sensor cards (open/closed/offline), HVAC unit cards (exposed/safe/timer countdown), system toggle, and per-unit delay configuration.

### Dev dashboard

Vanilla HTML/JS dashboard served by `dev/server.ts` with full SSE real-time updates. Live sensor/HVAC toggle buttons, countdown timers, and event log.

### Offline sensor handling (partial)

Offline or unknown sensors are treated as closed (safe default — AC stays on). Dashboard renders offline sensors with a yellow badge. Service outage auto-disable is **not** implemented.

### Shutoff analytics (partial)

Event tracking via Tinybird (not Redis sorted sets as originally planned). Five datasources: `sensor_events_v2`, `hvac_commands_v2`, `hvac_state_events_v2`, `provider_events_v2` and `sensor_state_drift_v2`, all carrying `tenant_id`. `hvac_commands_v2` also carries `late_by_seconds`, the gap between when a turn-off was meant to fire and when it arrived. Endpoints exist for `shutoffs_per_day`, `sensor_trigger_frequency`, `recent_activity`, `exposure_duration` and `hvac_runtime`.

`src/lib/tinybird.ts` is the deploy source of truth — see [analytics.md](./analytics.md). The `.datasource` files are documentation.

The `provider_health` endpoint groups provider calls by provider and outcome, so circuit-breaker state and upstream failures are queryable without opening the Tinybird console.

Gap: **no analytics dashboard page** — the endpoints exist, nothing renders them.

### System shutoff integration (partial)

`hvac-turn-off.ts` checks `system:enabled` before executing, even if the timer fired. Active timers are deliberately **not** cancelled on disable — they fire and are recorded as shadow decisions, which is the point of shadow mode.

Before acting, it re-reads every sensor it believes is open and re-evaluates the zone graph. If the devices say the exposure is over — a close webhook that never arrived — the shutoff is abandoned and recorded as `aborted_stale_state` rather than cutting a guest's AC for a door that shut ten minutes ago. Fails open: an unreachable device proceeds, because refusing to act on an outage would disable every shutoff.

The token check distinguishes three cases rather than two. A token that is present but different means a newer exposure is already armed (`superseded`); a token that is absent means either the door closed (`cancelled`) or the timer was lost, in which case a still-exposed unit is re-armed (`rearmed`) rather than left unwatched.

Deduplication ids are keyed on the cancellation token, not a wall-clock bucket. The bucket scheme silently dropped 34% of scheduled turn-offs when a door reopened inside the same ten minutes.

### Provider resilience

A Redis-backed circuit breaker (`src/utils/circuit-breaker.ts`) opens after repeated IFTTT failures and skips calls for a cooldown, tripping immediately on a terminal failure such as a bad webhook key. Outcomes are recorded to `provider_events_v2` with the request id that caused them.

QStash retries are capped at 1, so one turn-off cannot become four failure notifications, and terminal or circuit-open failures return 200 so QStash stops retrying.

Every outbound call is bounded by a deadline. Before that, a hang could not trip the breaker at all — failures are recorded in a `catch`, and a hang never throws — so a slow provider was invisible to the thing meant to protect against it.

Still open: extending the breaker to YoLink, and surfacing circuit state in the dashboard.

### Health endpoint

`GET /api/health` — unauthenticated probe for an external uptime monitor, reporting per-dependency status without exposing config or credentials. Returns 503 when Redis or config fails; unconfigured optional services report `not_configured`. See the README.

### Single-tenant mode removed

The app used to have a second mode: no database, configuration from
`APP_CONFIG`, one owner from `OWNER_EMAIL`. In that mode every route fell back
to the env config **with no authentication** — anyone could post sensor events,
toggle the system or read occupancy — and the fallback also answered the
tenant-less URLs (`/api/sensor-event`) on a deployment that still had
`APP_CONFIG` set. Tinybird showed no traffic on those URLs, so it was removed:

- Handlers get their dependencies only through
  `src/middleware/resolve-dependencies.ts`: no database is a 503, a request
  naming no tenant is a 404, a failed secret or session is a 404 or 401.
- The auth routes no longer accept `OWNER_EMAIL` or plain-email sessions.
- Deleted: the public `POST /api/onboarding/start` (anyone could create a
  tenant; the web app never called it), the `APP_CONFIG` import into the
  wizard, and the one-time Redis key migration.
- `/api/health` fails when `DATABASE_URL` is not set.

`APP_CONFIG` survives only as the local dev server's config format.

### Tenant credential hardening

Follow-up to the single-tenant removal, closing the gaps it left:

- **The webhook secret is required.** A tenant without one used to accept
  unauthenticated webhooks; every activated tenant has one, so it is now
  rejected instead. The secret is accepted only as `Authorization: Bearer`,
  not as `?secret=` in the URL, where request logs would keep it.
- **No fallback to the operator's YoLink/IFTTT keys.** `createDependencies`
  takes the tenant's own keys and nothing else; `YOLINK_*` and
  `IFTTT_WEBHOOK_KEY` are no longer read.
- **Wizard drafts are deleted on activation.** They held the YoLink and IFTTT
  keys in plaintext, beside the encrypted copy, indefinitely. For tenants
  activated earlier: `pnpm cli tenant:clear-drafts <tenantId>`.

### A unit is turned off once per exposure

A turn-off clears its timer, so the next door event in a still-open zone used to
schedule another: in the dry run half of all turn-offs came within 30 minutes of
the previous one for the same unit. Now `src/handlers/turned-off.ts` marks a unit
when its turn-off goes through (or is recorded in shadow mode), or when it
reports `off`; door events, re-enables and re-arms skip marked units and record
`skipped_already_off`. A reported `on` clears the marker and always schedules a
fresh turn-off; so does the exposure ending. The marker expires after 30
minutes — a bounded retry, since Cielo's `on` trigger has been seen to fail. It
also covers the roadmap's "completed shutoff re-arms" case: a QStash retry of a
turn-off that went through no longer re-arms.

### CI safety nets

- `no-floating-promises` and `no-misused-promises` are enabled (type-aware, scoped to files `tsconfig.json` covers). A dropped analytics promise on Edge runtime is now a lint error rather than a silent data loss.
- `pnpm test:e2e` runs in CI — 7 full sensor-to-turn-off scenarios that previously only ran locally.
- Node 24 across CI and `engines`, with actions on their Node 24-native majors.
- CI is path-aware: documentation-only pull requests run formatting and a Markdown link check, code runs the full suite. **`gate` is the job to mark required in branch protection** — a job skipped by a path filter reports as skipped rather than successful, so requiring `code` directly would block every documentation-only pull request.
- `src/utils/http.ts` is the only place allowed to call `fetch`, enforced by a test over every file in `src/` and `api/`. A call with no timeout looks exactly like one with a timeout, only shorter.
- Tinybird definitions, the `.datasource` files and the ingest call sites are checked against each other, including that every deployed resource grants the read-only token. Each of those has drifted in production at least once.
- 391 unit and integration tests, 7 end-to-end scenarios.
- Vercel skips the build when a push changes only `docs/` and Markdown, via `scripts/vercel-ignore-build.sh` (`ignoreCommand` in `vercel.json`). So a documentation-only pull request gets no preview URL, by design. Production compares with the last deployed commit, fetching it if it has fallen outside Vercel's shallow clone; previews compare with `main`, since a branch reset after a merge leaves its previous deployment's commit outside the clone — which is why previews used to build every time. Every failure — no base commit, a failed fetch, a git error — means "build anyway", because a redundant build costs seconds and a wrongly skipped one leaves the webhook endpoints on old code.

## Not started

Everything not built is in [ROADMAP.md](./ROADMAP.md), which is the only place
it should be described. This section used to restate six of those entries in a
sentence each, which drifted from the fuller versions and gave two answers to
the same question.
