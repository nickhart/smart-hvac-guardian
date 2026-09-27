import { test } from "@playwright/test";
import { FakeBackend } from "./fake-backend";

/**
 * Not a test — a way to click through the app by hand against the fake
 * backend. Run with `pnpm web:sandbox`; it only exists in the `sandbox`
 * project, which the config adds only when WEB_SANDBOX is set, so CI and
 * `pnpm web:test` never see it.
 *
 * The browser opens on a fresh tenant in onboarding. Nothing reaches YoLink or
 * IFTTT: "Test credentials", "Auto-discover" and "Test" all answer from the
 * fake. Close the Playwright Inspector window (or press Resume) to finish.
 */
test("walk through the app by hand", async ({ page }) => {
  test.setTimeout(0);
  await FakeBackend.attach(page);
  await page.goto("/");
  await page.pause();
});
