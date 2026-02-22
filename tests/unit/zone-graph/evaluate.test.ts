import { describe, it, expect } from "vitest";
import {
  getConnectedComponents,
  componentHasExposure,
  evaluateZoneGraph,
  getOpenExteriorSensors,
} from "@/zone-graph/evaluate";
import type { ZonesConfig, SensorStates } from "@/zone-graph/evaluate";

// Three-zone layout:
// zone_living: exterior=front_door, interior door to zone_main_bedroom
// zone_main_bedroom: exterior=bedroom_window, interior door to zone_living
// zone_back_bedroom: exterior=back_window, interior door to zone_main_bedroom

const threeZoneConfig: ZonesConfig = {
  zone_living: {
    minisplits: ["ac_living"],
    exteriorOpenings: ["front_door"],
    interiorDoors: [{ id: "door_main_bedroom", connectsTo: "zone_main_bedroom" }],
  },
  zone_main_bedroom: {
    minisplits: ["ac_main_bedroom"],
    exteriorOpenings: ["bedroom_window"],
    interiorDoors: [
      { id: "door_main_bedroom", connectsTo: "zone_living" },
      { id: "door_back_bedroom", connectsTo: "zone_back_bedroom" },
    ],
  },
  zone_back_bedroom: {
    minisplits: ["ac_back_bedroom"],
    exteriorOpenings: ["back_window"],
    interiorDoors: [{ id: "door_back_bedroom", connectsTo: "zone_main_bedroom" }],
  },
};

describe("getConnectedComponents", () => {
  it("all interior doors closed: each zone is its own component", () => {
    const states: SensorStates = new Map([
      ["door_main_bedroom", "closed"],
      ["door_back_bedroom", "closed"],
      ["front_door", "closed"],
      ["bedroom_window", "closed"],
      ["back_window", "closed"],
    ]);

    const components = getConnectedComponents(threeZoneConfig, states);
    expect(components).toHaveLength(3);
    for (const c of components) {
      expect(c.size).toBe(1);
    }
  });

  it("one interior door open merges two zones", () => {
    const states: SensorStates = new Map([
      ["door_main_bedroom", "open"],
      ["door_back_bedroom", "closed"],
    ]);

    const components = getConnectedComponents(threeZoneConfig, states);
    expect(components).toHaveLength(2);

    const merged = components.find((c) => c.size === 2)!;
    expect(merged).toBeDefined();
    expect(merged.has("zone_living")).toBe(true);
    expect(merged.has("zone_main_bedroom")).toBe(true);
  });

  it("all interior doors open: single component with all zones", () => {
    const states: SensorStates = new Map([
      ["door_main_bedroom", "open"],
      ["door_back_bedroom", "open"],
    ]);

    const components = getConnectedComponents(threeZoneConfig, states);
    expect(components).toHaveLength(1);
    expect(components[0].size).toBe(3);
  });
});

describe("componentHasExposure", () => {
  it("returns true when exterior opening in component is open", () => {
    const component = new Set(["zone_living"]);
    const states: SensorStates = new Map([["front_door", "open"]]);

    expect(componentHasExposure(component, threeZoneConfig, states)).toBe(true);
  });

  it("returns false when all exterior openings in component are closed", () => {
    const component = new Set(["zone_living"]);
    const states: SensorStates = new Map([["front_door", "closed"]]);

    expect(componentHasExposure(component, threeZoneConfig, states)).toBe(false);
  });

  it("returns false when no sensor state available (defaults to not open)", () => {
    const component = new Set(["zone_living"]);
    const states: SensorStates = new Map();

    expect(componentHasExposure(component, threeZoneConfig, states)).toBe(false);
  });
});

describe("getOpenExteriorSensors", () => {
  it("returns open exterior sensors in a component", () => {
    const component = new Set(["zone_living", "zone_main_bedroom"]);
    const states: SensorStates = new Map([
      ["front_door", "open"],
      ["bedroom_window", "closed"],
    ]);

    const result = getOpenExteriorSensors(component, threeZoneConfig, states);
    expect(result).toEqual(["front_door"]);
  });

  it("returns multiple open sensors", () => {
    const component = new Set(["zone_living", "zone_main_bedroom"]);
    const states: SensorStates = new Map([
      ["front_door", "open"],
      ["bedroom_window", "open"],
    ]);

    const result = getOpenExteriorSensors(component, threeZoneConfig, states);
    expect(result).toEqual(["front_door", "bedroom_window"]);
  });
});

