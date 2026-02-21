import { describe, it, expect, vi } from "vitest";
import { handleCheckState } from "../../api/check-state";
import type { Dependencies } from "@/handlers/dependencies";
import type { Logger } from "@/utils/logger";

const mockLogger: Logger = {
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
};

function createMockDeps(overrides?: Partial<Dependencies>): Dependencies {
  return {
    sensor: { getState: vi.fn().mockResolvedValue("open") },
    hvac: { turnOff: vi.fn().mockResolvedValue(undefined) },
    scheduler: { scheduleDelayedCheck: vi.fn() },
    qstashReceiver: { verify: vi.fn().mockResolvedValue(true) } as never,
    config: {
      sensors: [{ id: "sensor1", name: "Front Door", delaySeconds: 90 }],
      hvacUnits: [
        { id: "unit1", name: "AC", iftttEvent: "turn_off_ac" },
        { id: "unit2", name: "Heater", iftttEvent: "turn_off_heat" },
      ],
      yolink: { baseUrl: "https://api.yosmart.com/open/yolink/v2/api" },
      checkStateUrl: "https://example.com/api/check-state",
    },
    logger: mockLogger,
    ...overrides,
  };
}

function makeRequest(body: unknown, signature = "valid-sig"): Request {
  return new Request("https://example.com/api/check-state", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "upstash-signature": signature,
    },
    body: JSON.stringify(body),
  });
}

describe("check-state handler", () => {
  it("returns 405 for non-POST", async () => {
    const req = new Request("https://example.com/api/check-state", { method: "GET" });
    const res = await handleCheckState(req, createMockDeps());
    expect(res.status).toBe(405);
  });

  it("returns 401 for invalid QStash signature", async () => {
    const deps = createMockDeps({
      qstashReceiver: {
        verify: vi.fn().mockRejectedValue(new Error("bad sig")),
      } as never,
    });

    const res = await handleCheckState(makeRequest({ sensorId: "sensor1" }), deps);
    expect(res.status).toBe(401);
  });

  it("returns no action when sensor is closed", async () => {
    const deps = createMockDeps({
      sensor: { getState: vi.fn().mockResolvedValue("closed") },
    });

    const res = await handleCheckState(makeRequest({ sensorId: "sensor1" }), deps);
    const body = (await res.json()) as Record<string, unknown>;

    expect(res.status).toBe(200);
    expect(body.action).toBe("none");
    expect(body.state).toBe("closed");
    expect(deps.hvac.turnOff).not.toHaveBeenCalled();
  });

  it("turns off all HVAC units when sensor is still open", async () => {
    const deps = createMockDeps();
    const res = await handleCheckState(makeRequest({ sensorId: "sensor1" }), deps);
    const body = (await res.json()) as Record<string, unknown>;

    expect(res.status).toBe(200);
    expect(body.action).toBe("hvac_turned_off");
    expect(body.unitsProcessed).toBe(2);
    expect(body.failures).toBe(0);
    expect(deps.hvac.turnOff).toHaveBeenCalledTimes(2);
    expect(deps.hvac.turnOff).toHaveBeenCalledWith("turn_off_ac");
    expect(deps.hvac.turnOff).toHaveBeenCalledWith("turn_off_heat");
  });

  it("reports partial failures", async () => {
    const turnOff = vi
      .fn()
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error("IFTTT down"));

    const deps = createMockDeps({ hvac: { turnOff } });
    const res = await handleCheckState(makeRequest({ sensorId: "sensor1" }), deps);
    const body = (await res.json()) as Record<string, unknown>;

    expect(body.action).toBe("hvac_turned_off");
    expect(body.failures).toBe(1);
  });

  it("returns 400 for invalid payload", async () => {
    const deps = createMockDeps();
    const res = await handleCheckState(makeRequest({ bad: "data" }), deps);
    expect(res.status).toBe(400);
  });
});
