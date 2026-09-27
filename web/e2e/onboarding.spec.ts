import { test, expect, type Page } from "@playwright/test";
import { FakeBackend, APP_URL, TENANT_ID, WEBHOOK_SECRET } from "./fake-backend";
import type { OnboardingStepData } from "../../src/onboarding/assemble-config.js";

/**
 * The setup wizard, driven through a real browser against a fake backend.
 *
 * What matters is what the wizard *sends*: the answers saved at each step are
 * what activation turns into the tenant's config. So besides what's on screen,
 * these tests assert the saved payloads, and every test ends by checking the
 * app made no request the fake backend doesn't know about.
 */

let backend: FakeBackend;

test.afterEach(() => {
  expect(backend.unexpected, "requests the fake backend had no answer for").toEqual([]);
});

const next = (page: Page) => page.getByRole("button", { name: "Next" }).click();

async function expectStep(page: Page, step: number, title: string) {
  await expect(page.getByText(`Step ${step} of 9`)).toBeVisible();
  await expect(page.getByRole("heading", { level: 2 })).toContainText(title);
}

/** The answers a wizard run saves up to and including step 7. */
const throughTestApplets: OnboardingStepData = {
  "1": { completed: true },
  "2": { uaCid: "ua_test", secretKey: "sk_test" },
  "3": {
    sensorDelays: { d_front: 120, d_hall: 60 },
    sensorNames: { d_front: "Front Door", d_hall: "Hallway Door" },
    sensorDefaults: {},
  },
  "4": {
    hvacUnits: {
      living_ac: { name: "Living AC", iftttEvent: "turn_off_living_ac", delaySeconds: 300 },
    },
  },
  "5": {
    zones: {
      living: {
        name: "Living",
        minisplits: ["living_ac"],
        exteriorOpenings: ["d_front"],
        interiorDoors: [],
      },
    },
  },
  "6": { webhookKey: "ifttt_test" },
  "7": { tested: true },
};

test("a new owner can go from welcome to an active system", async ({ page }) => {
  backend = await FakeBackend.attach(page);
  await page.goto("/");

  // 1. Welcome
  await expectStep(page, 1, "Welcome");
  await next(page);

  // 2. YoLink credentials, tested before moving on
  await expectStep(page, 2, "YoLink Credentials");
  await page.getByPlaceholder("ua_xxxxxxxx").fill("ua_test");
  await page.locator('input[type="password"]').fill("sk_test");
  await page.getByRole("button", { name: "Test credentials" }).click();
  await expect(page.getByText("YoLink credentials are valid")).toBeVisible();
  await next(page);

  // 3. Sensors, discovered from YoLink
  await expectStep(page, 3, "Sensors");
  await page.getByRole("button", { name: "Auto-discover from YoLink" }).click();
  await expect(page.getByPlaceholder("Sensor ID")).toHaveCount(3);
  await page
    .getByPlaceholder("Sensor ID")
    .nth(1)
    .locator("..")
    .locator("..")
    .getByRole("button", { name: "Remove" })
    .click();
  await expect(page.getByPlaceholder("Sensor ID")).toHaveCount(2);
  await page.locator('input[type="number"]').first().fill("120");
  await next(page);

  // 4. HVAC units — IDs derive from the names
  await expectStep(page, 4, "HVAC Units");
  await page.getByPlaceholder("Display name (e.g. Master Bedroom AC)").fill("Living Room AC");
  await expect(page.getByPlaceholder("Unit ID")).toHaveValue("living_room_ac");
  await page.getByRole("button", { name: "+ Add HVAC unit" }).click();
  await page.getByPlaceholder("Display name (e.g. Master Bedroom AC)").nth(1).fill("Bedroom AC");
  await next(page);

  // 5. Zones — two rooms joined by the hallway door
  await expectStep(page, 5, "Zones");
  const zones = page.locator("[data-step-form] div.border");
  await page.getByPlaceholder("Zone name (e.g. Living Room)").fill("Living Room");
  await zones.nth(0).getByRole("button", { name: "Living Room AC" }).click();
  await zones.nth(0).getByRole("button", { name: "Front Door" }).click();
  await page.getByRole("button", { name: "+ Add zone" }).click();
  await page.getByPlaceholder("Zone name (e.g. Living Room)").nth(1).fill("Bedroom");
  await zones.nth(1).getByRole("button", { name: "Bedroom AC" }).click();
  await zones.nth(0).getByRole("button", { name: "+ Add interior door" }).click();
  await zones.nth(0).locator("select").nth(0).selectOption({ label: "Hallway Door" });
  await zones.nth(0).locator("select").nth(1).selectOption({ label: "Bedroom" });
  await next(page);

  // 6. IFTTT key
  await expectStep(page, 6, "IFTTT Webhook Key");
  await page.locator('input[type="password"]').fill("ifttt_test");
  await page.getByRole("button", { name: "Test key" }).click();
  await expect(page.getByText("IFTTT webhook key is valid")).toBeVisible();
  await next(page);

  // 7. Test applets — fires only the one the owner clicks
  await expectStep(page, 7, "Test IFTTT Applets");
  await expect(page.getByText("Event: turn_off_living_room_ac")).toBeVisible();
  await expect(page.getByText("Event: turn_off_bedroom_ac")).toBeVisible();
  await page.getByRole("button", { name: "Test" }).first().click();
  await expect(
    page.getByText('Test webhook fired for event "turn_off_living_room_ac"'),
  ).toBeVisible();
  expect(backend.callsTo("POST", "/api/onboarding/ifttt-test-applet")).toHaveLength(1);
  await next(page);

  // 8. Review
  await expectStep(page, 8, "Review Configuration");
  await page.getByRole("button", { name: "Verify Configuration" }).click();
  await expect(page.getByText("Configuration is valid")).toBeVisible();
  await next(page);

  // 9. Activate — the one-time secret and the URLs the applets need
  await expect(page.getByRole("heading", { name: "Activate" })).toBeVisible();
  await page.getByRole("button", { name: "Activate System" }).click();
  await expect(page.getByText("Your system is now active!")).toBeVisible();
  await expect(page.getByText(`Authorization: Bearer ${WEBHOOK_SECRET}`)).toBeVisible();
  await expect(page.getByText(`${APP_URL}/api/t/${TENANT_ID}/sensor-event`)).toBeVisible();
  await expect(page.getByText(`${APP_URL}/api/t/${TENANT_ID}/hvac-event`)).toBeVisible();

  await page.getByRole("button", { name: "Continue to Dashboard" }).click();
  await expect(page.getByRole("button", { name: "Settings" })).toBeVisible();

  // What was saved is what activation turned into config.
  const saved = Object.fromEntries(backend.savedSteps().map((s) => [s.step, s.data]));
  expect(saved[2]).toEqual({ uaCid: "ua_test", secretKey: "sk_test" });
  expect(saved[3]).toEqual({
    sensorDelays: { d_front: 120, d_hall: 300 },
    sensorNames: { d_front: "Front Door", d_hall: "Hallway Door" },
    sensorDefaults: {},
  });
  expect(saved[4]).toEqual({
    hvacUnits: {
      living_room_ac: {
        name: "Living Room AC",
        iftttEvent: "turn_off_living_room_ac",
        delaySeconds: 300,
      },
      bedroom_ac: { name: "Bedroom AC", iftttEvent: "turn_off_bedroom_ac", delaySeconds: 300 },
    },
  });
  // The door was added on the living room; the bedroom's mirror was added for us.
  expect(saved[5]).toEqual({
    zones: {
      living_room: {
        name: "Living Room",
        minisplits: ["living_room_ac"],
        exteriorOpenings: ["d_front"],
        interiorDoors: [{ id: "d_hall", connectsTo: "bedroom" }],
      },
      bedroom: {
        name: "Bedroom",
        minisplits: ["bedroom_ac"],
        exteriorOpenings: [],
        interiorDoors: [{ id: "d_hall", connectsTo: "living_room" }],
      },
    },
  });
  expect(saved[6]).toEqual({ webhookKey: "ifttt_test" });
  expect(backend.tenantStatus).toBe("active");
});

