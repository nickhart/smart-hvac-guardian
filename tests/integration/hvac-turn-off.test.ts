import { describe, it, expect, vi } from "vitest";
import { handleHvacTurnOff } from "../../api/hvac-turn-off";
import type { Dependencies } from "@/handlers/dependencies";
import type { Logger } from "@/utils/logger";
import { CircuitOpenError, ProviderError, TerminalProviderError } from "@/utils/errors";

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
    scheduler: {
      scheduleDelayedCheck: vi.fn(),
      scheduleTurnOff: vi.fn(),
      scheduleUnitTurnOff: vi.fn(),
    },
    stateStore: {
      setSensorState: vi.fn().mockResolvedValue(undefined),
      getAllSensorStates: vi.fn().mockResolvedValue(new Map([["front_door", "open"]])),
      setTimerToken: vi.fn(),
      getTimerToken: vi.fn().mockResolvedValue("valid-token"),
      deleteTimerToken: vi.fn().mockResolvedValue(undefined),
      getActiveTimerUnitIds: vi.fn(),
      getSystemEnabled: vi.fn().mockResolvedValue(true),
      setSystemEnabled: vi.fn(),
      getUnitDelay: vi.fn().mockResolvedValue(null),
      setUnitDelay: vi.fn(),
      isCircuitOpen: vi.fn().mockResolvedValue(false),
      openCircuit: vi.fn().mockResolvedValue(undefined),
      recordCircuitFailure: vi.fn().mockResolvedValue(1),
      resetCircuit: vi.fn().mockResolvedValue(undefined),
    },
    analytics: {
      trackSensorEvent: vi.fn().mockResolvedValue(undefined),
      trackHvacCommand: vi.fn().mockResolvedValue(undefined),
      trackHvacStateEvent: vi.fn().mockResolvedValue(undefined),
      trackProviderEvent: vi.fn().mockResolvedValue(undefined),
      trackSensorStateDrift: vi.fn().mockResolvedValue(undefined),
    },
    qstashReceiver: { verify: vi.fn().mockResolvedValue(true) } as never,
    config: {
      zones: {
        living_room: {
          minisplits: ["ac_living"],
          exteriorOpenings: ["front_door"],
          interiorDoors: [],
        },
      },
      sensorDelays: { front_door: 90 },
      hvacUnits: {
        ac_living: { name: "Living Room AC", iftttEvent: "turn_off_ac_living", delaySeconds: 90 },
      },
      sensorNames: {},
      sensorDefaults: {},
      yolink: { baseUrl: "https://api.yosmart.com/open/yolink/v2/api" },
      turnOffUrl: "https://example.com/api/hvac-turn-off",
    },
    logger: mockLogger,
    ...overrides,
  };
}

function makeRequest(body: unknown, signature = "valid-sig"): Request {
  return new Request("https://example.com/api/hvac-turn-off", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "upstash-signature": signature,
    },
    body: JSON.stringify(body),
  });
}

