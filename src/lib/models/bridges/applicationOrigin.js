/**
 * Resolves trusted application origin for model platform asset URL resolution.
 * WEBHOOK_URL is NEVER an input or authority for asset origins.
 *
 * Rules:
 * 1. Configured APP_BASE_URL (HTTPS) -> use its .origin
 * 2. Otherwise configured NEXTAUTH_URL (HTTPS) -> use its .origin
 * 3. Anything else -> reject (return null), which fails the generation closed.
 *
 * REMOVED (deliberately, this was burning real money): a former rule granted a
 * localhost/127.0.0.1 request origin as a trusted asset origin whenever
 * NODE_ENV !== "production". Asset URLs are handed to MuAPI, which fetches them
 * from ITS OWN servers — a localhost URL is never fetchable by a third party.
 * MuAPI does not error on an unfetchable reference; it silently generates from
 * the prompt text alone and still charges us. That produced fully-billed
 * generations whose output ignored the user's chosen avatar and uploaded
 * product/app imagery entirely.
 *
 * Consequence for local development: generation now requires APP_BASE_URL to be
 * a real public HTTPS origin (e.g. a tunnel such as ngrok/cloudflared, or a
 * deployed preview URL that is NOT behind Deployment Protection). This is the
 * correct trade: a provider that must fetch your assets over the internet
 * cannot be served from your laptop.
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

  // 2. NEXTAUTH_URL HTTPS (legacy compatibility fallback; HTTPS-only so a
  //    localhost value from .env.example can never satisfy it)
  const fromNextAuth = tryParseHttpsOrigin(nextAuthUrl);
  if (fromNextAuth) return fromNextAuth;

  // 3. Fail closed. `requestOrigin` and `nodeEnv` are accepted for signature
  //    compatibility but are intentionally NOT authorities: a request must
  //    never be able to nominate the origin from which a paid provider fetches
  //    our assets, and a non-production environment must not get a weaker
  //    guarantee than production on a path that spends money.
  return null;
}