test("reopening the wizard resumes after the last saved step", async ({ page }) => {
  backend = await FakeBackend.attach(page, {
    stepData: {
      "1": throughTestApplets["1"],
      "2": throughTestApplets["2"],
      "3": throughTestApplets["3"],
    },
  });
  await page.goto("/");

  await expectStep(page, 4, "HVAC Units");

  // Going back shows what was saved, not a blank form.
  await page.getByRole("button", { name: "Back" }).click();
  await expectStep(page, 3, "Sensors");
  await expect(page.getByPlaceholder("Sensor ID").nth(0)).toHaveValue("d_front");
  await expect(page.getByPlaceholder("Display name").nth(1)).toHaveValue("Hallway Door");
});

test("wrong YoLink credentials are explained, not just rejected", async ({ page }) => {
  backend = await FakeBackend.attach(page, { stepData: { "1": { completed: true } } });
  // The real handler's response for credentials YoLink refuses.
  backend.overrides.set("POST /api/onboarding/yolink-test", () => ({
    status: 400,
    json: { status: "error", message: "Invalid YoLink credentials" },
  }));
  await page.goto("/");

  await expectStep(page, 2, "YoLink Credentials");
  await page.getByPlaceholder("ua_xxxxxxxx").fill("ua_wrong");
  await page.locator('input[type="password"]').fill("sk_wrong");
  await page.getByRole("button", { name: "Test credentials" }).click();

  await expect(page.getByText("Invalid YoLink credentials")).toBeVisible();
});

test("Review says why the server would reject the configuration", async ({ page }) => {
  // A zone that names a sensor the sensors step no longer has — what happens
  // when a sensor is removed after the zones were set up.
  backend = await FakeBackend.attach(page, {
    stepData: {
      ...throughTestApplets,
      "3": {
        sensorDelays: { d_hall: 60 },
        sensorNames: { d_hall: "Hallway Door" },
        sensorDefaults: {},
      },
    },
  });
  await page.goto("/");

  await expectStep(page, 8, "Review Configuration");
  await page.getByRole("button", { name: "Verify Configuration" }).click();

  await expect(page.getByText("Configuration validation failed")).toBeVisible();
  // The schema's own reason, not a generic failure.
  await expect(
    page.getByText(/Every sensor in exteriorOpenings\/interiorDoors must exist in sensorDelays/),
  ).toBeVisible();
});

test("a sensor delay of zero is kept, not reset to the default", async ({ page }) => {
  backend = await FakeBackend.attach(page, {
    stepData: { "1": throughTestApplets["1"], "2": throughTestApplets["2"] },
  });
  await page.goto("/");

  await expectStep(page, 3, "Sensors");
  await page.getByRole("button", { name: "Auto-discover from YoLink" }).click();
  await page.locator('input[type="number"]').first().fill("0");
  await next(page);
  await expectStep(page, 4, "HVAC Units");

  const saved = backend.savedSteps().find((s) => s.step === 3);
  expect(saved?.data.sensorDelays).toMatchObject({ d_front: 0 });
});