describe("hvac-turn-off handler", () => {
  it("returns 405 for non-POST", async () => {
    const req = new Request("https://example.com/api/hvac-turn-off", { method: "GET" });
    const res = await handleHvacTurnOff(req, createMockDeps());
    expect(res.status).toBe(405);
  });

  it("returns 401 for invalid QStash signature", async () => {
    const deps = createMockDeps({
      qstashReceiver: {
        verify: vi.fn().mockRejectedValue(new Error("bad sig")),
      } as never,
    });

    const res = await handleHvacTurnOff(
      makeRequest({ hvacUnitId: "ac_living", cancellationToken: "token123" }),
      deps,
    );
    expect(res.status).toBe(401);
  });

  it("returns 400 for invalid payload", async () => {
    const deps = createMockDeps();
    const res = await handleHvacTurnOff(makeRequest({ bad: "data" }), deps);
    expect(res.status).toBe(400);
  });

  it("turns off unit when cancellation token matches", async () => {
    const deps = createMockDeps({
      stateStore: {
        setSensorState: vi.fn(),
        getAllSensorStates: vi.fn().mockResolvedValue(new Map([["front_door", "open"]])),
        setTimerToken: vi.fn(),
        getTimerToken: vi.fn().mockResolvedValue("valid-token"),
        deleteTimerToken: vi.fn().mockResolvedValue(undefined),
        getActiveTimerUnitIds: vi.fn(),
        getSystemEnabled: vi.fn().mockResolvedValue(true),
        setSystemEnabled: vi.fn(),
        getUnitDelay: vi.fn().mockResolvedValue(null),
        setUnitDelay: vi.fn(),
        isCircuitOpen: vi.fn().mockResolvedValue(false),
        openCircuit: vi.fn().mockResolvedValue(undefined),
        recordCircuitFailure: vi.fn().mockResolvedValue(1),
        resetCircuit: vi.fn().mockResolvedValue(undefined),
      },
    });

    const res = await handleHvacTurnOff(
      makeRequest({ hvacUnitId: "ac_living", cancellationToken: "valid-token" }),
      deps,
    );
    const body = (await res.json()) as Record<string, unknown>;

    expect(res.status).toBe(200);
    expect(body.action).toBe("turned_off");
    expect(body.hvacUnitId).toBe("ac_living");
    expect(deps.hvac.turnOff).toHaveBeenCalledWith("turn_off_ac_living");
    expect(deps.stateStore.deleteTimerToken).toHaveBeenCalledWith("ac_living");
  });

  it("skips turn-off when token is missing (cancelled)", async () => {
    const deps = createMockDeps({
      stateStore: {
        setSensorState: vi.fn(),
        getAllSensorStates: vi.fn().mockResolvedValue(new Map([["front_door", "open"]])),
        setTimerToken: vi.fn(),
        getTimerToken: vi.fn().mockResolvedValue(null),
        deleteTimerToken: vi.fn(),
        getActiveTimerUnitIds: vi.fn(),
        getSystemEnabled: vi.fn().mockResolvedValue(true),
        setSystemEnabled: vi.fn(),
        getUnitDelay: vi.fn().mockResolvedValue(null),
        setUnitDelay: vi.fn(),
        isCircuitOpen: vi.fn().mockResolvedValue(false),
        openCircuit: vi.fn().mockResolvedValue(undefined),
        recordCircuitFailure: vi.fn().mockResolvedValue(1),
        resetCircuit: vi.fn().mockResolvedValue(undefined),
      },
    });

    const res = await handleHvacTurnOff(
      makeRequest({ hvacUnitId: "ac_living", cancellationToken: "stale-token" }),
      deps,
    );
    const body = (await res.json()) as Record<string, unknown>;

    expect(res.status).toBe(200);
    expect(body.action).toBe("cancelled");
    expect(deps.hvac.turnOff).not.toHaveBeenCalled();
  });

  it("skips turn-off when token mismatches", async () => {
    const deps = createMockDeps({
      stateStore: {
        setSensorState: vi.fn(),
        getAllSensorStates: vi.fn().mockResolvedValue(new Map([["front_door", "open"]])),
        setTimerToken: vi.fn(),
        getTimerToken: vi.fn().mockResolvedValue("new-token"),
        deleteTimerToken: vi.fn(),
        getActiveTimerUnitIds: vi.fn(),
        getSystemEnabled: vi.fn().mockResolvedValue(true),
        setSystemEnabled: vi.fn(),
        getUnitDelay: vi.fn().mockResolvedValue(null),
        setUnitDelay: vi.fn(),
        isCircuitOpen: vi.fn().mockResolvedValue(false),
        openCircuit: vi.fn().mockResolvedValue(undefined),
        recordCircuitFailure: vi.fn().mockResolvedValue(1),
        resetCircuit: vi.fn().mockResolvedValue(undefined),
      },
    });

    const res = await handleHvacTurnOff(
      makeRequest({ hvacUnitId: "ac_living", cancellationToken: "old-token" }),
      deps,
    );
    const body = (await res.json()) as Record<string, unknown>;

    expect(res.status).toBe(200);
    expect(body.action).toBe("cancelled");
    expect(deps.hvac.turnOff).not.toHaveBeenCalled();
  });

  it("skips turn-off when system is disabled (valid token)", async () => {
    const deps = createMockDeps({
      stateStore: {
        setSensorState: vi.fn(),
        getAllSensorStates: vi.fn().mockResolvedValue(new Map([["front_door", "open"]])),
        setTimerToken: vi.fn(),
        getTimerToken: vi.fn().mockResolvedValue("valid-token"),
        deleteTimerToken: vi.fn().mockResolvedValue(undefined),
        getActiveTimerUnitIds: vi.fn(),
        getSystemEnabled: vi.fn().mockResolvedValue(false),
        setSystemEnabled: vi.fn(),
        getUnitDelay: vi.fn().mockResolvedValue(null),
        setUnitDelay: vi.fn(),
        isCircuitOpen: vi.fn().mockResolvedValue(false),
        openCircuit: vi.fn().mockResolvedValue(undefined),
        recordCircuitFailure: vi.fn().mockResolvedValue(1),
        resetCircuit: vi.fn().mockResolvedValue(undefined),
      },
    });

    const res = await handleHvacTurnOff(
      makeRequest({ hvacUnitId: "ac_living", cancellationToken: "valid-token" }),
      deps,
    );
    const body = (await res.json()) as Record<string, unknown>;

    expect(res.status).toBe(200);
    expect(body.action).toBe("not_executed");
    expect(body.reason).toBe("system_disabled");
    expect(deps.hvac.turnOff).not.toHaveBeenCalled();
    expect(deps.stateStore.deleteTimerToken).toHaveBeenCalledWith("ac_living");

    // Shadow mode: the decision is recorded as a turn-off that was not
    // executed, rather than discarded as a cancellation.
    expect(deps.analytics.trackHvacCommand).toHaveBeenCalledWith(
      expect.objectContaining({
        hvacUnitId: "ac_living",
        action: "turned_off",
        shutoffEnabled: false,
      }),
    );
  });

  it("returns 404 for unknown HVAC unit (with valid token)", async () => {
    const deps = createMockDeps({
      stateStore: {
        setSensorState: vi.fn(),
        getAllSensorStates: vi.fn().mockResolvedValue(new Map([["front_door", "open"]])),
        setTimerToken: vi.fn(),
        getTimerToken: vi.fn().mockResolvedValue("token123"),
        deleteTimerToken: vi.fn(),
        getActiveTimerUnitIds: vi.fn(),
        getSystemEnabled: vi.fn().mockResolvedValue(true),
        setSystemEnabled: vi.fn(),
        getUnitDelay: vi.fn().mockResolvedValue(null),
        setUnitDelay: vi.fn(),
        isCircuitOpen: vi.fn().mockResolvedValue(false),
        openCircuit: vi.fn().mockResolvedValue(undefined),
        recordCircuitFailure: vi.fn().mockResolvedValue(1),
        resetCircuit: vi.fn().mockResolvedValue(undefined),
      },
    });

    const res = await handleHvacTurnOff(
      makeRequest({ hvacUnitId: "nonexistent", cancellationToken: "token123" }),
      deps,
    );
    expect(res.status).toBe(404);
  });
});

