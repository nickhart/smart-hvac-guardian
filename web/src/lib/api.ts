export interface CheckStateResponse {
  status: string;
  siteName: string;
  systemEnabled: boolean;
  sensorStates: Record<string, string>;
  sensorNames: Record<string, string>;
  unitNames: Record<string, string>;
  unitDelays: Record<string, number>;
  exposedUnits: string[];
  unexposedUnits: string[];
  activeTimers: string[];
  offlineSensors: string[];
}

export interface SessionResponse {
  authenticated: boolean;
  email?: string;
  siteName?: string;
  tenantId?: string;
  tenantStatus?: "onboarding" | "active" | "suspended";
}

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error((body as { error?: string }).error ?? res.statusText);
  }
  return res.json() as Promise<T>;
}

export async function checkSession(): Promise<SessionResponse> {
  return fetchJson<SessionResponse>("/api/auth/session");
}

export async function sendMagicLink(email: string): Promise<void> {
  await fetchJson("/api/auth/send-magic", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email }),
  });
}

export async function logout(): Promise<void> {
  await fetchJson("/api/auth/logout", { method: "POST" });
}

export async function getCheckState(): Promise<CheckStateResponse> {
  return fetchJson<CheckStateResponse>("/api/check-state");
}

export async function setUnitDelay(
  unitId: string,
  delaySeconds: number,
): Promise<{ status: string; unitId: string; delaySeconds: number }> {
  return fetchJson("/api/unit-delay", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ unitId, delaySeconds }),
  });
}

export async function setSystemToggle(enabled: boolean): Promise<{ enabled: boolean }> {
  return fetchJson("/api/system-toggle", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ enabled }),
  });
}

// --- Onboarding API ---

export async function startOnboarding(
  email: string,
  propertyName: string,
): Promise<{ status: string; tenantId?: string; slug?: string; message: string }> {
  return fetchJson("/api/onboarding/start", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, propertyName }),
  });
}

export async function getOnboardingSteps(): Promise<{
  status: string;
  stepData: Record<string, Record<string, unknown>>;
}> {
  return fetchJson("/api/onboarding/step");
}

export async function saveOnboardingStep(
  step: number,
  data: Record<string, unknown>,
): Promise<{ status: string }> {
  return fetchJson("/api/onboarding/step", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ step, data }),
  });
}

export async function testYoLinkCredentials(
  uaCid: string,
  secretKey: string,
): Promise<{ status: string; message: string }> {
  return fetchJson("/api/onboarding/yolink-test", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ uaCid, secretKey }),
  });
}

export async function discoverYoLinkDevices(): Promise<{
  status: string;
  devices: Array<{ deviceId: string; name: string; type: string; modelName: string }>;
}> {
  return fetchJson("/api/onboarding/yolink-devices");
}

export async function testIftttKey(
  webhookKey: string,
): Promise<{ status: string; message: string }> {
  return fetchJson("/api/onboarding/ifttt-test", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ webhookKey }),
  });
}

export async function testIftttApplet(
  iftttEvent: string,
): Promise<{ status: string; message: string }> {
  return fetchJson("/api/onboarding/ifttt-test-applet", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ iftttEvent }),
  });
}

export async function verifyOnboarding(): Promise<{
  status: string;
  message: string;
  config?: unknown;
  errors?: unknown;
  webhookUrls?: { sensorEvent: string; hvacEvent: string };
}> {
  return fetchJson("/api/onboarding/verify", { method: "POST" });
}

export async function activateOnboarding(): Promise<{
  status: string;
  message: string;
  webhookUrls?: { sensorEvent: string; hvacEvent: string };
  webhookSecret?: string;
}> {
  return fetchJson("/api/onboarding/activate", { method: "POST" });
}

export async function importEnvConfig(): Promise<{ status: string; message: string }> {
  return fetchJson("/api/onboarding/import-env", { method: "POST" });
}

// --- Settings API ---

export interface ConfigResponse {
  status: string;
  config: Record<string, unknown>;
  valid: boolean;
  errors?: { formErrors: string[]; fieldErrors: Record<string, string[]> };
}

export async function getConfig(): Promise<ConfigResponse> {
  return fetchJson("/api/settings/config");
}

export async function updateConfig(config: Record<string, unknown>): Promise<{ status: string }> {
  return fetchJson("/api/settings/config", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(config),
  });
}
