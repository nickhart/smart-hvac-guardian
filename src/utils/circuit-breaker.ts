import { CircuitOpenError, TerminalProviderError } from "./errors.js";
import type { Logger } from "./logger.js";

/**
 * Redis-backed circuit state. Implemented by RedisStateStore; kept as a narrow
 * interface so the breaker is testable without Redis.
 */
export interface CircuitStore {
  isCircuitOpen(name: string): Promise<boolean>;
  openCircuit(name: string, cooldownSeconds: number): Promise<void>;
  recordCircuitFailure(name: string, windowSeconds: number): Promise<number>;
  resetCircuit(name: string): Promise<void>;
}

export interface CircuitOptions {
  /** Consecutive failures within the window before the circuit opens. */
  threshold?: number;
  /** How long the circuit stays open, in seconds. */
  cooldownSeconds?: number;
  /** Rolling window the failure counter lives in, in seconds. */
  windowSeconds?: number;
}

export const DEFAULT_CIRCUIT_OPTIONS = {
  threshold: 3,
  cooldownSeconds: 600,
  windowSeconds: 900,
} as const;

/**
 * Run `fn` unless the named circuit is open, tripping it after repeated
 * failures. This exists to stop an outage in a downstream service (IFTTT, and
 * whatever it drives) from being amplified into a flood of retried calls, each
 * of which produces its own failure notification.
 *
 * A terminal failure trips the circuit immediately: if the webhook key is
 * wrong, the next 200 calls are wrong too.
 *
 * Redis problems never block the call — the breaker is a safety net, not a
 * dependency, so a store that throws degrades to calling `fn` directly.
 */
export async function withCircuitBreaker<T>(
  store: CircuitStore,
  name: string,
  fn: () => Promise<T>,
  logger?: Logger,
  options?: CircuitOptions,
): Promise<T> {
  const threshold = options?.threshold ?? DEFAULT_CIRCUIT_OPTIONS.threshold;
  const cooldownSeconds = options?.cooldownSeconds ?? DEFAULT_CIRCUIT_OPTIONS.cooldownSeconds;
  const windowSeconds = options?.windowSeconds ?? DEFAULT_CIRCUIT_OPTIONS.windowSeconds;

  let open = false;
  try {
    open = await store.isCircuitOpen(name);
  } catch (error) {
    logger?.warn("Circuit state unavailable — proceeding", {
      circuit: name,
      error: error instanceof Error ? error.message : String(error),
    });
  }

  if (open) {
    logger?.warn("Circuit open — skipping call", { circuit: name });
    throw new CircuitOpenError(name);
  }

  try {
    // A success deliberately does not clear the counter: the window TTL is what
    // expires it, so intermittent failures still accumulate toward the
    // threshold instead of being masked by the successes in between.
    return await fn();
  } catch (error) {
    const terminal = error instanceof TerminalProviderError;
    try {
      const failures = await store.recordCircuitFailure(name, windowSeconds);
      if (terminal || failures >= threshold) {
        await store.openCircuit(name, cooldownSeconds);
        logger?.error("Circuit opened", {
          circuit: name,
          failures,
          cooldownSeconds,
          reason: terminal ? "terminal_failure" : "threshold_reached",
        });
      }
    } catch (storeError) {
      logger?.warn("Could not record circuit failure", {
        circuit: name,
        error: storeError instanceof Error ? storeError.message : String(storeError),
      });
    }
    throw error;
  }
}
