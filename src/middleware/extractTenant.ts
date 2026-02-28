/**
 * Extract tenantId from request URL path.
 * Expects URLs like /api/t/{tenantId}/sensor-event
 * Returns null if the URL doesn't contain a tenant path segment.
 */
export function extractTenantIdFromUrl(request: Request): string | null {
  try {
    const url = new URL(request.url, "http://localhost");
    // Match /api/t/{tenantId}/... pattern
    const match = url.pathname.match(/^\/api\/t\/([^/]+)\//);
    return match?.[1] ?? null;
  } catch {
    return null;
  }
}
