import { describe, it, expect } from "vitest";
import { extractTenantIdFromUrl } from "@/middleware/extractTenant";

function req(url: string): Request {
  return new Request(url, { method: "GET" });
}

describe("extractTenantIdFromUrl", () => {
  it("extracts tenant ID from /api/t/{id}/sensor-event", () => {
    const result = extractTenantIdFromUrl(req("https://example.com/api/t/abc-123/sensor-event"));
    expect(result).toBe("abc-123");
  });

  it("extracts tenant ID from /api/t/{id}/hvac-event", () => {
    const result = extractTenantIdFromUrl(req("https://example.com/api/t/tenant-42/hvac-event"));
    expect(result).toBe("tenant-42");
  });

  it("returns null for non-tenant URLs", () => {
    expect(extractTenantIdFromUrl(req("https://example.com/api/sensor-event"))).toBeNull();
  });

  it("returns null for root path", () => {
    expect(extractTenantIdFromUrl(req("https://example.com/"))).toBeNull();
  });

  it("handles UUID tenant IDs", () => {
    const uuid = "550e8400-e29b-41d4-a716-446655440000";
    const result = extractTenantIdFromUrl(req(`https://example.com/api/t/${uuid}/sensor-event`));
    expect(result).toBe(uuid);
  });
});
