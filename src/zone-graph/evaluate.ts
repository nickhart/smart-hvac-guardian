export type SensorState = "open" | "closed";
export type SensorStates = Map<string, SensorState>;

export interface InteriorDoor {
  id: string;
  connectsTo: string;
}

export interface ZoneConfig {
  minisplits: string[];
  exteriorOpenings: string[];
  interiorDoors: InteriorDoor[];
}

export type ZonesConfig = Record<string, ZoneConfig>;

export interface ZoneGraphResult {
  exposedUnits: Set<string>;
  unexposedUnits: Set<string>;
}

/**
 * BFS over zones connected by open interior doors.
 * Returns an array of connected components, where each component
 * is a set of zone IDs connected by open interior doors.
 */
export function getConnectedComponents(
  zones: ZonesConfig,
  sensorStates: SensorStates,
): Set<string>[] {
  const visited = new Set<string>();
  const components: Set<string>[] = [];

  for (const zoneId of Object.keys(zones)) {
    if (visited.has(zoneId)) continue;

    const component = new Set<string>();
    const queue: string[] = [zoneId];

    while (queue.length > 0) {
      const current = queue.shift()!;
      if (visited.has(current)) continue;
      visited.add(current);
      component.add(current);

      const zone = zones[current];
      if (!zone) continue;

      for (const door of zone.interiorDoors) {
        const doorState = sensorStates.get(door.id);
        if (doorState === "open" && !visited.has(door.connectsTo)) {
          queue.push(door.connectsTo);
        }
      }
    }

    components.push(component);
  }

  return components;
}

/**
 * Check if any exterior opening in a component is open.
 */
export function componentHasExposure(
  component: Set<string>,
  zones: ZonesConfig,
  sensorStates: SensorStates,
): boolean {
  for (const zoneId of component) {
    const zone = zones[zoneId];
    if (!zone) continue;

    for (const sensorId of zone.exteriorOpenings) {
      if (sensorStates.get(sensorId) === "open") {
        return true;
      }
    }
  }

  return false;
}

/**
 * Get the open exterior sensor IDs in a connected component.
 */
export function getOpenExteriorSensors(
  component: Set<string>,
  zones: ZonesConfig,
  sensorStates: SensorStates,
): string[] {
  const openSensors: string[] = [];

  for (const zoneId of component) {
    const zone = zones[zoneId];
    if (!zone) continue;

    for (const sensorId of zone.exteriorOpenings) {
      if (sensorStates.get(sensorId) === "open") {
        openSensors.push(sensorId);
      }
    }
  }

  return openSensors;
}

/**
 * Main evaluation: returns which HVAC units are exposed vs unexposed.
 */
export function evaluateZoneGraph(zones: ZonesConfig, sensorStates: SensorStates): ZoneGraphResult {
  const exposedUnits = new Set<string>();
  const unexposedUnits = new Set<string>();

  const components = getConnectedComponents(zones, sensorStates);

  for (const component of components) {
    const exposed = componentHasExposure(component, zones, sensorStates);

    for (const zoneId of component) {
      const zone = zones[zoneId];
      if (!zone) continue;

      for (const unitId of zone.minisplits) {
        if (exposed) {
          exposedUnits.add(unitId);
        } else {
          unexposedUnits.add(unitId);
        }
      }
    }
  }

  return { exposedUnits, unexposedUnits };
}