/**
 * The most expensive way this system can be wrong: shutting off a guest's AC
 * because a close webhook never arrived, for a door that has been shut the
 * whole time. From inside the system that decision looks perfectly correct —
 * the timer fired, the token matched — so only the device can contradict it.
 */
/**
 * `shutoff_enabled` is the one field separating a dry run from real operation.
 * The cancellation branch returns before the rest of the handler runs, and it
 * used to hardcode `true` — so every cancelled row claimed the system was live,
 * including ones recorded while it was disabled. A third of all commands are
 * cancellations, so that quietly corrupted the comparison.
 */
describe("hvac-turn-off records the real system state on a cancellation", () => {
  function depsWithSystem(enabled: boolean) {
    return createMockDeps({
      stateStore: {
        ...createMockDeps().stateStore,
        // Token gone: the door closed, so the timer is cancelled.
        getTimerToken: vi.fn().mockResolvedValue(null),
        getSystemEnabled: vi.fn().mockResolvedValue(enabled),
      },
    });
  }

  it("reports a disabled system as disabled", async () => {
    const deps = depsWithSystem(false);

    const res = await handleHvacTurnOff(
      makeRequest({ hvacUnitId: "ac_living", cancellationToken: "stale-token" }),
      deps,
    );
    const body = (await res.json()) as { action: string };

    expect(body.action).toBe("cancelled");
    expect(deps.analytics.trackHvacCommand).toHaveBeenCalledWith(
      expect.objectContaining({ action: "cancelled", shutoffEnabled: false }),
    );
  });

  it("reports an enabled system as enabled", async () => {
    const deps = depsWithSystem(true);

    await handleHvacTurnOff(
      makeRequest({ hvacUnitId: "ac_living", cancellationToken: "stale-token" }),
      deps,
    );

    expect(deps.analytics.trackHvacCommand).toHaveBeenCalledWith(
      expect.objectContaining({ action: "cancelled", shutoffEnabled: true }),
    );
  });
});

