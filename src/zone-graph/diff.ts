export interface TimerActions {
  schedule: string[];
  cancel: string[];
}

/**
 * Computes timer actions by comparing previously-exposed units to currently-exposed units.
 *
 * - schedule: units that are newly exposed (need new timers)
 * - cancel: units that were exposed but are no longer (timers should be cancelled)
 */
export function computeTimerActions(
  previouslyExposed: Set<string>,
  currentlyExposed: Set<string>,
): TimerActions {
  const schedule: string[] = [];
  const cancel: string[] = [];

  for (const unitId of currentlyExposed) {
    if (!previouslyExposed.has(unitId)) {
      schedule.push(unitId);
    }
  }

  for (const unitId of previouslyExposed) {
    if (!currentlyExposed.has(unitId)) {
      cancel.push(unitId);
    }
  }

  return { schedule, cancel };
}
