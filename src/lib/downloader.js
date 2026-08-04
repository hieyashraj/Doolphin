import { saveMediaBuffer } from "./storage.js";

const ALLOWED_DOMAINS = [
  "queue.fal.run",
  "fal.media",
  "v1.fal.media",
  "api.muapi.ai",
  "assets.mixkit.co",
  "cdn.doolphin.ai"
];

/**
 * Checks if a hostname or IP address is a private/internal network target
 */
function isPrivateHost(hostname) {
  if (!hostname) return true;
  const host = hostname.toLowerCase().trim();

  if (host === "localhost" || host === "127.0.0.1" || host === "::1" || host === "0.0.0.0") {
    return true;
  }

  // IPv4 Private Range Checks
  const ipParts = host.split(".").map(Number);
  if (ipParts.length === 4 && !ipParts.some(isNaN)) {
    // 10.0.0.0/8
    if (ipParts[0] === 10) return true;
    // 172.16.0.0/12
    if (ipParts[0] === 172 && ipParts[1] >= 16 && ipParts[1] <= 31) return true;
    // 192.168.0.0/16
    if (ipParts[0] === 192 && ipParts[1] === 168) return true;
    // 169.254.0.0/16 (Link Local / Cloud Metadata)
    if (ipParts[0] === 169 && ipParts[1] === 254) return true;
    // 127.0.0.0/8
    if (ipParts[0] === 127) return true;
  }

  return false;
}

/**
 * Validates whether a URL is SSRF-safe based on domain whitelist and IP checks
 */
export function validateSsrfTargetUrl(targetUrl) {
  try {
    const parsed = new URL(targetUrl);
    
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return { safe: false, reason: `Unsupported protocol: ${parsed.protocol}` };
    }

    if (isPrivateHost(parsed.hostname)) {
      return { safe: false, reason: `Private/internal network target blocked: ${parsed.hostname}` };
    }

    const domainAllowed = ALLOWED_DOMAINS.some(allowed => 
      parsed.hostname === allowed || parsed.hostname.endsWith(`.${allowed}`)
    );

    if (!domainAllowed) {
      return { safe: false, reason: `Domain not in allowed whitelist: ${parsed.hostname}` };
    }

    return { safe: true, url: parsed.href };
  } catch (err) {
    return { safe: false, reason: `Invalid URL format: ${err.message}` };
  }
}

/**
 * SSRF-Safe Video Downloader with Redirect Inspection & Private IP Defense
 */
export async function downloadVideoSsrfSafe(remoteUrl, creationId) {
  let currentUrl = remoteUrl;
  let redirectsRemaining = 5;

  while (redirectsRemaining >= 0) {
    const validation = validateSsrfTargetUrl(currentUrl);
    if (!validation.safe) {
      throw new Error(`SSRF_VALIDATION_FAILED: ${validation.reason}`);
    }

    const response = await fetch(currentUrl, {
      method: "GET",
      redirect: "manual",
      headers: { "User-Agent": "Doolphin-MediaDownloader/1.0" }
    });

    if (response.status >= 300 && response.status < 400) {
      const redirectTarget = response.headers.get("location");
      if (!redirectTarget) {
        throw new Error("SSRF_VALIDATION_FAILED: Redirect response missing Location header");
      }
      
      const resolvedRedirect = new URL(redirectTarget, currentUrl).href;
      currentUrl = resolvedRedirect;
      redirectsRemaining--;
      continue;
    }

    if (!response.ok) {
      throw new Error(`MEDIA_DOWNLOAD_FAILED: Remote server returned HTTP ${response.status}`);
    }

    const contentType = response.headers.get("content-type") || "";
    if (!contentType.includes("video") && !contentType.includes("octet-stream") && !contentType.includes("media")) {
      console.warn(`[DOWNLOADER_WARN] Unexpected Content-Type for video: ${contentType}`);
    }

    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    
    if (buffer.length < 100) {
      throw new Error("MEDIA_DOWNLOAD_FAILED: Downloaded file payload too small to be valid media");
    }

    const filename = `${creationId}_${Date.now()}.mp4`;
    const localUrl = await saveMediaBuffer(buffer, filename, "creations");
    return localUrl;
  }

  throw new Error("SSRF_VALIDATION_FAILED: Too many redirects");
}
