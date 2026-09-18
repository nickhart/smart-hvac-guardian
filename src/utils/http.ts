/**
 * Bounded HTTP.
 *
 * Every outbound call in this app runs inside a request that has to return.
 * `fetch` has no timeout of its own, so an external service that stops
 * answering — rather than failing — hangs the handler until the function times
 * out. On the control path that is expensive: QStash reads the timeout as a
 * failure and retries, firing a duplicate turn-off.
 *
 * Worse, a hang is invisible to the circuit breaker. Failures are recorded in a
 * `catch`, and a hang never throws — the function dies instead. So a slow
 * provider can never trip the breaker, and every request pays the full timeout.
 * Bounding the call is what lets the breaker see a brownout at all: a timeout
 * throws, which records a failure, which opens the circuit.
 *
 * This is the only place in `src/` and `api/` allowed to call `fetch` directly;
 * a test enforces that.
 */

/** Raised when a request exceeded its budget, rather than failing on its own. */
export class HttpTimeoutError extends Error {
  readonly timeoutMs: number;

  constructor(timeoutMs: number) {
    super(`timed out after ${timeoutMs}ms`);
    this.name = "HttpTimeoutError";
    this.timeoutMs = timeoutMs;
  }
}

/**
 * `fetch` with a deadline. Unlike racing a promise, this aborts the underlying
 * request rather than just ignoring it.
 *
 * Note this sets `signal` on the request, so it does not compose with a caller
 * supplying one — no caller does today, and the guard test keeps `fetch` calls
 * routed through here where that stays visible.
 */
export async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  try {
    return await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
  } catch (error) {
    // AbortSignal.timeout rejects with a DOMException named TimeoutError, which
    // is indistinguishable from a network error to a caller matching on
    // message. Naming it keeps "the service was slow" separate from "the
    // service refused us" in logs and in provider_events_v2.
    if (error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError")) {
      throw new HttpTimeoutError(timeoutMs);
    }
    throw error;
  }
}
