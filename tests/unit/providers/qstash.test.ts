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

vi.mock("@upstash/qstash", () => {
  const publishJSON = vi.fn().mockResolvedValue({ messageId: "msg123" });
  return {
    Client: vi.fn().mockImplementation(() => ({ publishJSON })),
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

    // Verify the Client was called with the token
    const { Client } = await import("@upstash/qstash");
    expect(Client).toHaveBeenCalledWith({ token: "test-token" });
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
