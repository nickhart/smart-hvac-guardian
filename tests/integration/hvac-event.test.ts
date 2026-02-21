import { describe, it, expect, vi } from "vitest";
import { handleHvacEvent } from "../../api/hvac-event";
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
      sensors: [
        { id: "sensor1", name: "Front Door", delaySeconds: 90 },
        { id: "sensor2", name: "Back Door", delaySeconds: 120 },
      ],
      hvacUnits: [{ id: "unit1", name: "AC", iftttEvent: "turn_off_ac" }],
      yolink: { baseUrl: "https://api.yosmart.com/open/yolink/v2/api" },
      checkStateUrl: "https://example.com/api/check-state",
    },
    logger: mockLogger,
    ...overrides,
  };
}

function makeRequest(body: unknown, method = "POST"): Request {
  return new Request("https://example.com/api/hvac-event", {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("hvac-event handler", () => {
  it("returns 405 for non-POST", async () => {
    const req = new Request("https://example.com/api/hvac-event", { method: "GET" });
    const res = await handleHvacEvent(req, createMockDeps());
    expect(res.status).toBe(405);
  });

  it("returns 400 for invalid payload", async () => {
    const res = await handleHvacEvent(makeRequest({ bad: "data" }), createMockDeps());
    expect(res.status).toBe(400);
  });

  it("returns ok with no action on off event", async () => {
    const deps = createMockDeps();
    const res = await handleHvacEvent(makeRequest({ hvacId: "unit1", event: "off" }), deps);
    const body = (await res.json()) as Record<string, unknown>;

    expect(res.status).toBe(200);
    expect(body.action).toBe("none");
    expect(deps.scheduler.scheduleDelayedCheck).not.toHaveBeenCalled();
  });

  it("schedules delayed check for each sensor on 'on' event", async () => {
    const deps = createMockDeps();
    const res = await handleHvacEvent(makeRequest({ hvacId: "unit1", event: "on" }), deps);
    const body = (await res.json()) as Record<string, unknown>;

    expect(res.status).toBe(200);
    expect(body.action).toBe("scheduled");
    expect(body.checksScheduled).toBe(2);
    expect(deps.scheduler.scheduleDelayedCheck).toHaveBeenCalledWith(
      "sensor1",
      90,
      expect.stringContaining("check-sensor-sensor1-"),
    );
    expect(deps.scheduler.scheduleDelayedCheck).toHaveBeenCalledWith(
      "sensor2",
      120,
      expect.stringContaining("check-sensor-sensor2-"),
    );
  });

  it("returns 404 for unknown hvacId", async () => {
    const deps = createMockDeps();
    const res = await handleHvacEvent(makeRequest({ hvacId: "unknown", event: "on" }), deps);
    expect(res.status).toBe(404);
  });

  it("returns 500 on scheduler failure", async () => {
    const deps = createMockDeps({
      scheduler: {
        scheduleDelayedCheck: vi.fn().mockRejectedValue(new Error("QStash down")),
      },
    });
    const res = await handleHvacEvent(makeRequest({ hvacId: "unit1", event: "on" }), deps);
    expect(res.status).toBe(500);
  });
});
