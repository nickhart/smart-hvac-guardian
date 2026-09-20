/**
 * How long a timer token outlives the timer itself.
 *
 * Deliberately tight. The token doubles as the record that a unit already has a
 * timer, so while it exists no sensor event will schedule a replacement. If a
 * message is lost outright, a short TTL is what lets the next sensor event
 * re-arm the unit promptly. A message that merely arrives *late* is handled by
 * the turn-off handler re-arming on delivery, so this does not need to cover
 * delivery lag as well.
 */
export const TIMER_TOKEN_BUFFER_SECONDS = 60;

import type { StateStore } from "../providers/types.js";
import type { AppConfig } from "../config/schema.js";

export async function getDelayForUnit(
  unitId: string,
  stateStore: StateStore,
  config: AppConfig,
): Promise<number> {
  const override = await stateStore.getUnitDelay(unitId);
  if (override !== null) return override;
  return config.hvacUnits[unitId]?.delaySeconds ?? 300;
}
