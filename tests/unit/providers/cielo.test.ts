import { describe, it, expect, vi, beforeEach } from "vitest";
import { IFTTTClient } from "@/providers/cielo/client";
import { CieloIFTTTProvider } from "@/providers/cielo/index";
import type { Logger } from "@/utils/logger";
import { CircuitOpenError, ProviderError, TerminalProviderError } from "@/utils/errors";

const mockLogger: Logger = {
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
};

describe("IFTTTClient", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("triggers webhook with correct URL", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response("Congratulations!"));

    const client = new IFTTTClient({ webhookKey: "mykey", logger: mockLogger });
    await client.trigger("turn_off_ac");

    expect(fetchSpy).toHaveBeenCalledWith(
      "https://maker.ifttt.com/trigger/turn_off_ac/with/key/mykey",
      { method: "POST" },
    );
  });

  it("throws on non-OK response", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response("", { status: 401 }));

    const client = new IFTTTClient({ webhookKey: "mykey", logger: mockLogger });
    await expect(client.trigger("event1")).rejects.toThrow("Webhook trigger failed: 401");
  });
});

describe("CieloIFTTTProvider", () => {
  it("delegates to IFTTTClient", async () => {
    const mockClient = { trigger: vi.fn().mockResolvedValue(undefined) } as unknown as IFTTTClient;
    const provider = new CieloIFTTTProvider(mockClient);

    await provider.turnOff("turn_off_ac");
    expect(mockClient.trigger).toHaveBeenCalledWith("turn_off_ac");
  });
});

describe("IFTTT failure classification", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it.each([
    [400, true],
    [401, true],
    [404, true],
    [429, false],
    [500, false],
    [503, false],
  ])("classifies HTTP %i as terminal=%s", async (status, terminal) => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response("", { status }));

    const client = new IFTTTClient({ webhookKey: "mykey", logger: mockLogger });
    await expect(client.trigger("event1")).rejects.toSatisfy(
      (e: unknown) => e instanceof TerminalProviderError === terminal,
    );
  });

  it("treats a network failure as retryable", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValueOnce(new Error("ECONNRESET"));

    const client = new IFTTTClient({ webhookKey: "mykey", logger: mockLogger });
    const error = await client.trigger("event1").catch((e) => e);

    expect(error).toBeInstanceOf(ProviderError);
    expect(error).not.toBeInstanceOf(TerminalProviderError);
  });
});

describe("CieloIFTTTProvider circuit breaking", () => {
  function createCircuitStore(open: boolean) {
    return {
      isCircuitOpen: vi.fn().mockResolvedValue(open),
      openCircuit: vi.fn().mockResolvedValue(undefined),
      recordCircuitFailure: vi.fn().mockResolvedValue(1),
      resetCircuit: vi.fn().mockResolvedValue(undefined),
    };
  }

  function createAnalytics() {
    return {
      trackSensorEvent: vi.fn().mockResolvedValue(undefined),
      trackHvacCommand: vi.fn().mockResolvedValue(undefined),
      trackHvacStateEvent: vi.fn().mockResolvedValue(undefined),
      trackProviderEvent: vi.fn().mockResolvedValue(undefined),
    };
  }

  it("does not call IFTTT when the circuit is open", async () => {
    const mockClient = { trigger: vi.fn() } as unknown as IFTTTClient;
    const analytics = createAnalytics();
    const provider = new CieloIFTTTProvider(mockClient, {
      circuitStore: createCircuitStore(true),
      analytics,
      logger: mockLogger,
    });

    await expect(provider.turnOff("turn_off_ac")).rejects.toBeInstanceOf(CircuitOpenError);
    expect(mockClient.trigger).not.toHaveBeenCalled();
    expect(analytics.trackProviderEvent).toHaveBeenCalledWith(
      expect.objectContaining({ provider: "ifttt", outcome: "skipped_circuit_open" }),
    );
  });

  it("records a successful call", async () => {
    const mockClient = { trigger: vi.fn().mockResolvedValue(undefined) } as unknown as IFTTTClient;
    const analytics = createAnalytics();
    const provider = new CieloIFTTTProvider(mockClient, {
      circuitStore: createCircuitStore(false),
      analytics,
      logger: mockLogger,
    });

    await provider.turnOff("turn_off_ac");

    expect(analytics.trackProviderEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: "ifttt",
        operation: "trigger:turn_off_ac",
        outcome: "ok",
      }),
    );
  });

  it("records a failure and rethrows", async () => {
    const mockClient = {
      trigger: vi.fn().mockRejectedValue(new TerminalProviderError("IFTTT", "401")),
    } as unknown as IFTTTClient;
    const analytics = createAnalytics();
    const provider = new CieloIFTTTProvider(mockClient, {
      circuitStore: createCircuitStore(false),
      analytics,
      logger: mockLogger,
    });

    await expect(provider.turnOff("turn_off_ac")).rejects.toBeInstanceOf(TerminalProviderError);
    expect(analytics.trackProviderEvent).toHaveBeenCalledWith(
      expect.objectContaining({ outcome: "failed", terminal: true }),
    );
  });
});
