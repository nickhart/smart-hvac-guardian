import { describe, it, expect, vi, afterEach } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve, relative } from "node:path";
import { fetchWithTimeout, HttpTimeoutError } from "@/utils/http.js";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

afterEach(() => {
  vi.restoreAllMocks();
});

describe("fetchWithTimeout", () => {
  it("passes the response through when the call completes", async () => {
    const response = new Response("ok");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response));

    await expect(fetchWithTimeout("https://example.com", { method: "GET" }, 1000)).resolves.toBe(
      response,
    );
  });

  it("aborts the request rather than merely ignoring it", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("ok"));
    vi.stubGlobal("fetch", fetchMock);

    await fetchWithTimeout("https://example.com", { method: "POST" }, 1000);

    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect(init.signal).toBeInstanceOf(AbortSignal);
    expect(init.method).toBe("POST");
  });

  /**
   * The distinction that matters downstream: "the service was slow" and "the
   * service refused us" reach the circuit breaker and provider_events_v2
   * differently, and a DOMException named TimeoutError is otherwise
   * indistinguishable from a network error to anything matching on message.
   */
  it("reports a timeout as HttpTimeoutError", async () => {
    const timeout = new Error("The operation was aborted due to timeout");
    timeout.name = "TimeoutError";
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(timeout));

    await expect(fetchWithTimeout("https://example.com", {}, 250)).rejects.toThrow(
      HttpTimeoutError,
    );
    await expect(fetchWithTimeout("https://example.com", {}, 250)).rejects.toThrow(
      "timed out after 250ms",
    );
  });

  it("leaves other network failures alone", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("network unreachable")));

    await expect(fetchWithTimeout("https://example.com", {}, 1000)).rejects.toThrow(
      "network unreachable",
    );
    await expect(fetchWithTimeout("https://example.com", {}, 1000)).rejects.not.toBeInstanceOf(
      HttpTimeoutError,
    );
  });

  it("actually times out a call that never settles", async () => {
    // The real AbortSignal, not a stub: this is the behaviour being relied on.
    vi.stubGlobal(
      "fetch",
      vi.fn(
        (_url: string, init: RequestInit) =>
          new Promise((_resolve, reject) => {
            init.signal?.addEventListener("abort", () => {
              const error = new Error("aborted");
              error.name = "TimeoutError";
              reject(error);
            });
          }),
      ),
    );

    await expect(fetchWithTimeout("https://example.com", {}, 20)).rejects.toThrow(HttpTimeoutError);
  });
});

/**
 * `fetch` has no timeout of its own, and an unbounded call inside a handler
 * that has to return hangs it until the function times out — which QStash reads
 * as a failure and retries, firing a duplicate turn-off.
 *
 * The same omission has now been made in four separate clients, and it is
 * invisible in review: a call with no timeout looks exactly like one with a
 * timeout, only shorter. So the rule is mechanical — `src/utils/http.ts` is the
 * only place allowed to call `fetch` directly.
 */
describe("no unbounded fetch", () => {
  const allowed = resolve(repoRoot, "src/utils/http.ts");

  function collect(dir: string, found: string[] = []): string[] {
    for (const entry of readdirSync(dir)) {
      const full = resolve(dir, entry);
      if (statSync(full).isDirectory()) {
        collect(full, found);
      } else if (entry.endsWith(".ts") && !entry.endsWith(".test.ts")) {
        found.push(full);
      }
    }
    return found;
  }

  const sourceFiles = [
    ...collect(resolve(repoRoot, "src")),
    ...collect(resolve(repoRoot, "api")),
  ].filter((file) => file !== allowed);

  it("finds the source files to check", () => {
    expect(sourceFiles.length).toBeGreaterThan(20);
  });

  it.each(sourceFiles.map((f) => relative(repoRoot, f)))(
    "%s calls fetch only via the helper",
    (file) => {
      const source = readFileSync(resolve(repoRoot, file), "utf8");
      // `fetch(` not preceded by the helper's name or a word character.
      const bare = [...source.matchAll(/(?<![\w.])fetch\s*\(/g)];
      expect(bare).toEqual([]);
    },
  );
});
