import type { Page, Route } from "@playwright/test";
import {
  tenantWebhookUrls,
  validateOnboardingConfig,
  type OnboardingStepData,
} from "../../src/onboarding/assemble-config.js";

/**
 * A stand-in for the API the web app talks to.
 *
 * Responses mirror the real handlers in `api/` — including their error shapes,
 * which is where the wizard's bugs have been — and verify/activate validate
 * with the real config assembly and schema, so the fake rejects exactly what
 * production would. Nothing here reaches YoLink or IFTTT.
 *
 * Any request it has no answer for is recorded in `unexpected` and answered
 * with a 404, so a new API call the fake doesn't know about fails loudly
 * instead of being silently ignored.
 */

export const TENANT_ID = "tenant-under-test";
export const APP_URL = "https://guardian.example.com";
export const WEBHOOK_SECRET = "f00dfeed".repeat(8);

export interface YoLinkDevice {
  deviceId: string;
  name: string;
  type: string;
  modelName: string;
}

export interface ApiCall {
  method: string;
  path: string;
  body: Record<string, unknown> | null;
}

interface Reply {
  status?: number;
  json: unknown;
}

type Handler = (body: Record<string, unknown>) => Reply;

export const DEFAULT_DEVICES: YoLinkDevice[] = [
  { deviceId: "d_front", name: "Front Door", type: "DoorSensor", modelName: "YS7704-UC" },
  { deviceId: "d_patio", name: "Patio Door", type: "DoorSensor", modelName: "YS7704-UC" },
  { deviceId: "d_hall", name: "Hallway Door", type: "DoorSensor", modelName: "YS7704-UC" },
];

export class FakeBackend {
  tenantStatus: "onboarding" | "active" = "onboarding";
  stepData: OnboardingStepData;
  devices: YoLinkDevice[] = DEFAULT_DEVICES;
  readonly calls: ApiCall[] = [];
  readonly unexpected: string[] = [];
  /** Replace one route's behaviour, keyed "METHOD /api/path". */
  readonly overrides = new Map<string, Handler>();

  private constructor(stepData: OnboardingStepData) {
    this.stepData = structuredClone(stepData);
  }

  static async attach(page: Page, init: { stepData?: OnboardingStepData } = {}) {
    const backend = new FakeBackend(init.stepData ?? {});
    await page.route("**/api/**", (route) => backend.handle(route));
    return backend;
  }

  /** Every `POST /api/onboarding/step`, in order. */
  savedSteps(): Array<{ step: number; data: Record<string, unknown> }> {
    return this.callsTo("POST", "/api/onboarding/step").map((c) => ({
      step: c.body?.step as number,
      data: c.body?.data as Record<string, unknown>,
    }));
  }

  callsTo(method: string, path: string): ApiCall[] {
    return this.calls.filter((c) => c.method === method && c.path === path);
  }

  private async handle(route: Route) {
    const request = route.request();
    const method = request.method();
    const path = new URL(request.url()).pathname;
    const raw = request.postData();
    const body = raw ? (JSON.parse(raw) as Record<string, unknown>) : null;
    this.calls.push({ method, path, body });

    const reply = this.respond(method, path, body ?? {});
    await route.fulfill({
      status: reply.status ?? 200,
      contentType: "application/json",
      body: JSON.stringify(reply.json),
    });
  }

  private respond(method: string, path: string, body: Record<string, unknown>): Reply {
    const key = `${method} ${path}`;
    const override = this.overrides.get(key);
    if (override) return override(body);

    switch (key) {
      case "GET /api/auth/session":
        return {
          json: {
            authenticated: true,
            email: "owner@example.com",
            siteName: "Test Guardian",
            tenantId: TENANT_ID,
            tenantStatus: this.tenantStatus,
          },
        };

      case "POST /api/auth/logout":
        return { json: { status: "ok" } };

      case "GET /api/onboarding/step":
        return { json: { status: "ok", stepData: this.stepData } };

      case "POST /api/onboarding/step": {
        const step = body.step as number;
        this.stepData = { ...this.stepData, [String(step)]: body.data as Record<string, unknown> };
        return { json: { status: "ok", step } };
      }

      case "POST /api/onboarding/yolink-test":
        return { json: { status: "ok", message: "YoLink credentials are valid" } };

      case "GET /api/onboarding/yolink-devices":
        if (!this.stepData["2"]?.uaCid) {
          return {
            status: 400,
            json: { error: "YoLink credentials not configured. Complete step 2 first." },
          };
        }
        return { json: { status: "ok", devices: this.devices } };

      case "POST /api/onboarding/ifttt-test":
        return { json: { status: "ok", message: "IFTTT webhook key is valid" } };

      case "POST /api/onboarding/ifttt-test-applet":
        if (!this.stepData["6"]?.webhookKey) {
          return {
            status: 400,
            json: { error: "IFTTT webhook key not configured. Complete step 6 first." },
          };
        }
        return {
          json: { status: "ok", message: `Test webhook fired for event "${body.iftttEvent}"` },
        };

      case "POST /api/onboarding/verify": {
        const result = validateOnboardingConfig(this.stepData, TENANT_ID, APP_URL);
        if (!result.success) return validationFailure(result.error.flatten());
        return {
          json: {
            status: "ok",
            message: "Configuration is valid",
            config: result.data,
            webhookUrls: tenantWebhookUrls(APP_URL, TENANT_ID),
          },
        };
      }

      case "POST /api/onboarding/activate": {
        const step2 = this.stepData["2"] ?? {};
        if (!step2.uaCid || !step2.secretKey || !this.stepData["6"]?.webhookKey) {
          return {
            status: 400,
            json: { error: "Missing required credentials. Complete all steps first." },
          };
        }
        const result = validateOnboardingConfig(this.stepData, TENANT_ID, APP_URL);
        if (!result.success) return validationFailure(result.error.flatten());
        this.tenantStatus = "active";
        return {
          json: {
            status: "ok",
            message: "Your system is now active!",
            webhookUrls: tenantWebhookUrls(APP_URL, TENANT_ID),
            webhookSecret: WEBHOOK_SECRET,
          },
        };
      }

      // The dashboard, once activation hands over to it.
      case "GET /api/check-state":
        return {
          json: {
            status: "ok",
            siteName: "Test Guardian",
            systemEnabled: false,
            sensorStates: {},
            sensorNames: {},
            unitNames: {},
            unitDelays: {},
            exposedUnits: [],
            unexposedUnits: [],
            activeTimers: [],
            offlineSensors: [],
          },
        };

      // Server-sent events exist only on the local dev server; the app falls
      // back to polling when this fails, as it does in production.
      case "GET /api/events":
        return { status: 404, json: { error: "Not found" } };

      default:
        this.unexpected.push(key);
        return { status: 404, json: { error: `The fake backend has no answer for ${key}` } };
    }
  }
}

/** The body verify and activate return when the assembled config is invalid. */
function validationFailure(errors: unknown): Reply {
  return {
    status: 400,
    json: { status: "error", message: "Configuration validation failed", errors },
  };
}
