import { describe, it, expect, vi, beforeEach } from "vitest";
import { withCircuitBreaker, DEFAULT_CIRCUIT_OPTIONS } from "@/utils/circuit-breaker";
import type { CircuitStore } from "@/utils/circuit-breaker";
import { CircuitOpenError, ProviderError, TerminalProviderError } from "@/utils/errors";
import type { Logger } from "@/utils/logger";

const logger: Logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };

function createStore(overrides?: Partial<CircuitStore>): CircuitStore {
  return {
    isCircuitOpen: vi.fn().mockResolvedValue(false),
    openCircuit: vi.fn().mockResolvedValue(undefined),
    recordCircuitFailure: vi.fn().mockResolvedValue(1),
    resetCircuit: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

describe("withCircuitBreaker", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns the result when the circuit is closed", async () => {
    const store = createStore();
    const result = await withCircuitBreaker(store, "ifttt", async () => "done", logger);

    expect(result).toBe("done");
    expect(store.recordCircuitFailure).not.toHaveBeenCalled();
  });

  it("skips the call entirely when the circuit is open", async () => {
    const store = createStore({ isCircuitOpen: vi.fn().mockResolvedValue(true) });
    const fn = vi.fn();

    await expect(withCircuitBreaker(store, "ifttt", fn, logger)).rejects.toBeInstanceOf(
      CircuitOpenError,
    );
    expect(fn).not.toHaveBeenCalled();
  });

  it("records a failure but leaves the circuit closed below the threshold", async () => {
    const store = createStore({ recordCircuitFailure: vi.fn().mockResolvedValue(2) });

    await expect(
      withCircuitBreaker(
        store,
        "ifttt",
        async () => {
          throw new ProviderError("IFTTT", "503");
        },
        logger,
      ),
    ).rejects.toThrow(ProviderError);

    expect(store.recordCircuitFailure).toHaveBeenCalledWith(
      "ifttt",
      DEFAULT_CIRCUIT_OPTIONS.windowSeconds,
    );
    expect(store.openCircuit).not.toHaveBeenCalled();
  });

  it("opens the circuit once the failure threshold is reached", async () => {
    const store = createStore({ recordCircuitFailure: vi.fn().mockResolvedValue(3) });

    await expect(
      withCircuitBreaker(
        store,
        "ifttt",
        async () => {
          throw new ProviderError("IFTTT", "503");
        },
        logger,
      ),
    ).rejects.toThrow(ProviderError);

    expect(store.openCircuit).toHaveBeenCalledWith(
      "ifttt",
      DEFAULT_CIRCUIT_OPTIONS.cooldownSeconds,
    );
  });

  it("opens the circuit immediately on a terminal failure", async () => {
    // A bad webhook key fails identically forever — no point counting to three.
    const store = createStore({ recordCircuitFailure: vi.fn().mockResolvedValue(1) });

    await expect(
      withCircuitBreaker(
        store,
        "ifttt",
        async () => {
          throw new TerminalProviderError("IFTTT", "401");
        },
        logger,
      ),
    ).rejects.toThrow(TerminalProviderError);

    expect(store.openCircuit).toHaveBeenCalled();
  });

  it("respects custom threshold and cooldown", async () => {
    const store = createStore({ recordCircuitFailure: vi.fn().mockResolvedValue(2) });

    await expect(
      withCircuitBreaker(
        store,
        "ifttt",
        async () => {
          throw new ProviderError("IFTTT", "503");
        },
        logger,
        { threshold: 2, cooldownSeconds: 30, windowSeconds: 60 },
      ),
    ).rejects.toThrow(ProviderError);

    expect(store.recordCircuitFailure).toHaveBeenCalledWith("ifttt", 60);
    expect(store.openCircuit).toHaveBeenCalledWith("ifttt", 30);
  });

  it("proceeds with the call when the circuit store is unreachable", async () => {
    // The breaker is a safety net, not a dependency: Redis being down must not
    // stop the HVAC from being turned off.
    const store = createStore({
      isCircuitOpen: vi.fn().mockRejectedValue(new Error("redis down")),
    });

    await expect(withCircuitBreaker(store, "ifttt", async () => "done", logger)).resolves.toBe(
      "done",
    );
  });

  it("still propagates the original error if recording the failure fails", async () => {
    const store = createStore({
      recordCircuitFailure: vi.fn().mockRejectedValue(new Error("redis down")),
    });

    await expect(
      withCircuitBreaker(
        store,
        "ifttt",
        async () => {
          throw new ProviderError("IFTTT", "503");
        },
        logger,
      ),
    ).rejects.toThrow(/503/);
  });
});
