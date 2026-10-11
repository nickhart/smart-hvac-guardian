# On-site test plan: going live

The dry run proved the decisions: every timer ends in exactly one outcome, the
IFTTT calls succeed, and once-per-exposure halved the turn-offs. What it can't
prove is that a call actually switches a unit off, because the shutoff applets
have been disabled. This is the checklist for enabling them, one unit at a
time, with someone in the house to watch.

Work through it top to bottom. Tick each box as you go.

## Before the visit

- [ ] `GET /api/health` reports `ok` for every check.
- [ ] The dashboard shows the system **enabled** and no unexpected open sensors.
- [ ] Run `/api/check-state?verify=yolink` (signed in, in a browser). Every
      sensor should show as agreed; anything drifted is worth fixing before you go.
- [ ] On your phone: the Cielo app, the IFTTT app (activity log), the dashboard,
      and somewhere to run the Tinybird queries in [analytics.md](analytics.md).

## How to stop

Know this before turning anything on. Either one stops it:

- **Disable the unit's shutoff applet in IFTTT.** The quickest way, and it
  stops the actual switching even if the system keeps deciding.
- **Switch the system off on the dashboard.** Timers still fire and are
  recorded (`shutoff_enabled = 0`), but no IFTTT call is made — including for
  timers already in flight.

## 1. Baseline, everything closed

- [ ] All exterior doors and windows closed.
- [ ] `?verify=yolink`: every sensor agrees, and every unit shows as not exposed.
- [ ] No active timers on the dashboard.

## 2. Shorten the delay for testing

Ten minutes per test is slow. Set a **60-second** delay override for the unit
under test on the dashboard.

- [ ] Override set. Write down the original delay: **\_\_\_\_\_\_**

## 3. Turn-off, per unit

Repeat for each unit. Enable **only this unit's** shutoff applet.

| Unit | Applet on | Turned off | `turned_off` row | IFTTT ran | "off" reported |
| ---- | :-------: | :--------: | :--------------: | :-------: | :------------: |
|      |    [ ]    |    [ ]     |       [ ]        |    [ ]    |      [ ]       |
|      |    [ ]    |    [ ]     |       [ ]        |    [ ]    |      [ ]       |
|      |    [ ]    |    [ ]     |       [ ]        |    [ ]    |      [ ]       |
|      |    [ ]    |    [ ]     |       [ ]        |    [ ]    |      [ ]       |

1. Turn the unit on in the Cielo app and wait for it to be running.
2. Open an exterior door that exposes it. The dashboard should show a timer.
3. Wait out the delay. **The unit should switch off.**
4. Check:
   - **Turned off:** the unit is off, both physically and in the Cielo app.
   - **`turned_off` row:** in `hvac_commands_v2` for this unit.
   - **IFTTT ran:** the shutoff applet's activity log shows a run.
   - **"off" reported:** an `off` row in `hvac_state_events_v2`. This tests
     the unit's "powered off" applet too. One unit has never reported "off"
     in the dry run, so watch for it there.
5. Close the door.

## 4. The other paths

With one unit's applet enabled:

- [ ] **Door closed in time.** Unit on, open the door, close it before the
      delay ends. The unit stays on, and a `cancelled` row appears.
- [ ] **Once per exposure.** After a turn-off, leave the door open and open and
      close a second exterior door. No second turn-off; a `skipped_already_off`
      row instead.
- [ ] **Turned back on behind an open door.** Still exposed, turn the unit back
      on in the Cielo app. A `scheduled` row with `trigger_source = hvac_on`, and
      the unit turns off again after the delay. This depends on the Cielo
      "powered on" applet, which has failed before. If no `scheduled` row appears,
      that applet didn't fire. Note it.
- [ ] **Through an interior door** (if your zones have them). Open an interior
      door into a room with an open exterior door. The unit on the far side
      should be exposed and turned off.
- [ ] **System toggle.** Unit on, switch the system off, open a door. After the
      delay a `turned_off` row with `shutoff_enabled = 0`, no IFTTT run, and the
      unit stays on. Leave the door open and switch the system back on: a new
      timer starts, and the unit turns off after the delay.

## 5. Go live

- [ ] Remove the delay overrides, back to the delays you wrote down.
- [ ] Enable **every** shutoff applet.
- [ ] `?verify=yolink` once more, all closed: everything agrees.
- [ ] Record today's date in the "when applets enabled" row of the table at the
      top of [analytics.md](analytics.md), and add an entry to
      [STATUS.md](STATUS.md).

## 6. First days live

Check daily for the first few days, then weekly:

- [ ] Scheduled timers equal recorded outcomes (the query under "Scheduled
      timers should equal recorded commands" in [analytics.md](analytics.md)).
- [ ] IFTTT calls all `ok` in `provider_events_v2`.
- [ ] No unexpected `aborted_stale_state`.
- [ ] Every `turned_off` is followed, eventually, by the unit actually being
      off. A unit found running behind an open door is the trigger for the timed
      retry deferred in the [roadmap](ROADMAP.md).
- [ ] Ask whoever is staying whether the beeps or shutoffs were a nuisance.
      Repeat turn-offs every ~40 minutes during a long, busy exposure are expected
      (the 30-minute marker plus the delay).
