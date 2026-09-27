import { defineConfig, devices } from "@playwright/test";

/**
 * Browser tests for the web app, run against the Vite dev server.
 *
 * Every `/api/*` request is answered by a fake backend in `e2e/fake-backend.ts`,
 * so no database, Redis, YoLink or IFTTT is involved — and nothing a test does
 * can reach a real HVAC unit.
 */
const PORT = 5199;

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "chromium",
      testIgnore: "sandbox.spec.ts",
      use: {
        ...devices["Desktop Chrome"],
        // For environments with a preinstalled Chromium that doesn't match this
        // Playwright version. Unset, Playwright uses its own download.
        launchOptions: { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || undefined },
      },
    },
    // `pnpm web:sandbox`: the app in a headed browser against the fake backend,
    // for clicking through by hand. Only defined when asked for.
    ...(process.env.WEB_SANDBOX
      ? [
          {
            name: "sandbox",
            testMatch: "sandbox.spec.ts",
            use: {
              browserName: "chromium" as const,
              headless: false,
              // A normal, resizable window rather than a fixed test viewport.
              viewport: null,
              launchOptions: {
                executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || undefined,
              },
            },
          },
        ]
      : []),
  ],
  webServer: {
    command: `pnpm exec vite --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: !process.env.CI,
  },
});
