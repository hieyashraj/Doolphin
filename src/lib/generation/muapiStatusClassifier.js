/**
 * Pure provider status classifier for MuAPI webhooks (Phase 4D Closure).
 *
 * Classifies raw authenticated provider response into:
 * - INTERMEDIATE: 'queued', 'pending', 'processing'
 * - SUCCESS_TERMINAL: 'completed', 'succeeded'
 * - FAILURE_TERMINAL: 'failed', 'cancelled', 'canceled', 'error' (or error property present)
 * - UNKNOWN: Any unrecognized status string (fails closed)
 */
export function classifyMuapiProviderStatus(providerPayload) {
  if (!providerPayload || typeof providerPayload !== "object") {
    return { type: "UNKNOWN", status: "missing_payload" };
  }

  if (providerPayload.error) {
    return { type: "FAILURE_TERMINAL", status: String(providerPayload.status || "failed").toLowerCase() };
  }

  const statusStr = String(providerPayload.status || "").toLowerCase().trim();

  if (["queued", "pending", "processing"].includes(statusStr)) {
    return { type: "INTERMEDIATE", status: statusStr };
  }

  if (["completed", "succeeded"].includes(statusStr)) {
    return { type: "SUCCESS_TERMINAL", status: statusStr };
  }

  if (["failed", "cancelled", "canceled", "error"].includes(statusStr)) {
    return { type: "FAILURE_TERMINAL", status: statusStr };
  }

  return { type: "UNKNOWN", status: statusStr };
}
