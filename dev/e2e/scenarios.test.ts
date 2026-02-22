import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { startServer, post, get, waitForHvacState, sleep, type DevServer } from "./helpers.js";

/*
 * Test config: 2 zones (living_room + bedroom) with an interior door.
 * Delays are short (5s) so with delayScale=0.01 they fire in ~50ms.
 */
const TEST_CONFIG = JSON.stringify({
  zones: {
    living_room: {
      minisplits: ["ac_living"],
      exteriorOpenings: ["front_door", "balcony_door"],
      interiorDoors: [{ id: "door_bedroom", connectsTo: "bedroom" }],
    },
    bedroom: {
      minisplits: ["ac_bedroom"],
      exteriorOpenings: ["bedroom_window"],
      interiorDoors: [{ id: "door_bedroom", connectsTo: "living_room" }],
    },
  },
  sensorDelays: {
    front_door: 5,
    balcony_door: 8,
    bedroom_window: 5,
    door_bedroom: 0,
  },
  sensorDefaults: {},
  hvacUnits: {
    ac_living: {
      name: "Living Room AC",
      iftttEvent: "turn_off_ac_living",
    },
    ac_bedroom: {
      name: "Bedroom AC",
      iftttEvent: "turn_off_ac_bedroom",
    },
  },
  yolink: { baseUrl: "https://api.yosmart.com/open/yolink/v2/api" },
  turnOffUrl: "http://localhost:3000/api/hvac-turn-off", // overridden by server
});

describe("E2E scenarios", () => {
  let server: DevServer;
  let base: string;

  beforeEach(async () => {
    server = await startServer({ appConfigJson: TEST_CONFIG });
    base = `http://localhost:${server.port}`;
  });

  afterEach(async () => {
    await server.close();
  });

  // Scenario 1: Open exterior sensor -> wait -> HVAC off
  it("turns off HVAC after exterior sensor opens and timer fires", async () => {
    const res = await post(base, "/api/sensor-event", {
      sensorId: "front_door",
      event: "open",
    });
    expect(res.status).toBe(200);
    expect((res.json as Record<string, unknown>).scheduled).toEqual(["ac_living"]);

    // Wait for timer to fire (5s * 0.01 = 50ms, give generous margin)
    await waitForHvacState(server, "ac_living", "off", 5_000);
    expect(server.hvacProvider.getUnitStates().get("ac_living")).toBe("off");
  });

  // Scenario 2: Open then close before timer -> HVAC stays on
  it("cancels timer when sensor closes before it fires", async () => {
    // Open
    await post(base, "/api/sensor-event", {
      sensorId: "front_door",
      event: "open",
    });

    // Immediately close (timer hasn't fired yet at 0.01x scale)
    await post(base, "/api/sensor-event", {
      sensorId: "front_door",
      event: "close",
    });

    // Wait a bit to ensure timer would have fired
    await sleep(500);

    // HVAC should still be on
    expect(server.hvacProvider.getUnitStates().get("ac_living")).toBe("on");
  });

  // Scenario 3: Interior door open propagates exposure
  it("schedules turn-off for both zones when interior door is open", async () => {
    // Open interior door first
    await post(base, "/api/sensor-event", {
      sensorId: "door_bedroom",
      event: "open",
    });

    // Open exterior sensor in living room
    const res = await post(base, "/api/sensor-event", {
      sensorId: "front_door",
      event: "open",
    });
    const body = res.json as Record<string, unknown>;
    const scheduled = (body.scheduled as string[]).sort();

    // Both units should be scheduled
    expect(scheduled).toEqual(["ac_bedroom", "ac_living"]);

    // Wait for both to turn off
    await waitForHvacState(server, "ac_living", "off", 5_000);
    await waitForHvacState(server, "ac_bedroom", "off", 5_000);
  });

  // Scenario 4: HVAC turned back on while exposed -> new timer -> turns off again
  it("re-schedules turn-off when HVAC is turned on while exposed", async () => {
    // Open sensor -> HVAC turns off
    await post(base, "/api/sensor-event", {
      sensorId: "front_door",
      event: "open",
    });
    await waitForHvacState(server, "ac_living", "off", 5_000);

    // Simulate user turning HVAC back on
    server.hvacProvider.setUnitState("ac_living", "on");
    const res = await post(base, "/api/hvac-event", {
      hvacId: "ac_living",
      event: "on",
    });
    expect((res.json as Record<string, unknown>).action).toBe("scheduled");

    // Should turn off again
    await waitForHvacState(server, "ac_living", "off", 5_000);
  });

  // Scenario 5: Rapid duplicate events (dedup)
  it("deduplicates rapid identical sensor events", async () => {
    // Send two rapid open events
    await post(base, "/api/sensor-event", {
      sensorId: "front_door",
      event: "open",
    });
    await post(base, "/api/sensor-event", {
      sensorId: "front_door",
      event: "open",
    });

    // Only one pending timer should exist
    const timers = server.scheduler.getPendingTimers();
    const livingTimers = timers.filter((t) => t.hvacUnitId === "ac_living");
    expect(livingTimers.length).toBe(1);
  });

  // Scenario 6: check-state endpoint
  it("returns correct state from check-state", async () => {
    // Open a sensor first
    await post(base, "/api/sensor-event", {
      sensorId: "front_door",
      event: "open",
    });

    const res = await get(base, "/api/check-state");
    expect(res.status).toBe(200);
    const body = res.json as Record<string, unknown>;

    expect(body.status).toBe("ok");
    const sensorStates = body.sensorStates as Record<string, string>;
    expect(sensorStates.front_door).toBe("open");

    const exposed = body.exposedUnits as string[];
    expect(exposed).toContain("ac_living");

    const activeTimers = body.activeTimers as string[];
    expect(activeTimers).toContain("ac_living");
  });

  // Scenario 7: Token mismatch (stale timer)
  it("rejects turn-off with stale cancellation token", async () => {
    // Open sensor -> timer scheduled with token A
    await post(base, "/api/sensor-event", {
      sensorId: "front_door",
      event: "open",
    });

    // Get current token
    const tokenA = await server.stateStore.getTimerToken("ac_living");
    expect(tokenA).toBeTruthy();

    // Close and re-open to get new token B
    await post(base, "/api/sensor-event", {
      sensorId: "front_door",
      event: "close",
    });
    await post(base, "/api/sensor-event", {
      sensorId: "front_door",
      event: "open",
    });

    const tokenB = await server.stateStore.getTimerToken("ac_living");
    expect(tokenB).toBeTruthy();
    expect(tokenB).not.toBe(tokenA);

    // Manually send turn-off with old token A -> should be rejected
    const res = await post(base, "/api/hvac-turn-off", {
      hvacUnitId: "ac_living",
      cancellationToken: tokenA,
    });
    expect((res.json as Record<string, unknown>).action).toBe("cancelled");

    // HVAC should still be on (old token rejected)
    expect(server.hvacProvider.getUnitStates().get("ac_living")).toBe("on");

    // Wait for new timer to fire with token B -> HVAC off
    await waitForHvacState(server, "ac_living", "off", 5_000);
  });
});
