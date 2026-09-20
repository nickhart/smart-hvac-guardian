import { describe, it, expect, vi, beforeEach } from "vitest";
import { RedisStateStore } from "@/providers/redis/client";

const mockSet = vi.fn().mockResolvedValue("OK");
const mockGet = vi.fn().mockResolvedValue(null);
const mockDel = vi.fn().mockResolvedValue(1);
const mockMget = vi.fn().mockResolvedValue([]);
const mockScan = vi.fn().mockResolvedValue(["0", []]);
const mockIncr = vi.fn().mockResolvedValue(1);
const mockExpire = vi.fn().mockResolvedValue(1);
const mockPing = vi.fn().mockResolvedValue("PONG");

vi.mock("@upstash/redis", () => {
  return {
    Redis: vi.fn().mockImplementation(() => ({
      set: mockSet,
      get: mockGet,
      del: mockDel,
      mget: mockMget,
      scan: mockScan,
      incr: mockIncr,
      expire: mockExpire,
      ping: mockPing,
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

  describe("getSystemEnabled", () => {
    /**
     * Nothing seeds `system:enabled` — only the toggle endpoint writes it — so
     * an absent key used to mean enabled. A Redis instance replaced, flushed,
     * migrated, or a changed tenant prefix would silently switch the system on
     * and start shutting off guests' HVAC, logging nothing, because as far as
     * the code was concerned nothing had happened.
     *
     * Unknown state must never mean "actuate". This matches the safe default
     * used for sensors, where an unknown reading is treated as closed so the
     * AC stays on.
     */
    it("defaults to disabled when the key is not set", async () => {
      mockGet.mockResolvedValueOnce(null);
      expect(await store.getSystemEnabled()).toBe(false);
    });

    it("defaults to disabled on a value it does not recognise", async () => {
      mockGet.mockResolvedValueOnce("yes");
      expect(await store.getSystemEnabled()).toBe(false);
    });

    it("returns true when value is 'true'", async () => {
      mockGet.mockResolvedValueOnce("true");
      expect(await store.getSystemEnabled()).toBe(true);
    });

    // Upstash deserialises stored values, so the booleans arrive unquoted.
    it("handles a deserialised boolean either way", async () => {
      mockGet.mockResolvedValueOnce(true);
      expect(await store.getSystemEnabled()).toBe(true);
      mockGet.mockResolvedValueOnce(false);
      expect(await store.getSystemEnabled()).toBe(false);
    });

    it("returns false when value is 'false'", async () => {
      mockGet.mockResolvedValueOnce("false");
      expect(await store.getSystemEnabled()).toBe(false);
    });

    // A system off because nobody turned it on looks identical to one off
    // because someone turned it off. Only the log tells them apart.
    it("logs when it falls back to the safe default", async () => {
      const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
      const logged = new RedisStateStore({ url: "https://x", token: "t", logger });
      mockGet.mockResolvedValueOnce(null);

      await logged.getSystemEnabled();

      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining("defaulting to disabled"),
        expect.anything(),
      );
    });
  });

  describe("setSystemEnabled", () => {
    it("sets system:enabled to true", async () => {
      await store.setSystemEnabled(true);
      expect(mockSet).toHaveBeenCalledWith("system:enabled", "true");
    });

    it("sets system:enabled to false", async () => {
      await store.setSystemEnabled(false);
      expect(mockSet).toHaveBeenCalledWith("system:enabled", "false");
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

describe("RedisStateStore circuit breaker", () => {
  let store: RedisStateStore;

  beforeEach(() => {
    vi.clearAllMocks();
    store = new RedisStateStore({
      url: "https://redis.upstash.io",
      token: "test-token",
      tenantId: "tenant-1",
    });
  });

  it("reports a circuit as closed when no marker exists", async () => {
    mockGet.mockResolvedValueOnce(null);
    await expect(store.isCircuitOpen("ifttt")).resolves.toBe(false);
    expect(mockGet).toHaveBeenCalledWith("tenant-1:circuit:ifttt:open");
  });

  it("reports a circuit as open when the marker is present", async () => {
    mockGet.mockResolvedValueOnce("1");
    await expect(store.isCircuitOpen("ifttt")).resolves.toBe(true);
  });

  it("opens a circuit with a cooldown TTL and clears the counter", async () => {
    await store.openCircuit("ifttt", 600);
    expect(mockSet).toHaveBeenCalledWith("tenant-1:circuit:ifttt:open", "1", { ex: 600 });
    expect(mockDel).toHaveBeenCalledWith("tenant-1:circuit:ifttt:failures");
  });

  it("sets the window TTL only on the first failure", async () => {
    mockIncr.mockResolvedValueOnce(1);
    await expect(store.recordCircuitFailure("ifttt", 900)).resolves.toBe(1);
    expect(mockExpire).toHaveBeenCalledWith("tenant-1:circuit:ifttt:failures", 900);

    vi.clearAllMocks();
    mockIncr.mockResolvedValueOnce(2);
    await expect(store.recordCircuitFailure("ifttt", 900)).resolves.toBe(2);
    expect(mockExpire).not.toHaveBeenCalled();
  });

  it("resets both circuit keys", async () => {
    await store.resetCircuit("ifttt");
    expect(mockDel).toHaveBeenCalledWith("tenant-1:circuit:ifttt:failures");
    expect(mockDel).toHaveBeenCalledWith("tenant-1:circuit:ifttt:open");
  });

  it("pings Redis for health checks", async () => {
    await store.ping();
    expect(mockPing).toHaveBeenCalled();
  });
});
