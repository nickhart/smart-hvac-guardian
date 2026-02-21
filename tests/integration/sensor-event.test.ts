import { describe, it, expect, vi } from "vitest";
import { handleSensorEvent } from "../../api/sensor-event";
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
    sensor: { getState: vi.fn() },
    hvac: { turnOff: vi.fn() },
    scheduler: { scheduleDelayedCheck: vi.fn().mockResolvedValue(undefined) },
    qstashReceiver: { verify: vi.fn() } as never,
    config: {
      sensors: [{ id: "sensor1", name: "Front Door", delaySeconds: 90 }],
      hvacUnits: [{ id: "unit1", name: "AC", iftttEvent: "turn_off_ac" }],
      yolink: { baseUrl: "https://api.yosmart.com/open/yolink/v2/api" },
      checkStateUrl: "https://example.com/api/check-state",
    },
    logger: mockLogger,
    ...overrides,
  };
}

function makeRequest(body: unknown, method = "POST"): Request {
  return new Request("https://example.com/api/sensor-event", {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("sensor-event handler", () => {
  it("returns 405 for non-POST", async () => {
    const req = new Request("https://example.com/api/sensor-event", { method: "GET" });
    const res = await handleSensorEvent(req, createMockDeps());
    expect(res.status).toBe(405);
  });

  it("returns 400 for invalid payload", async () => {
    const res = await handleSensorEvent(makeRequest({ bad: "data" }), createMockDeps());
    expect(res.status).toBe(400);
  });

  it("returns ok with no action on close event", async () => {
    const deps = createMockDeps();
    const res = await handleSensorEvent(makeRequest({ sensorId: "sensor1", event: "close" }), deps);
    const body = (await res.json()) as Record<string, unknown>;

    expect(res.status).toBe(200);
    expect(body.action).toBe("none");
    expect(deps.scheduler.scheduleDelayedCheck).not.toHaveBeenCalled();
  });

  it("schedules delayed check on open event", async () => {
    const deps = createMockDeps();
    const res = await handleSensorEvent(makeRequest({ sensorId: "sensor1", event: "open" }), deps);
    const body = (await res.json()) as Record<string, unknown>;

    expect(res.status).toBe(200);
    expect(body.action).toBe("scheduled");
    expect(body.delaySeconds).toBe(90);
    expect(deps.scheduler.scheduleDelayedCheck).toHaveBeenCalledWith("sensor1", 90);
  });

  it("returns 404 for unknown sensor", async () => {
    const deps = createMockDeps();
    const res = await handleSensorEvent(makeRequest({ sensorId: "unknown", event: "open" }), deps);
    expect(res.status).toBe(404);
  });

  it("returns 500 on scheduler failure", async () => {
    const deps = createMockDeps({
      scheduler: {
        scheduleDelayedCheck: vi.fn().mockRejectedValue(new Error("QStash down")),
      },
    });
    const res = await handleSensorEvent(makeRequest({ sensorId: "sensor1", event: "open" }), deps);
    expect(res.status).toBe(500);
  });
});
