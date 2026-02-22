import { describe, it, expect } from "vitest";
import { computeTimerActions } from "@/zone-graph/diff";

describe("computeTimerActions", () => {
  it("schedules newly exposed units", () => {
    const prev = new Set<string>();
    const curr = new Set(["ac_living", "ac_bedroom"]);

    const result = computeTimerActions(prev, curr);
    expect(result.schedule.sort()).toEqual(["ac_bedroom", "ac_living"]);
    expect(result.cancel).toEqual([]);
  });

  it("cancels units no longer exposed", () => {
    const prev = new Set(["ac_living", "ac_bedroom"]);
    const curr = new Set<string>();

    const result = computeTimerActions(prev, curr);
    expect(result.schedule).toEqual([]);
    expect(result.cancel.sort()).toEqual(["ac_bedroom", "ac_living"]);
  });

  it("schedules new and cancels old when exposure changes", () => {
    const prev = new Set(["ac_living", "ac_bedroom"]);
    const curr = new Set(["ac_living", "ac_loft"]);

    const result = computeTimerActions(prev, curr);
    expect(result.schedule).toEqual(["ac_loft"]);
    expect(result.cancel).toEqual(["ac_bedroom"]);
  });

  it("returns empty actions when nothing changes", () => {
    const prev = new Set(["ac_living"]);
    const curr = new Set(["ac_living"]);

    const result = computeTimerActions(prev, curr);
    expect(result.schedule).toEqual([]);
    expect(result.cancel).toEqual([]);
  });

  it("handles both sets empty", () => {
    const result = computeTimerActions(new Set(), new Set());
    expect(result.schedule).toEqual([]);
    expect(result.cancel).toEqual([]);
  });
});
