import { createDevServer, type DevServer, type DevServerOptions } from "../server.js";

export type { DevServer };

let nextPort = 4100;

export async function startServer(opts?: Partial<DevServerOptions>): Promise<DevServer> {
  const port = nextPort++;
  return createDevServer({
    port,
    delayScale: 0.01,
    ...opts,
  });
}

export async function post(
  baseUrl: string,
  path: string,
  body: unknown,
): Promise<{ status: number; json: unknown }> {
  const res = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = await res.json();
  return { status: res.status, json };
}

export async function get(
  baseUrl: string,
  path: string,
): Promise<{ status: number; json: unknown }> {
  const res = await fetch(`${baseUrl}${path}`);
  const json = await res.json();
  return { status: res.status, json };
}

export async function waitForHvacState(
  server: DevServer,
  unitId: string,
  state: "on" | "off",
  timeout = 10_000,
): Promise<void> {
  await waitForCondition(() => {
    const states = server.hvacProvider.getUnitStates();
    return states.get(unitId) === state;
  }, timeout);
}

export async function waitForCondition(
  fn: () => boolean | Promise<boolean>,
  timeout = 10_000,
): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if (await fn()) return;
    await sleep(50);
  }
  throw new Error(`waitForCondition timed out after ${timeout}ms`);
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
