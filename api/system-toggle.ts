export const config = { runtime: "edge" };

import { z } from "zod";
import { loadConfig, loadEnvSecrets } from "../src/config/index.js";
import { createDependencies } from "../src/handlers/dependencies.js";
import type { Dependencies } from "../src/handlers/dependencies.js";
import { createLogger } from "../src/utils/logger.js";
import { jsonResponse, errorResponse } from "../src/utils/response.js";
import { evaluateZoneGraph, computeTimerActions } from "../src/zone-graph/index.js";
import type { SensorState } from "../src/zone-graph/index.js";
import { getDelayForUnit } from "../src/utils/delay.js";

const TogglePayload = z.object({
  enabled: z.boolean(),
});

export async function handleSystemToggle(request: Request, deps?: Dependencies): Promise<Response> {
  const logger = deps?.logger ?? createLogger();
  const requestId = crypto.randomUUID().slice(0, 8);

  try {
    if (request.method === "GET") {
      const d = deps ?? createDependencies(loadConfig(), loadEnvSecrets(), logger);
      const enabled = await d.stateStore.getSystemEnabled();
      return jsonResponse({ status: "ok", enabled });
    }

    if (request.method !== "POST") {
      return errorResponse("Method not allowed", 405);
    }

    const body = await request.json().catch(() => null);
    const parsed = TogglePayload.safeParse(body);

    if (!parsed.success) {
      logger.warn("Invalid toggle payload", { requestId, errors: parsed.error.flatten() });
      return errorResponse("Invalid payload", 400);
    }

    const { enabled } = parsed.data;
    const d = deps ?? createDependencies(loadConfig(), loadEnvSecrets(), logger);

    await d.stateStore.setSystemEnabled(enabled);
    logger.info("System toggle updated", { requestId, enabled });

    if (enabled) {
      // Re-evaluate zones so timers are scheduled for any currently-exposed units
      const allSensorIds = Object.keys(d.config.sensorDelays);
      const sensorStates = await d.stateStore.getAllSensorStates(allSensorIds);
      for (const [id, defaultState] of Object.entries(d.config.sensorDefaults)) {
        if (!sensorStates.has(id)) {
          sensorStates.set(id, defaultState);
        }
      }
      for (const id of allSensorIds) {
        if (!sensorStates.has(id)) {
          sensorStates.set(id, "closed");
        }
      }

      const { exposedUnits, unexposedUnits } = evaluateZoneGraph(d.config.zones, sensorStates);
      logger.info("Re-evaluation after enable", { requestId, exposedUnits: [...exposedUnits], unexposedUnits: [...unexposedUnits] });

      const activeTimerUnitIds = await d.stateStore.getActiveTimerUnitIds();
      const previouslyExposed = new Set(activeTimerUnitIds);
      const { schedule, cancel } = computeTimerActions(previouslyExposed, exposedUnits);

      for (const unitId of schedule) {
        const delaySeconds = await getDelayForUnit(unitId, d.stateStore, d.config);
        const token = crypto.randomUUID();
        const ttl = delaySeconds + 60;
        await d.stateStore.setTimerToken(unitId, token, ttl);

        const window = Math.floor(Date.now() / (10 * 60 * 1000));
        const dedupId = `turnoff-${unitId}-${window}`;
        await d.scheduler.scheduleUnitTurnOff(unitId, token, delaySeconds, dedupId);
        logger.info("Timer scheduled on re-enable", { requestId, unitId, delaySeconds, token, dedupId });
      }

      for (const unitId of cancel) {
        await d.stateStore.deleteTimerToken(unitId);
        logger.info("Timer cancelled on re-enable", { requestId, unitId });
      }

      return jsonResponse({ status: "ok", enabled, scheduled: schedule, cancelled: cancel });
    }

    return jsonResponse({ status: "ok", enabled });
  } catch (error) {
    logger.error("system-toggle handler error", {
      requestId,
      error: error instanceof Error ? error.message : String(error),
    });
    return errorResponse("Internal server error", 500);
  }
}

export default async function handler(request: Request): Promise<Response> {
  return handleSystemToggle(request);
}
