import { describe, it, expect, vi, beforeEach } from "vitest";
import { YoLinkClient } from "@/providers/yolink/client";
import { YoLinkSensorProvider } from "@/providers/yolink/index";
import type { Logger } from "@/utils/logger";

const mockLogger: Logger = {
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
};

function createClient() {
  return new YoLinkClient({
    baseUrl: "https://api.yosmart.com/open/yolink/v2/api",
    uaCid: "test-cid",
    secretKey: "test-secret",
    logger: mockLogger,
  });
}

describe("YoLinkClient", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("fetches token, device list, and device state", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    // Token response (OAuth format — access_token at top level)
    fetchSpy.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          access_token: "tok123",
          expires_in: 7200,
          token_type: "Bearer",
        }),
      ),
    );

    // Device list response
    fetchSpy.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          code: "000000",
          msg: "Success",
          data: {
            devices: [
              {
                deviceId: "device1",
                deviceUDID: "u1",
                name: "Sensor 1",
                token: "dtok1",
                type: "DoorSensor",
              },
            ],
          },
        }),
      ),
    );

    // Device state response
    fetchSpy.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          code: "000000",
          msg: "Success",
          data: { state: { state: "open", battery: 4, alertInterval: 0 } },
        }),
      ),
    );

    const client = createClient();
    const state = await client.getDeviceState("device1");

    expect(state).toBe("open");
    expect(fetchSpy).toHaveBeenCalledTimes(3);
  });

  it("reuses cached token and device tokens", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    // Token response
    fetchSpy.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          access_token: "tok123",
          expires_in: 7200,
          token_type: "Bearer",
        }),
      ),
    );

    // Device list response (contains both devices)
    fetchSpy.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          code: "000000",
          msg: "Success",
          data: {
            devices: [
              {
                deviceId: "device1",
                deviceUDID: "u1",
                name: "Sensor 1",
                token: "dtok1",
                type: "DoorSensor",
              },
              {
                deviceId: "device2",
                deviceUDID: "u2",
                name: "Sensor 2",
                token: "dtok2",
                type: "DoorSensor",
              },
            ],
          },
        }),
      ),
    );

    // Two device state responses
    fetchSpy.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          code: "000000",
          msg: "Success",
          data: { state: { state: "open", battery: 4, alertInterval: 0 } },
        }),
      ),
    );
    fetchSpy.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          code: "000000",
          msg: "Success",
          data: { state: { state: "closed", battery: 4, alertInterval: 0 } },
        }),
      ),
    );

    const client = createClient();
    await client.getDeviceState("device1");
    await client.getDeviceState("device2");

    // 1 token + 1 device list + 2 state calls = 4 total
    expect(fetchSpy).toHaveBeenCalledTimes(4);
  });

  it("throws on token error", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response("", { status: 500 }));

    const client = createClient();
    await expect(client.getDeviceState("device1")).rejects.toThrow("Token request failed: 500");
  });

  it("throws on device state error code", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    // Token response
    fetchSpy.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          access_token: "tok123",
          expires_in: 7200,
          token_type: "Bearer",
        }),
      ),
    );

    // Device list response
    fetchSpy.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          code: "000000",
          msg: "Success",
          data: {
            devices: [
              {
                deviceId: "baddevice",
                deviceUDID: "u1",
                name: "Sensor",
                token: "dtok1",
                type: "DoorSensor",
              },
            ],
          },
        }),
      ),
    );

    // Device state response with error code
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify({ code: "000001", msg: "Device not found", data: {} })),
    );

    const client = createClient();
    await expect(client.getDeviceState("baddevice")).rejects.toThrow("Device state error");
  });
});

describe("YoLinkSensorProvider", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("maps open state", async () => {
    const mockClient = {
      getDeviceState: vi.fn().mockResolvedValue("open"),
    } as unknown as YoLinkClient;
    const provider = new YoLinkSensorProvider(mockClient, mockLogger);

    expect(await provider.getState("s1")).toBe("open");
  });

  it("maps closed state", async () => {
    const mockClient = {
      getDeviceState: vi.fn().mockResolvedValue("closed"),
    } as unknown as YoLinkClient;
    const provider = new YoLinkSensorProvider(mockClient, mockLogger);

    expect(await provider.getState("s1")).toBe("closed");
  });

  it("maps unknown state", async () => {
    const mockClient = {
      getDeviceState: vi.fn().mockResolvedValue("weird"),
    } as unknown as YoLinkClient;
    const provider = new YoLinkSensorProvider(mockClient, mockLogger);

    expect(await provider.getState("s1")).toBe("unknown");
  });
});
