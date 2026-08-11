const TERMINAL_FAILURES = new Set(["FAILED", "QUARANTINED", "TIMED_OUT", "CANCELLED"]);

export function isTerminalGenerationFailure(status) {
  return TERMINAL_FAILURES.has(String(status || "").toUpperCase());
}

// Provider diagnostics remain in ProviderJob for support and reconciliation.
// These are the only messages that cross the product API boundary.
export function userFacingGenerationMessage(status, errorCode) {
  const normalizedStatus = String(status || "").toUpperCase();
  const normalizedCode = String(errorCode || "").toUpperCase();
  if (normalizedStatus === "TIMED_OUT" || normalizedCode === "WORKFLOW_TIMEOUT") {
    return "The model is taking longer than usual. Your credits were returned — please try again.";
  }
  if (normalizedCode === "QUALITY_GATE_FAILED") {
    return "The model could not deliver a usable video. Your credits were returned — please try again.";
  }
  return "Model servers are busy right now. Your credits were returned — please try again.";
}
