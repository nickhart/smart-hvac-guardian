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
      use: {
        ...devices["Desktop Chrome"],
        // For environments with a preinstalled Chromium that doesn't match this
        // Playwright version. Unset, Playwright uses its own download.
        launchOptions: { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || undefined },
      },
    },
  ],
  webServer: {
    command: `pnpm exec vite --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: !process.env.CI,
  },
});
