/**
 * Provider Asset Reachability Gate.
 *
 * WHY THIS EXISTS (financial safety, not cosmetics):
 * MuAPI fetches every reference image/video by URL from its own servers. If a
 * URL is not publicly fetchable, MuAPI does NOT fail the job — it silently
 * generates from the prompt text alone and still bills us. The result is a
 * technically-successful, fully-charged generation whose output ignores the
 * user's avatar/product/app references entirely.
 *
 * That exact failure mode was shipping: relative avatar paths were resolved
 * against `http://localhost:3000` in non-production, producing absolute-but-
 * unfetchable URLs that passed every prior validation layer and were paid for.
 *
 * This module is the hard gate that must pass BEFORE a billable quote is
 * created. It fails CLOSED: any doubt about reachability blocks the paid call.
 */

const REACHABILITY_TIMEOUT_MS = 8000;

// Hosts that can never be fetched by a third-party provider. Also doubles as
// SSRF protection: we must never ask a provider to fetch internal addresses.
const BLOCKED_HOSTNAMES = new Set([
  "localhost",
  "127.0.0.1",
  "0.0.0.0",
  "::1",
  "[::1]",
]);

function isBlockedHostname(hostname) {
  const host = String(hostname || "").toLowerCase().replace(/^\[|\]$/g, "");
  if (!host) return true;
  if (BLOCKED_HOSTNAMES.has(host)) return true;
  if (host.endsWith(".local") || host.endsWith(".internal") || host.endsWith(".localhost")) return true;

  // IPv4 private / loopback / link-local / carrier-grade NAT ranges
  const ipv4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (ipv4) {
    const [a, b] = [Number(ipv4[1]), Number(ipv4[2])];
    if (a === 10) return true;
    if (a === 127) return true;
    if (a === 0) return true;
    if (a === 169 && b === 254) return true; // link-local incl. cloud metadata 169.254.169.254
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 100 && b >= 64 && b <= 127) return true;
    return false;
  }

  // IPv6 loopback / unique-local / link-local
  if (host === "::" || host.startsWith("fc") || host.startsWith("fd") || host.startsWith("fe80")) return true;

  return false;
}

/**
 * Pure, offline structural check. No network access.
 * Returns { ok: true } or { ok: false, code, reason }.
 */
export function validateProviderAssetUrlShape(rawUrl) {
  const urlStr = String(rawUrl || "").trim();
  if (!urlStr) {
    return { ok: false, code: "ASSET_URL_EMPTY", reason: "Asset URL is empty." };
  }

  let parsed;
  try {
    parsed = new URL(urlStr);
  } catch {
    return { ok: false, code: "ASSET_URL_MALFORMED", reason: `Asset URL is not a valid absolute URL: '${urlStr}'.` };
  }

  // A provider can only fetch over public HTTPS. Plain http:// is rejected
  // outright: it is the signature of the localhost/dev-origin failure mode.
  if (parsed.protocol !== "https:") {
    return {
      ok: false,
      code: "ASSET_URL_NOT_HTTPS",
      reason: `Asset URL must be public HTTPS to be fetchable by the provider (received '${parsed.protocol}//').`,
    };
  }

  if (isBlockedHostname(parsed.hostname)) {
    return {
      ok: false,
      code: "ASSET_URL_NOT_PUBLIC",
      reason: `Asset host '${parsed.hostname}' is not publicly reachable by the provider.`,
    };
  }

  return { ok: true };
}

/**
 * Confirms the object actually exists and serves media bytes.
 *
 * Uses a 1-byte ranged GET rather than HEAD: presigned R2/S3 URLs are commonly
 * signed for GET only and answer HEAD with 403, which would otherwise cause
 * false negatives that block legitimate generations.
 */
async function probeProviderAssetUrl(url, { fetchImpl = fetch } = {}) {
  let response;
  try {
    response = await fetchImpl(url, {
      method: "GET",
      headers: { Range: "bytes=0-0" },
      redirect: "follow",
      signal: AbortSignal.timeout(REACHABILITY_TIMEOUT_MS),
    });
  } catch (error) {
    return {
      ok: false,
      code: "ASSET_UNREACHABLE",
      reason: `Provider could not fetch asset (${error?.name === "TimeoutError" ? "timed out" : "network error"}).`,
    };
  }

  // 206 Partial Content is the expected answer to a ranged GET; 200 is also
  // acceptable for servers that ignore Range.
  if (response.status !== 200 && response.status !== 206) {
    return {
      ok: false,
      code: "ASSET_UNREACHABLE",
      reason: `Asset URL returned HTTP ${response.status}; the provider would not be able to read it.`,
    };
  }

  const contentType = String(response.headers.get("content-type") || "").toLowerCase();
  // An HTML body is the classic symptom of an auth wall or SPA 404 page being
  // served in place of the object (e.g. Vercel Deployment Protection).
  if (contentType.startsWith("text/html")) {
    return {
      ok: false,
      code: "ASSET_NOT_MEDIA",
      reason: "Asset URL returned an HTML page instead of media (asset is likely behind authentication or missing).",
    };
  }
  if (contentType && !contentType.startsWith("image/") && !contentType.startsWith("video/") && !contentType.startsWith("audio/") && !contentType.startsWith("application/octet-stream")) {
    return {
      ok: false,
      code: "ASSET_NOT_MEDIA",
      reason: `Asset URL served unexpected content-type '${contentType}'.`,
    };
  }

  return { ok: true };
}

/**
 * The gate. Validates shape for every URL first (cheap, offline), then probes
 * reachability in parallel. Returns the FIRST failure so the caller can fail
 * closed with a precise, user-actionable reason.
 *
 * @returns {Promise<{ ok: true } | { ok: false, code: string, reason: string, url: string }>}
 */
export async function assertProviderAssetsAreFetchable(urls, { fetchImpl = fetch, skipNetworkProbe = false } = {}) {
  const list = Array.isArray(urls) ? urls : [];
  if (!list.length) return { ok: true };

  for (const url of list) {
    const shape = validateProviderAssetUrlShape(url);
    if (!shape.ok) {
      return { ...shape, url: String(url) };
    }
  }

  // Structural validation is always enforced. The network probe can be skipped
  // only by explicit server-side opt-out (e.g. an offline test harness); it is
  // never skippable from a request.
  if (skipNetworkProbe) return { ok: true };

  const probes = await Promise.all(
    list.map(async (url) => ({ url, result: await probeProviderAssetUrl(url, { fetchImpl }) }))
  );
  const failure = probes.find((entry) => !entry.result.ok);
  if (failure) {
    return { ...failure.result, url: String(failure.url) };
  }

  return { ok: true };
}
