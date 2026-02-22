import { describe, it, expect, vi, beforeEach } from "vitest";
import { RedisStateStore } from "@/providers/redis/client";

const mockSet = vi.fn().mockResolvedValue("OK");
const mockGet = vi.fn().mockResolvedValue(null);
const mockDel = vi.fn().mockResolvedValue(1);
const mockMget = vi.fn().mockResolvedValue([]);
const mockScan = vi.fn().mockResolvedValue(["0", []]);

vi.mock("@upstash/redis", () => {
  return {
    Redis: vi.fn().mockImplementation(() => ({
      set: mockSet,
      get: mockGet,
      del: mockDel,
      mget: mockMget,
      scan: mockScan,
    })),
  };
});

describe("RedisStateStore", () => {
  let store: RedisStateStore;

  beforeEach(() => {
    vi.clearAllMocks();
    store = new RedisStateStore({
      url: "https://redis.upstash.io",
      token: "test-token",
    });
  });

  describe("setSensorState", () => {
    it("sets sensor state with correct key", async () => {
      await store.setSensorState("front_door", "open");
      expect(mockSet).toHaveBeenCalledWith("sensor:front_door", "open");
    });
  });

  describe("getAllSensorStates", () => {
    it("returns map of sensor states", async () => {
      mockMget.mockResolvedValueOnce(["open", "closed", null]);

      const result = await store.getAllSensorStates(["s1", "s2", "s3"]);
      expect(mockMget).toHaveBeenCalledWith("sensor:s1", "sensor:s2", "sensor:s3");
      expect(result.get("s1")).toBe("open");
      expect(result.get("s2")).toBe("closed");
      expect(result.has("s3")).toBe(false);
    });

    it("returns empty map for empty input", async () => {
      const result = await store.getAllSensorStates([]);
      expect(result.size).toBe(0);
      expect(mockMget).not.toHaveBeenCalled();
    });
  });

  describe("setTimerToken", () => {
    it("sets timer token with TTL", async () => {
      await store.setTimerToken("ac_living", "token-abc", 150);
      expect(mockSet).toHaveBeenCalledWith("timer:ac_living", "token-abc", { ex: 150 });
    });
  });

  describe("getTimerToken", () => {
    it("returns token when present", async () => {
      mockGet.mockResolvedValueOnce("token-abc");
      const result = await store.getTimerToken("ac_living");
      expect(mockGet).toHaveBeenCalledWith("timer:ac_living");
      expect(result).toBe("token-abc");
    });

    it("returns null when missing", async () => {
      mockGet.mockResolvedValueOnce(null);
      const result = await store.getTimerToken("ac_living");
      expect(result).toBeNull();
    });
  });

  describe("deleteTimerToken", () => {
    it("deletes timer key", async () => {
      await store.deleteTimerToken("ac_living");
      expect(mockDel).toHaveBeenCalledWith("timer:ac_living");
    });
  });

  describe("getActiveTimerUnitIds", () => {
    it("scans and returns unit IDs from timer keys", async () => {
      mockScan.mockResolvedValueOnce(["0", ["timer:ac_living", "timer:ac_bedroom"]]);

      const result = await store.getActiveTimerUnitIds();
      expect(result).toEqual(["ac_living", "ac_bedroom"]);
    });

    it("handles multiple scan iterations", async () => {
      mockScan
        .mockResolvedValueOnce(["42", ["timer:ac_living"]])
        .mockResolvedValueOnce(["0", ["timer:ac_bedroom"]]);

      const result = await store.getActiveTimerUnitIds();
      expect(result).toEqual(["ac_living", "ac_bedroom"]);
      expect(mockScan).toHaveBeenCalledTimes(2);
    });

    it("returns empty array when no timers", async () => {
      mockScan.mockResolvedValueOnce(["0", []]);
      const result = await store.getActiveTimerUnitIds();
      expect(result).toEqual([]);
    });
  });
});
