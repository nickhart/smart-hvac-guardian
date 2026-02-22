import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { resetConfigCache, loadConfig } from "../src/config/loader.js";
import type { AppConfig } from "../src/config/schema.js";
import type { Dependencies } from "../src/handlers/dependencies.js";
import { createLogger } from "../src/utils/logger.js";

import { handleSensorEvent } from "../api/sensor-event.js";
import { handleHvacTurnOff } from "../api/hvac-turn-off.js";
import { handleHvacEvent } from "../api/hvac-event.js";
import { handleCheckState } from "../api/check-state.js";

import {
  DevEventBus,
  InMemoryStateStore,
  LocalScheduler,
  MockHVACProvider,
  MockSensorProvider,
  mockQStashReceiver,
} from "./providers.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DevServerOptions {
  envName?: string;
  delayScale?: number;
  port?: number;
  appConfigJson?: string; // Pass config directly (for E2E tests)
}

export interface DevServer {
  server: ReturnType<typeof createServer>;
  port: number;
  deps: Dependencies;
  hvacProvider: MockHVACProvider;
  scheduler: LocalScheduler;
  stateStore: InMemoryStateStore;
  eventBus: DevEventBus;
  config: AppConfig;
  close: () => Promise<void>;
}

// ---------------------------------------------------------------------------
// Env file loading
// ---------------------------------------------------------------------------

function loadEnvFile(envName: string): string | undefined {
  const envPath = join(process.cwd(), `.env.${envName}`);
  try {
    const content = readFileSync(envPath, "utf-8");
    for (const line of content.split("\n")) {
      const trimmed = line.trim();
      if (trimmed.startsWith("#") || !trimmed.includes("=")) continue;
      const eqIndex = trimmed.indexOf("=");
      const key = trimmed.slice(0, eqIndex).trim();
      const value = trimmed.slice(eqIndex + 1).trim();
      if (key === "APP_CONFIG" && value) {
        return value;
      }
    }
  } catch {
    // File doesn't exist — that's fine if appConfigJson is provided
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Request / Response conversion
// ---------------------------------------------------------------------------

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
  }
  return Buffer.concat(chunks).toString("utf-8");
}

function toWebRequest(
  req: IncomingMessage,
  body: string,
  baseUrl: string,
): Request {
  const url = new URL(req.url ?? "/", baseUrl);
  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    if (value) {
      headers.set(key, Array.isArray(value) ? value.join(", ") : value);
    }
  }
  const init: RequestInit = { method: req.method, headers };
  if (req.method !== "GET" && req.method !== "HEAD") {
    init.body = body;
  }
  return new Request(url.toString(), init);
}

async function sendWebResponse(
  res: ServerResponse,
  webRes: Response,
): Promise<void> {
  res.writeHead(webRes.status, Object.fromEntries(webRes.headers.entries()));
  const text = await webRes.text();
  res.end(text);
}

// ---------------------------------------------------------------------------
// createDevServer
// ---------------------------------------------------------------------------

