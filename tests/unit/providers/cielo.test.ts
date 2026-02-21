import { describe, it, expect, vi, beforeEach } from "vitest";
import { IFTTTClient } from "@/providers/cielo/client";
import { CieloIFTTTProvider } from "@/providers/cielo/index";
import type { Logger } from "@/utils/logger";

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
