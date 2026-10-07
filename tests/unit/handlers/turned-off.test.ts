import { describe, it, expect, vi } from "vitest";
import {
  TURNED_OFF_TTL_SECONDS,
  clearTurnedOff,
  markTurnedOff,
  skipUnitsAlreadyOff,
} from "@/handlers/turned-off";
import type { StateStore } from "@/providers/types";
import type { Logger } from "@/utils/logger";

const logger: Logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };

function store(overrides: Partial<StateStore> = {}): StateStore {
  return {
    getTurnedOffUnitIds: vi.fn().mockResolvedValue([]),
    markTurnedOff: vi.fn().mockResolvedValue(undefined),
    clearTurnedOff: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  } as unknown as StateStore;
}

describe("skipUnitsAlreadyOff", () => {
  it("holds back units already turned off this exposure", async () => {
    const s = store({ getTurnedOffUnitIds: vi.fn().mockResolvedValue(["ac_living"]) });

    const result = await skipUnitsAlreadyOff(["ac_living", "ac_bedroom"], s, logger, "r1");

    expect(result).toEqual({ schedule: ["ac_bedroom"], alreadyOff: ["ac_living"] });
  });

  it("doesn't ask the store when there is nothing to schedule", async () => {
    const s = store();
    expect(await skipUnitsAlreadyOff([], s, logger, "r1")).toEqual({
      schedule: [],
      alreadyOff: [],
    });
    expect(s.getTurnedOffUnitIds).not.toHaveBeenCalled();
  });

  // A redundant turn-off is what happened before the marker existed; a missed
  // one is new harm. When in doubt, schedule.
  it("schedules every unit if the markers can't be read", async () => {
    const s = store({ getTurnedOffUnitIds: vi.fn().mockRejectedValue(new Error("Redis down")) });

    const result = await skipUnitsAlreadyOff(["ac_living"], s, logger, "r1");

    expect(result).toEqual({ schedule: ["ac_living"], alreadyOff: [] });
  });
});

describe("markTurnedOff / clearTurnedOff", () => {
  it("marks with the marker's lifetime, which is also the retry interval", async () => {
    const s = store();
    await markTurnedOff("ac_living", s, logger, "r1");
    expect(s.markTurnedOff).toHaveBeenCalledWith("ac_living", TURNED_OFF_TTL_SECONDS);
  });

  it("never throws: a failed write only means re-issuing as before", async () => {
    const s = store({
      markTurnedOff: vi.fn().mockRejectedValue(new Error("Redis down")),
      clearTurnedOff: vi.fn().mockRejectedValue(new Error("Redis down")),
    });
    await expect(markTurnedOff("ac_living", s, logger, "r1")).resolves.toBeUndefined();
    await expect(clearTurnedOff(["ac_living"], s, logger, "r1")).resolves.toBeUndefined();
  });

  it("skips the round trip when there is nothing to clear", async () => {
    const s = store();
    await clearTurnedOff([], s, logger, "r1");
    expect(s.clearTurnedOff).not.toHaveBeenCalled();
  });
});
