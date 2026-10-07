import type { StateStore } from "../providers/types.js";
import type { Logger } from "../utils/logger.js";

/**
 * "We already turned this unit off during this exposure."
 *
 * Without it, a turn-off clears its timer, and the next door event anywhere in
 * the zone sees an exposed unit with no timer and schedules another. In
 * September and October 2026 half of all turn-offs came within 30 minutes of
 * the previous one for the same unit, and one four-hour exposure produced 11
 * per unit. Live, each is another IFTTT call and another beep.
 *
 * The reported HVAC state can't solve this alone: it arrives through Cielo's
 * IFTTT triggers, which rarely fire for "off" (guests leave the AC on) and have
 * been seen to fail outright. So the system remembers what it did itself, and
 * treats reported events as corrections:
 *
 * - set when a turn-off goes through (or is recorded in shadow mode), and when
 *   a unit reports "off";
 * - cleared when a unit reports "on", or stops being exposed;
 * - respected only where a turn-off would be *re-issued* — a door event, a
 *   re-enable, a re-arm. A turn-on while exposed always schedules a fresh
 *   timer, marker or not.
 *
 * It expires, and the expiry is the retry. A guest who turns a unit back on
 * while the door is still open, and whose "on" event is lost, would otherwise
 * never be turned off again. With the marker gone, the next door event
 * schedules one more turn-off.
 */
export const TURNED_OFF_TTL_SECONDS = 30 * 60;

/**
 * Split units a caller wants to schedule into those to schedule now and those
 * already turned off this exposure. If the markers can't be read, schedule
 * everything: a redundant turn-off is today's behaviour, a missed one is not.
 */
export async function skipUnitsAlreadyOff(
  unitIds: string[],
  stateStore: StateStore,
  logger: Logger,
  requestId: string,
): Promise<{ schedule: string[]; alreadyOff: string[] }> {
  if (unitIds.length === 0) return { schedule: [], alreadyOff: [] };
  try {
    const off = new Set(await stateStore.getTurnedOffUnitIds(unitIds));
    return {
      schedule: unitIds.filter((id) => !off.has(id)),
      alreadyOff: unitIds.filter((id) => off.has(id)),
    };
  } catch (error) {
    logger.error("Could not read turned-off markers; scheduling every unit", {
      requestId,
      error: error instanceof Error ? error.message : String(error),
    });
    return { schedule: unitIds, alreadyOff: [] };
  }
}

/** Set the marker. A failure degrades to re-issuing turn-offs, as before. */
export async function markTurnedOff(
  hvacUnitId: string,
  stateStore: StateStore,
  logger: Logger,
  requestId: string,
): Promise<void> {
  try {
    await stateStore.markTurnedOff(hvacUnitId, TURNED_OFF_TTL_SECONDS);
  } catch (error) {
    logger.error("Could not mark unit as turned off", {
      requestId,
      hvacUnitId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * Clear markers. A failure leaves a marker that suppresses re-issued turn-offs
 * until it expires — the same bound as a lost "on" event.
 */
export async function clearTurnedOff(
  hvacUnitIds: string[],
  stateStore: StateStore,
  logger: Logger,
  requestId: string,
): Promise<void> {
  if (hvacUnitIds.length === 0) return;
  try {
    await stateStore.clearTurnedOff(hvacUnitIds);
  } catch (error) {
    logger.error("Could not clear turned-off markers", {
      requestId,
      hvacUnitIds,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