export async function createDevServer(
  options: DevServerOptions = {},
): Promise<DevServer> {
  const {
    envName = "dev",
    delayScale = 1.0,
    port: requestedPort = 3000,
  } = options;

  // Load config
  resetConfigCache();
  let appConfigJson = options.appConfigJson;
  if (!appConfigJson) {
    appConfigJson = loadEnvFile(envName);
  }
  if (!appConfigJson) {
    throw new Error(
      `No APP_CONFIG found. Provide --env <name> pointing to .env.<name> or pass appConfigJson directly.`,
    );
  }

  const config = loadConfig(appConfigJson);

  // Override turnOffUrl to point at local server
  const baseUrl = `http://localhost:${requestedPort}`;
  (config as Record<string, unknown>).turnOffUrl = `${baseUrl}/api/hvac-turn-off`;

  const logger = createLogger("debug");
  const eventBus = new DevEventBus();

  const emit = (type: string, data: unknown) => eventBus.emit(type, data);

  const stateStore = new InMemoryStateStore(emit);
  const scheduler = new LocalScheduler({
    delayScale,
    baseUrl,
    onChange: emit,
  });
  const hvacProvider = new MockHVACProvider(config, emit);

  const deps: Dependencies = {
    sensor: new MockSensorProvider(),
    hvac: hvacProvider,
    scheduler,
    stateStore,
    qstashReceiver: mockQStashReceiver,
    config,
    logger,
  };

  // Dashboard HTML (loaded once)
  let dashboardHtml: string;
  try {
    dashboardHtml = readFileSync(join(__dirname, "ui", "index.html"), "utf-8");
  } catch {
    dashboardHtml = "<html><body><h1>Dashboard HTML not found</h1></body></html>";
  }

  // ---------------------------------------------------------------------------
  // HTTP Server
  // ---------------------------------------------------------------------------

  const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url ?? "/", baseUrl);
    const path = url.pathname;
    const method = req.method ?? "GET";

    try {
      // --- SSE stream ---
      if (path === "/api/events" && method === "GET") {
        eventBus.addClient(res);
        return;
      }

      // --- Dashboard ---
      if (path === "/" && method === "GET") {
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end(dashboardHtml);
        return;
      }

      // --- Dev state endpoint ---
      if (path === "/api/dev/state" && method === "GET") {
        const state = {
          sensors: Object.entries(config.sensorDelays).map(
            ([id, delay]) => ({
              id,
              delay,
              state: stateStore.getSensorSnapshot()[id] ?? "unknown",
              default: config.sensorDefaults[id] ?? null,
              type: getSensorType(id, config),
            }),
          ),
          hvacUnits: Object.entries(config.hvacUnits).map(
            ([id, unit]) => ({
              id,
              name: unit.name,
              iftttEvent: unit.iftttEvent,
              state: hvacProvider.getUnitStatesSnapshot()[id] ?? "unknown",
            }),
          ),
          pendingTimers: scheduler.getPendingTimers(),
          eventLog: hvacProvider.getEventLog(),
          config: {
            zones: Object.keys(config.zones),
            delayScale,
          },
        };
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(state));
        return;
      }

      // --- Dev HVAC toggle ---
      if (path === "/api/dev/hvac-toggle" && method === "POST") {
        const body = await readBody(req);
        const { unitId, state } = JSON.parse(body) as {
          unitId: string;
          state: "on" | "off";
        };
        hvacProvider.setUnitState(unitId, state);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ status: "ok", unitId, state }));
        return;
      }

      // --- Handler routes ---
      const body = await readBody(req);
      const webReq = toWebRequest(req, body, baseUrl);

      if (path === "/api/sensor-event" && method === "POST") {
        const webRes = await handleSensorEvent(webReq, deps);
        await sendWebResponse(res, webRes);
        return;
      }

      if (path === "/api/hvac-turn-off" && method === "POST") {
        const webRes = await handleHvacTurnOff(webReq, deps);
        await sendWebResponse(res, webRes);
        return;
      }

      if (path === "/api/hvac-event" && method === "POST") {
        const webRes = await handleHvacEvent(webReq, deps);
        await sendWebResponse(res, webRes);
        return;
      }

      if (path === "/api/check-state" && method === "GET") {
        const webRes = await handleCheckState(webReq, deps);
        await sendWebResponse(res, webRes);
        return;
      }

      // 404
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Not found" }));
    } catch (err) {
      console.error("[DevServer] Request error:", err);
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Internal server error" }));
    }
  });

  // Start listening
  await new Promise<void>((resolve) => {
    server.listen(requestedPort, () => resolve());
  });

  const actualPort = (server.address() as { port: number }).port;

  return {
    server,
    port: actualPort,
    deps,
    hvacProvider,
    scheduler,
    stateStore,
    eventBus,
    config,
    close: async () => {
      scheduler.cancelAll();
      stateStore.destroy();
      eventBus.closeAll();
      await new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      });
      resetConfigCache();
    },
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getSensorType(
  sensorId: string,
  config: AppConfig,
): "exterior" | "interior" | "unknown" {
  for (const zone of Object.values(config.zones)) {
    if (zone.exteriorOpenings.includes(sensorId)) return "exterior";
    if (zone.interiorDoors.some((d) => d.id === sensorId)) return "interior";
  }
  return "unknown";
}

// ---------------------------------------------------------------------------
// CLI entrypoint
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  let envName = "dev";
  let delayScale = 1.0;
  let port = 3000;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--env" && args[i + 1]) {
      envName = args[++i];
    } else if (args[i] === "--delay-scale" && args[i + 1]) {
      delayScale = parseFloat(args[++i]);
    } else if (args[i] === "--port" && args[i + 1]) {
      port = parseInt(args[++i], 10);
    }
  }

  const dev = await createDevServer({ envName, delayScale, port });

  console.log("\n=== Smart HVAC Guardian — Dev Server ===\n");
  console.log(`  Env:          .env.${envName}`);
  console.log(`  Delay scale:  ${delayScale}x`);
  console.log(`  Zones:        ${Object.keys(dev.config.zones).join(", ")}`);
  console.log(
    `  Sensors:      ${Object.keys(dev.config.sensorDelays).join(", ")}`,
  );
  console.log(
    `  HVAC units:   ${Object.entries(dev.config.hvacUnits).map(([id, u]) => `${id} (${u.name})`).join(", ")}`,
  );
  console.log(`\n  Dashboard:    http://localhost:${dev.port}/`);
  console.log(`  API base:     http://localhost:${dev.port}/api`);
  console.log(`\n  Press Ctrl+C to stop.\n`);

  process.on("SIGINT", async () => {
    console.log("\nShutting down...");
    await dev.close();
    process.exit(0);
  });

  process.on("SIGTERM", async () => {
    await dev.close();
    process.exit(0);
  });
}

// Run CLI if this is the entrypoint
const isMain =
  process.argv[1] &&
  (process.argv[1].endsWith("/dev/server.ts") ||
    process.argv[1].endsWith("/dev/server.js"));
if (isMain) {
  main().catch((err) => {
    console.error("Failed to start dev server:", err);
    process.exit(1);
  });
}