describe("hvac-turn-off exposure verification", () => {
  it("does not touch IFTTT when the door is really closed", async () => {
    const deps = createMockDeps({
      sensor: { getState: vi.fn().mockResolvedValue("closed") },
    });

    const res = await handleHvacTurnOff(
      makeRequest({ hvacUnitId: "ac_living", cancellationToken: "valid-token" }),
      deps,
    );
    const body = (await res.json()) as { action: string };

    expect(res.status).toBe(200);
    expect(body.action).toBe("aborted_stale_state");
    expect(deps.hvac.turnOff).not.toHaveBeenCalled();
  });

  it("records the abort as its own action, not as a cancellation", async () => {
    const deps = createMockDeps({
      sensor: { getState: vi.fn().mockResolvedValue("closed") },
    });

    await handleHvacTurnOff(
      makeRequest({ hvacUnitId: "ac_living", cancellationToken: "valid-token" }),
      deps,
    );

    expect(deps.analytics.trackHvacCommand).toHaveBeenCalledWith(
      expect.objectContaining({ action: "aborted_stale_state", hvacUnitId: "ac_living" }),
    );
  });

  it("releases the timer token so the unit is not left blocked", async () => {
    const deps = createMockDeps({
      sensor: { getState: vi.fn().mockResolvedValue("closed") },
    });

    await handleHvacTurnOff(
      makeRequest({ hvacUnitId: "ac_living", cancellationToken: "valid-token" }),
      deps,
    );

    expect(deps.stateStore.deleteTimerToken).toHaveBeenCalledWith("ac_living");
  });

  // Fails open: a YoLink outage must not silently disable every shutoff.
  it("still turns off when the device cannot be reached", async () => {
    const deps = createMockDeps({
      sensor: { getState: vi.fn().mockRejectedValue(new Error("YoLink down")) },
    });

    const res = await handleHvacTurnOff(
      makeRequest({ hvacUnitId: "ac_living", cancellationToken: "valid-token" }),
      deps,
    );
    const body = (await res.json()) as { action: string };

    expect(body.action).toBe("turned_off");
    expect(deps.hvac.turnOff).toHaveBeenCalledWith("turn_off_ac_living");
  });

  /**
   * Runs before the shadow-mode gate, so a disabled system still records
   * whether the shutoff it decided on would have been justified — which is the
   * whole point of watching it before trusting it.
   */
  it("verifies even while the system is disabled", async () => {
    const deps = createMockDeps({
      sensor: { getState: vi.fn().mockResolvedValue("closed") },
      stateStore: {
        ...createMockDeps().stateStore,
        getSystemEnabled: vi.fn().mockResolvedValue(false),
      },
    });

    const res = await handleHvacTurnOff(
      makeRequest({ hvacUnitId: "ac_living", cancellationToken: "valid-token" }),
      deps,
    );
    const body = (await res.json()) as { action: string };

    expect(body.action).toBe("aborted_stale_state");
    expect(deps.analytics.trackHvacCommand).toHaveBeenCalledWith(
      expect.objectContaining({ action: "aborted_stale_state", shutoffEnabled: false }),
    );
  });
});

