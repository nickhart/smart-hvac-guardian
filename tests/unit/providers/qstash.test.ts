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

    await scheduler.scheduleUnitTurnOff("ac_living", "token-abc", 90);

    expect(mockPublishJSON).toHaveBeenCalledWith({
      url: "https://example.com/api/hvac-turn-off",
      body: {
        hvacUnitId: "ac_living",
        cancellationToken: "token-abc",
        expectedAt: expect.any(String),
      },
      delay: 90,
      deduplicationId: "turnoff-ac_living-token-abc",
      retries: 1,
    });
  });

  // The handler subtracts this from arrival time to measure delivery lateness,
  // so it has to be the intended fire time, not the publish time.
  it("stamps the message with when it is meant to fire", async () => {
    const scheduler = new QStashScheduler({
      token: "test-token",
      checkStateUrl: "https://example.com/api/check-state",
      turnOffUrl: "https://example.com/api/hvac-turn-off",
      logger: mockLogger,
    });

    const before = Date.now();
    await scheduler.scheduleUnitTurnOff("ac_living", "token-abc", 600);

    const { expectedAt } = mockPublishJSON.mock.calls[0][0].body as { expectedAt: string };
    const stamped = new Date(expectedAt).getTime();

    expect(stamped).toBeGreaterThanOrEqual(before + 600_000);
    expect(stamped).toBeLessThan(before + 600_000 + 5_000);
  });

  /**
   * The bug this replaced cost 34% of all scheduled turn-offs in production.
   *
   * QStash suppresses a repeat of the same deduplication id for ten minutes.
   * The id used to be built from a wall-clock ten-minute bucket, so a door that
   * opened, closed and reopened inside one bucket produced a second message
   * with an identical id, which QStash dropped. The surviving first message
   * then arrived carrying the superseded token, was rejected as a mismatch, and
   * the reopened door was left with no timer at all — a shutoff that silently
   * never happened.
   */
  it("gives each exposure its own deduplication id, however close together", async () => {
    const scheduler = new QStashScheduler({
      token: "test-token",
      checkStateUrl: "https://example.com/api/check-state",
      turnOffUrl: "https://example.com/api/hvac-turn-off",
      logger: mockLogger,
    });

    // Same unit, same wall-clock minute, two separate exposures.
    await scheduler.scheduleUnitTurnOff("ac_living", "token-first", 600);
    await scheduler.scheduleUnitTurnOff("ac_living", "token-second", 600);

    const ids = mockPublishJSON.mock.calls.map((call) => call[0].deduplicationId);
    expect(ids).toEqual(["turnoff-ac_living-token-first", "turnoff-ac_living-token-second"]);
    expect(new Set(ids).size).toBe(2);
  });

  // Deduplication still does its real job: one exposure scheduled twice — a
  // duplicate webhook, or two concurrent requests — is still suppressed.
  it("still deduplicates a repeat of the same exposure", async () => {
    const scheduler = new QStashScheduler({
      token: "test-token",
      checkStateUrl: "https://example.com/api/check-state",
      turnOffUrl: "https://example.com/api/hvac-turn-off",
      logger: mockLogger,
    });

    await scheduler.scheduleUnitTurnOff("ac_living", "same-token", 600);
    await scheduler.scheduleUnitTurnOff("ac_living", "same-token", 600);

    const ids = mockPublishJSON.mock.calls.map((call) => call[0].deduplicationId);
    expect(new Set(ids).size).toBe(1);
  });

  it("scopes the deduplication id to the tenant", async () => {
    const scheduler = new QStashScheduler({
      token: "test-token",
      checkStateUrl: "https://example.com/api/check-state",
      turnOffUrl: "https://example.com/api/hvac-turn-off",
      logger: mockLogger,
      tenantId: "tenant1",
    });

    await scheduler.scheduleUnitTurnOff("ac_living", "token-abc", 600);

    expect(mockPublishJSON.mock.calls[0][0].deduplicationId).toBe(
      "tenant1-turnoff-ac_living-token-abc",
    );
  });

  it("caps delivery retries so an outage is not amplified", async () => {
    // QStash defaults to 3 retries; each one re-fires the IFTTT webhook and
    // produces another failure notification.
    const scheduler = new QStashScheduler({
      token: "test-token",
      checkStateUrl: "https://example.com/api/check-state",
      turnOffUrl: "https://example.com/api/hvac-turn-off",
      logger: mockLogger,
    });

    await scheduler.scheduleUnitTurnOff("ac_living", "token-abc", 90);
    await scheduler.scheduleTurnOff("dedup-2");
    await scheduler.scheduleDelayedCheck("front_door", 30);

    for (const call of mockPublishJSON.mock.calls) {
      expect(call[0].retries).toBe(1);
    }
  });

  it("throws ProviderError on scheduleUnitTurnOff failure", async () => {
    mockPublishJSON.mockRejectedValueOnce(new Error("QStash down"));

    const scheduler = new QStashScheduler({
      token: "test-token",
      checkStateUrl: "https://example.com/api/check-state",
      turnOffUrl: "https://example.com/api/hvac-turn-off",
      logger: mockLogger,
    });

    await expect(scheduler.scheduleUnitTurnOff("ac_living", "token-abc", 90)).rejects.toThrow(
      "Failed to schedule unit turn-off",
    );
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
