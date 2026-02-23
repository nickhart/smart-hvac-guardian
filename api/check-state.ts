export const config = { runtime: "edge" };

import { loadConfig, loadEnvSecrets } from "../src/config/index.js";
import { createDependencies } from "../src/handlers/dependencies.js";
import type { Dependencies } from "../src/handlers/dependencies.js";
import { createLogger } from "../src/utils/logger.js";
import { jsonResponse, errorResponse } from "../src/utils/response.js";
import { evaluateZoneGraph } from "../src/zone-graph/index.js";
import { getDelayForUnit } from "../src/utils/delay.js";

export async function handleCheckState(request: Request, deps?: Dependencies): Promise<Response> {
  const logger = deps?.logger ?? createLogger();
  const requestId = crypto.randomUUID().slice(0, 8);

  try {
    if (request.method !== "GET") {
      return errorResponse("Method not allowed", 405);
    }

    const d = deps ?? createDependencies(loadConfig(), loadEnvSecrets(), logger);
    const siteName = process.env.SITE_NAME || "HVAC Guardian";

    // Read all sensor states from Redis, applying defaults for sensors without state
    const allSensorIds = Object.keys(d.config.sensorDelays);
    const sensorStates = await d.stateStore.getAllSensorStates(allSensorIds);
    for (const [id, defaultState] of Object.entries(d.config.sensorDefaults)) {
      if (!sensorStates.has(id)) {
        sensorStates.set(id, defaultState);
      }
    }

    // Treat offline/unknown sensors as "closed" (safe default: AC stays on)
    const offlineSensorIds: string[] = [];
    for (const id of allSensorIds) {
      if (!sensorStates.has(id)) {
        sensorStates.set(id, "closed");
        offlineSensorIds.push(id);
      }
    }

    // Evaluate zone graph
    const { exposedUnits, unexposedUnits } = evaluateZoneGraph(d.config.zones, sensorStates);

    // Get active timers and system state
    const activeTimerUnitIds = await d.stateStore.getActiveTimerUnitIds();
    const systemEnabled = await d.stateStore.getSystemEnabled();

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

    // Build unit names and resolved delays
    const unitNames: Record<string, string> = {};
    const unitDelays: Record<string, number> = {};
    for (const unitId of Object.keys(d.config.hvacUnits)) {
      unitNames[unitId] = d.config.hvacUnits[unitId].name;
      unitDelays[unitId] = await getDelayForUnit(unitId, d.stateStore, d.config);
    }

    return jsonResponse({
      status: "ok",
      siteName,
      systemEnabled,
      sensorStates: sensorStateObj,
      sensorNames: d.config.sensorNames,
      unitNames,
      unitDelays,
      exposedUnits: [...exposedUnits],
      unexposedUnits: [...unexposedUnits],
      activeTimers: activeTimerUnitIds,
      offlineSensors: offlineSensorIds,
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
