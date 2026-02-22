export const config = { runtime: "edge" };

import { loadConfig, loadEnvSecrets } from "../src/config/index.js";
import { createDependencies } from "../src/handlers/dependencies.js";
import type { Dependencies } from "../src/handlers/dependencies.js";
import { createLogger } from "../src/utils/logger.js";
import { jsonResponse, errorResponse } from "../src/utils/response.js";
import { evaluateZoneGraph } from "../src/zone-graph/index.js";

export async function handleCheckState(request: Request, deps?: Dependencies): Promise<Response> {
  const logger = deps?.logger ?? createLogger();
  const requestId = crypto.randomUUID().slice(0, 8);

  try {
    if (request.method !== "GET") {
      return errorResponse("Method not allowed", 405);
    }

    const d = deps ?? createDependencies(loadConfig(), loadEnvSecrets(), logger);

    // Read all sensor states from Redis, applying defaults for sensors without state
    const allSensorIds = Object.keys(d.config.sensorDelays);
    const sensorStates = await d.stateStore.getAllSensorStates(allSensorIds);
    for (const [id, defaultState] of Object.entries(d.config.sensorDefaults)) {
      if (!sensorStates.has(id)) {
        sensorStates.set(id, defaultState);
      }
    }

    // Evaluate zone graph
    const { exposedUnits, unexposedUnits } = evaluateZoneGraph(d.config.zones, sensorStates);

    // Get active timers
    const activeTimerUnitIds = await d.stateStore.getActiveTimerUnitIds();

    const sensorStateObj: Record<string, string> = {};
    for (const [id, state] of sensorStates) {
      sensorStateObj[id] = state;
    }

    logger.info("Diagnostic state check", {
      requestId,
      sensorStates: sensorStateObj,
      exposedUnits: [...exposedUnits],
      unexposedUnits: [...unexposedUnits],
      activeTimers: activeTimerUnitIds,
    });

    return jsonResponse({
      status: "ok",
      sensorStates: sensorStateObj,
      exposedUnits: [...exposedUnits],
      unexposedUnits: [...unexposedUnits],
      activeTimers: activeTimerUnitIds,
    });
  } catch (error) {
    logger.error("check-state handler error", {
      requestId,
      error: error instanceof Error ? error.message : String(error),
    });
    return errorResponse("Internal server error", 500);
  }
}

export default async function handler(request: Request): Promise<Response> {
  return handleCheckState(request);
}
