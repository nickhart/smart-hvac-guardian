/** Used when a delay field is cleared or holds something that isn't a number. */
export const DEFAULT_DELAY_SECONDS = 300;

/**
 * Read a delay-in-seconds input. `parseInt(v) || 300` treated a deliberate 0 —
 * the natural value for an interior door — as empty and replaced it with 300.
 */
export function parseDelay(value: string): number {
  const n = Number.parseInt(value, 10);
  return Number.isNaN(n) ? DEFAULT_DELAY_SECONDS : n;
}
