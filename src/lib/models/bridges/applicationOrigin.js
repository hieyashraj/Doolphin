/**
 * Resolves trusted application origin for model platform asset URL resolution.
 * WEBHOOK_URL is NEVER an input or authority for asset origins.
 *
 * Rules:
 * 1. Configured APP_BASE_URL (HTTPS) -> use its .origin
 * 2. Otherwise configured NEXTAUTH_URL (HTTPS) -> use its .origin
 * 3. Non-production (nodeEnv !== 'production') + request origin hostname is localhost/127.0.0.1/::1 -> use request origin
 * 4. Production HTTP origin -> reject (return null)
 * 5. Malformed URL -> reject (return null)
 * 6. Missing trusted origin -> reject (return null)
 */
export function resolveTrustedApplicationOrigin({
  appBaseUrl = null,
  nextAuthUrl = null,
  requestOrigin = null,
  nodeEnv = null,
} = {}) {
  const tryParseHttpsOrigin = (urlStr) => {
    if (!urlStr || typeof urlStr !== "string") return null;
    const trimmed = urlStr.trim();
    if (!trimmed.startsWith("https://")) return null;
    try {
      const parsed = new URL(trimmed);
      if (parsed.protocol === "https:") {
        return parsed.origin;
      }
    } catch {
      return null;
    }
    return null;
  };

  // 1. APP_BASE_URL HTTPS
  const fromAppBase = tryParseHttpsOrigin(appBaseUrl);
  if (fromAppBase) return fromAppBase;

  // 2. NEXTAUTH_URL HTTPS
  const fromNextAuth = tryParseHttpsOrigin(nextAuthUrl);
  if (fromNextAuth) return fromNextAuth;

  // 3. Non-production localhost request origin
  const isNonProduction = (nodeEnv || "").trim() !== "production";
  if (isNonProduction && requestOrigin && typeof requestOrigin === "string") {
    try {
      const parsedReq = new URL(requestOrigin.trim());
      const hostname = parsedReq.hostname.toLowerCase();
      if (hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1" || hostname === "[::1]") {
        if (parsedReq.protocol === "http:" || parsedReq.protocol === "https:") {
          return parsedReq.origin;
        }
      }
    } catch {
      return null;
    }
  }

  // Fail closed
  return null;
}
