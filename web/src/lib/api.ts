export interface CheckStateResponse {
  status: string;
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
