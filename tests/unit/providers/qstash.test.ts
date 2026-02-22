import { describe, it, expect, vi, beforeEach } from "vitest";
import { QStashScheduler } from "@/providers/qstash/index";
import { verifyQStashSignature, createQStashReceiver } from "@/providers/qstash/verify";
import type { Logger } from "@/utils/logger";

const mockLogger: Logger = {
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
};

const mockPublishJSON = vi.fn().mockResolvedValue({ messageId: "msg123" });

vi.mock("@upstash/qstash", () => {
  return {
    Client: vi.fn().mockImplementation(() => ({ publishJSON: mockPublishJSON })),
    Receiver: vi.fn().mockImplementation(() => ({
      verify: vi.fn().mockResolvedValue(true),
    })),
  };
});

describe("QStashScheduler", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("publishes delayed check with correct params", async () => {
    const scheduler = new QStashScheduler({
      token: "test-token",
      checkStateUrl: "https://example.com/api/check-state",
      turnOffUrl: "https://example.com/api/hvac-turn-off",
      logger: mockLogger,
    });

    await scheduler.scheduleDelayedCheck("sensor1", 90);

    const { Client } = await import("@upstash/qstash");
    expect(Client).toHaveBeenCalledWith({ token: "test-token" });
  });

  it("publishes per-unit turn-off with correct params", async () => {
    const scheduler = new QStashScheduler({
      token: "test-token",
      checkStateUrl: "https://example.com/api/check-state",
      turnOffUrl: "https://example.com/api/hvac-turn-off",
      logger: mockLogger,
    });

    await scheduler.scheduleUnitTurnOff("ac_living", "token-abc", 90, "turnoff-ac_living-123");

    expect(mockPublishJSON).toHaveBeenCalledWith({
      url: "https://example.com/api/hvac-turn-off",
      body: { hvacUnitId: "ac_living", cancellationToken: "token-abc" },
      delay: 90,
      deduplicationId: "turnoff-ac_living-123",
    });
  });

  it("throws ProviderError on scheduleUnitTurnOff failure", async () => {
    mockPublishJSON.mockRejectedValueOnce(new Error("QStash down"));

    const scheduler = new QStashScheduler({
      token: "test-token",
      checkStateUrl: "https://example.com/api/check-state",
      turnOffUrl: "https://example.com/api/hvac-turn-off",
      logger: mockLogger,
    });

    await expect(
      scheduler.scheduleUnitTurnOff("ac_living", "token-abc", 90, "dedup-1"),
    ).rejects.toThrow("Failed to schedule unit turn-off");
  });
});

describe("verifyQStashSignature", () => {
  it("passes when signature is valid", async () => {
    const receiver = createQStashReceiver({
      currentSigningKey: "key1",
      nextSigningKey: "key2",
    });

    await expect(
      verifyQStashSignature(receiver, "valid-sig", '{"sensorId":"s1"}'),
    ).resolves.toBeUndefined();
  });

  it("throws on invalid signature", async () => {
    const { Receiver } = await import("@upstash/qstash");
    vi.mocked(Receiver).mockImplementationOnce(
      () =>
        ({
          verify: vi.fn().mockRejectedValue(new Error("bad sig")),
        }) as never,
    );

    const receiver = createQStashReceiver({
      currentSigningKey: "key1",
      nextSigningKey: "key2",
    });

    await expect(verifyQStashSignature(receiver, "bad-sig", "body")).rejects.toThrow(
      "Invalid QStash signature",
    );
  });
});
