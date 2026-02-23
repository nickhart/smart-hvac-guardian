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
