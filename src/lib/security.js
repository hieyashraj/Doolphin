import net from "net";

/**
 * Security and Redaction Utilities for Doolphin Platform.
 * Section 6 & 13 Compliance.
 */

const SECRET_PATTERNS = [
  /fal_[a-zA-Z0-9_-]+/gi,
  /sk-[a-zA-Z0-9_-]+/gi,
  /key-[a-zA-Z0-9_-]+/gi,
  /bearer\s+[a-zA-Z0-9._-]+/gi,
];

export function redactSecrets(obj) {
  if (!obj) return obj;
  if (typeof obj === "string") {
    let sanitized = obj;
    for (const pattern of SECRET_PATTERNS) {
      sanitized = sanitized.replace(pattern, "[REDACTED_SECRET]");
    }
    return sanitized;
  }
  if (Array.isArray(obj)) {
    return obj.map(redactSecrets);
  }
  if (typeof obj === "object") {
    const redacted = {};
    for (const [key, value] of Object.entries(obj)) {
      const lowerKey = key.toLowerCase();
      if (
        lowerKey.includes("key") ||
        lowerKey.includes("token") ||
        lowerKey.includes("secret") ||
        lowerKey.includes("auth") ||
        lowerKey.includes("cookie") ||
        lowerKey.includes("password")
      ) {
        redacted[key] = "[REDACTED]";
      } else {
        redacted[key] = redactSecrets(value);
      }
    }
    return redacted;
  }
  return obj;
}

export function sanitizeHeaders(headers = {}) {
  const safe = {};
  for (const [k, v] of Object.entries(headers)) {
    const lowerKey = k.toLowerCase();
    if (
      lowerKey === "authorization" ||
      lowerKey === "cookie" ||
      lowerKey === "set-cookie" ||
      lowerKey.includes("key") ||
      lowerKey.includes("secret")
    ) {
      safe[k] = "[REDACTED]";
    } else {
      safe[k] = v;
    }
  }
  return safe;
}

export function validateSsrfTarget(urlString) {
  try {
    const parsed = new URL(urlString);
    const hostname = parsed.hostname;

    // Check IP literal
    if (net.isIP(hostname)) {
      if (isPrivateIp(hostname)) {
        throw new Error(`SSRF Blocked: Private IP target ${hostname}`);
      }
    }

    if (
      hostname === "localhost" ||
      hostname.endsWith(".local") ||
      hostname.endsWith(".internal") ||
      hostname === "169.254.169.254"
    ) {
      throw new Error(`SSRF Blocked: Reserved/Internal domain ${hostname}`);
    }

    return true;
  } catch (err) {
    throw new Error(`SSRF Validation Failed: ${err.message}`);
  }
}

function isPrivateIp(ip) {
  if (ip === "127.0.0.1" || ip === "::1" || ip === "169.254.169.254") return true;
  const parts = ip.split(".").map(Number);
  if (parts.length === 4) {
    if (parts[0] === 10) return true;
    if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true;
    if (parts[0] === 192 && parts[1] === 168) return true;
    if (parts[0] === 169 && parts[1] === 254) return true;
    if (parts[0] === 127) return true;
  }
  return false;
}