describe("hvac-turn-off retry suppression", () => {
  function validTokenStore() {
    return {
      setSensorState: vi.fn(),
      getAllSensorStates: vi.fn().mockResolvedValue(new Map([["front_door", "open"]])),
      setTimerToken: vi.fn(),
      getTimerToken: vi.fn().mockResolvedValue("valid-token"),
      deleteTimerToken: vi.fn().mockResolvedValue(undefined),
      getActiveTimerUnitIds: vi.fn(),
      getSystemEnabled: vi.fn().mockResolvedValue(true),
      setSystemEnabled: vi.fn(),
      getUnitDelay: vi.fn().mockResolvedValue(null),
      setUnitDelay: vi.fn(),
      isCircuitOpen: vi.fn().mockResolvedValue(false),
      openCircuit: vi.fn().mockResolvedValue(undefined),
      recordCircuitFailure: vi.fn().mockResolvedValue(1),
      resetCircuit: vi.fn().mockResolvedValue(undefined),
    };
  }

  // QStash retries any non-2xx, and each retry is another IFTTT invocation —
  // and another failure notification. Failures that cannot succeed on retry
  // must be acknowledged with a 200.
  it("returns 200 when the provider circuit is open", async () => {
    const deps = createMockDeps({
      stateStore: validTokenStore(),
      hvac: { turnOff: vi.fn().mockRejectedValue(new CircuitOpenError("ifttt")) },
    });

    const res = await handleHvacTurnOff(
      makeRequest({ hvacUnitId: "ac_living", cancellationToken: "valid-token" }),
      deps,
    );
    const body = (await res.json()) as Record<string, unknown>;

    expect(res.status).toBe(200);
    expect(body.reason).toBe("circuit_open");
  });

  it("returns 200 on a terminal provider failure", async () => {
    const deps = createMockDeps({
      stateStore: validTokenStore(),
      hvac: {
        turnOff: vi.fn().mockRejectedValue(new TerminalProviderError("IFTTT", "401 bad key")),
      },
    });

    const res = await handleHvacTurnOff(
      makeRequest({ hvacUnitId: "ac_living", cancellationToken: "valid-token" }),
      deps,
    );
    const body = (await res.json()) as Record<string, unknown>;

    expect(res.status).toBe(200);
    expect(body.reason).toBe("terminal_provider_error");
  });

  it("still returns 500 for a retryable failure so QStash retries", async () => {
    const deps = createMockDeps({
      stateStore: validTokenStore(),
      hvac: { turnOff: vi.fn().mockRejectedValue(new ProviderError("IFTTT", "503 upstream")) },
    });

    const res = await handleHvacTurnOff(
      makeRequest({ hvacUnitId: "ac_living", cancellationToken: "valid-token" }),
      deps,
    );

    expect(res.status).toBe(500);
  });

  it("awaits analytics before responding so the event is not dropped", async () => {
    // A floating promise can be cut off when an edge function returns.
    let settled = false;
    const deps = createMockDeps({
      stateStore: validTokenStore(),
      analytics: {
        trackSensorEvent: vi.fn().mockResolvedValue(undefined),
        trackHvacCommand: vi.fn().mockImplementation(async () => {
          await new Promise((r) => setTimeout(r, 5));
          settled = true;
        }),
        trackHvacStateEvent: vi.fn().mockResolvedValue(undefined),
        trackProviderEvent: vi.fn().mockResolvedValue(undefined),
        trackSensorStateDrift: vi.fn().mockResolvedValue(undefined),
      },
    });

    await handleHvacTurnOff(
      makeRequest({ hvacUnitId: "ac_living", cancellationToken: "valid-token" }),
      deps,
    );

    expect(settled).toBe(true);
  });
});