describe("evaluateZoneGraph", () => {
  it("all doors closed, one exterior open: only that zone's units exposed", () => {
    const states: SensorStates = new Map([
      ["door_main_bedroom", "closed"],
      ["door_back_bedroom", "closed"],
      ["front_door", "open"],
      ["bedroom_window", "closed"],
      ["back_window", "closed"],
    ]);

    const result = evaluateZoneGraph(threeZoneConfig, states);
    expect(result.exposedUnits).toEqual(new Set(["ac_living"]));
    expect(result.unexposedUnits).toEqual(new Set(["ac_main_bedroom", "ac_back_bedroom"]));
  });

  it("interior door open merges zones: both zones' units exposed", () => {
    const states: SensorStates = new Map([
      ["door_main_bedroom", "open"],
      ["door_back_bedroom", "closed"],
      ["front_door", "open"],
      ["bedroom_window", "closed"],
      ["back_window", "closed"],
    ]);

    const result = evaluateZoneGraph(threeZoneConfig, states);
    expect(result.exposedUnits).toEqual(new Set(["ac_living", "ac_main_bedroom"]));
    expect(result.unexposedUnits).toEqual(new Set(["ac_back_bedroom"]));
  });

  it("three-zone chain: A exterior open, A-B open, B-C closed: A+B exposed, C safe", () => {
    const states: SensorStates = new Map([
      ["door_main_bedroom", "open"],
      ["door_back_bedroom", "closed"],
      ["front_door", "open"],
      ["bedroom_window", "closed"],
      ["back_window", "closed"],
    ]);

    const result = evaluateZoneGraph(threeZoneConfig, states);
    expect(result.exposedUnits.has("ac_living")).toBe(true);
    expect(result.exposedUnits.has("ac_main_bedroom")).toBe(true);
    expect(result.unexposedUnits.has("ac_back_bedroom")).toBe(true);
  });

  it("all doors open, one exterior open: all units exposed", () => {
    const states: SensorStates = new Map([
      ["door_main_bedroom", "open"],
      ["door_back_bedroom", "open"],
      ["front_door", "open"],
      ["bedroom_window", "closed"],
      ["back_window", "closed"],
    ]);

    const result = evaluateZoneGraph(threeZoneConfig, states);
    expect(result.exposedUnits).toEqual(
      new Set(["ac_living", "ac_main_bedroom", "ac_back_bedroom"]),
    );
    expect(result.unexposedUnits.size).toBe(0);
  });

  it("no exterior openings open: no units exposed", () => {
    const states: SensorStates = new Map([
      ["door_main_bedroom", "open"],
      ["door_back_bedroom", "open"],
      ["front_door", "closed"],
      ["bedroom_window", "closed"],
      ["back_window", "closed"],
    ]);

    const result = evaluateZoneGraph(threeZoneConfig, states);
    expect(result.exposedUnits.size).toBe(0);
    expect(result.unexposedUnits).toEqual(
      new Set(["ac_living", "ac_main_bedroom", "ac_back_bedroom"]),
    );
  });

  it("closing interior door isolates zone", () => {
    // Initially A-B open, exterior A open: A+B exposed
    const statesBefore: SensorStates = new Map([
      ["door_main_bedroom", "open"],
      ["door_back_bedroom", "closed"],
      ["front_door", "open"],
      ["bedroom_window", "closed"],
      ["back_window", "closed"],
    ]);

    const resultBefore = evaluateZoneGraph(threeZoneConfig, statesBefore);
    expect(resultBefore.exposedUnits).toEqual(new Set(["ac_living", "ac_main_bedroom"]));

    // Now close interior door: B isolated, only A exposed
    const statesAfter: SensorStates = new Map([
      ["door_main_bedroom", "closed"],
      ["door_back_bedroom", "closed"],
      ["front_door", "open"],
      ["bedroom_window", "closed"],
      ["back_window", "closed"],
    ]);

    const resultAfter = evaluateZoneGraph(threeZoneConfig, statesAfter);
    expect(resultAfter.exposedUnits).toEqual(new Set(["ac_living"]));
    expect(resultAfter.unexposedUnits.has("ac_main_bedroom")).toBe(true);
  });
});
