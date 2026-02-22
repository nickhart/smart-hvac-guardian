export const config = { runtime: "edge" };

import { z } from "zod";
import { loadConfig, loadEnvSecrets } from "../src/config/index.js";
import { createDependencies } from "../src/handlers/dependencies.js";
import type { Dependencies } from "../src/handlers/dependencies.js";
import { createLogger } from "../src/utils/logger.js";
import { jsonResponse, errorResponse } from "../src/utils/response.js";
import { evaluateZoneGraph, getOpenExteriorSensors, getConnectedComponents } from "../src/zone-graph/index.js";
import type { SensorState } from "../src/zone-graph/index.js";

const HvacEventPayload = z.object({
  hvacId: z.string().min(1),
  event: z.enum(["on", "off"]),
});

export async function handleHvacEvent(request: Request, deps?: Dependencies): Promise<Response> {
  const logger = deps?.logger ?? createLogger();
  const requestId = crypto.randomUUID().slice(0, 8);

  try {
    if (request.method !== "POST") {
      return errorResponse("Method not allowed", 405);
    }

    const body = await request.json().catch(() => null);
    const parsed = HvacEventPayload.safeParse(body);

    if (!parsed.success) {
      logger.warn("Invalid HVAC event payload", { requestId, errors: parsed.error.flatten() });
      return errorResponse("Invalid payload", 400);
    }

    const { hvacId, event } = parsed.data;
    logger.info("Received HVAC event", { requestId, hvacId, event });

    if (event === "off") {
      const d = deps ?? createDependencies(loadConfig(), loadEnvSecrets(), logger);
      d.analytics.trackHvacStateEvent({
        requestId,
        hvacId,
        event: "off",
        wasExposed: false,
        turnoffScheduled: false,
      });
      return jsonResponse({ status: "ok", action: "none" });
    }

    // event === "on" — check if this unit is in an exposed zone
    const d = deps ?? createDependencies(loadConfig(), loadEnvSecrets(), logger);

    if (!(hvacId in d.config.hvacUnits)) {
      logger.warn("Unknown HVAC unit ID", { requestId, hvacId });
      return errorResponse("Unknown HVAC unit", 404);
    }

    // Read all sensor states from Redis, applying defaults for sensors without state
    const allSensorIds = Object.keys(d.config.sensorDelays);
    const sensorStates = await d.stateStore.getAllSensorStates(allSensorIds);
    for (const [id, defaultState] of Object.entries(d.config.sensorDefaults)) {
      if (!sensorStates.has(id)) {
        sensorStates.set(id, defaultState);
      }
    }

    // Evaluate zone graph
    const { exposedUnits } = evaluateZoneGraph(d.config.zones, sensorStates);

    if (!exposedUnits.has(hvacId)) {
      logger.info("HVAC unit is not in an exposed zone, no action needed", {
        requestId,
        hvacId,
      });
      d.analytics.trackHvacStateEvent({
        requestId,
        hvacId,
        event: "on",
        wasExposed: false,
        turnoffScheduled: false,
      });
      return jsonResponse({ status: "ok", action: "none" });
    }

    // Unit is exposed — schedule turn-off timer
    const delaySeconds = getMinDelayForUnit(hvacId, d.config.zones, d.config.sensorDelays, sensorStates);
    const token = crypto.randomUUID();
    const ttl = delaySeconds + 60;

    await d.stateStore.setTimerToken(hvacId, token, ttl);

    const window = Math.floor(Date.now() / (10 * 60 * 1000));
    const dedupId = `turnoff-${hvacId}-${window}`;
    await d.scheduler.scheduleUnitTurnOff(hvacId, token, delaySeconds, dedupId);

    logger.info("Turn-off scheduled for HVAC unit on event", {
      requestId,
      hvacId,
      delaySeconds,
      dedupId,
    });

    const unitConfig = d.config.hvacUnits[hvacId];
    d.analytics.trackHvacStateEvent({
      requestId,
      hvacId,
      event: "on",
      wasExposed: true,
      turnoffScheduled: true,
    });
    d.analytics.trackHvacCommand({
      requestId,
      hvacUnitId: hvacId,
      unitName: unitConfig?.name ?? hvacId,
      action: "scheduled",
      triggerSource: "hvac_on",
      delaySeconds,
      iftttEvent: unitConfig?.iftttEvent,
    });

    return jsonResponse({
      status: "ok",
      action: "scheduled",
      hvacUnitId: hvacId,
      delaySeconds,
    });
  } catch (error) {
    logger.error("hvac-event handler error", {
      requestId,
      error: error instanceof Error ? error.message : String(error),
    });
    return errorResponse("Internal server error", 500);
  }
}

function getMinDelayForUnit(
  unitId: string,
  zones: Dependencies["config"]["zones"],
  sensorDelays: Dependencies["config"]["sensorDelays"],
  sensorStates: Map<string, SensorState>,
): number {
  const components = getConnectedComponents(zones, sensorStates);

  for (const component of components) {
    let hasUnit = false;
    for (const zoneId of component) {
      const zone = zones[zoneId];
      if (zone && zone.minisplits.includes(unitId)) {
        hasUnit = true;
        break;
      }
    }

    if (!hasUnit) continue;

    const openSensors = getOpenExteriorSensors(component, zones, sensorStates);
    if (openSensors.length === 0) continue;

    let minDelay = Infinity;
    for (const sensorId of openSensors) {
      const delay = sensorDelays[sensorId];
      if (delay !== undefined && delay < minDelay) {
        minDelay = delay;
      }
    }

    return minDelay === Infinity ? 90 : minDelay;
  }

  return 90;
}

export default async function handler(request: Request): Promise<Response> {
  return handleHvacEvent(request);
}
