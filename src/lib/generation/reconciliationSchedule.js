/**
 * Scheduler configuration is a pure plan describing whether reconciliation
 * can safely run. Reconciliation is the ONLY mechanism that recovers a
 * generation when a MuAPI webhook is lost/delayed/rejected, and the only
 * mechanism that releases a credit reservation on timeout — it must be
 * eligible in PRODUCTION, not staging-only. Eligibility is gated purely by
 * having a secret bearer token and a public HTTPS callback base configured;
 * it never depends on environment name. `getMuapiApiKey()` (called by the
 * route itself, not here) is what guarantees a staging invocation can never
 * reach a production provider credential and vice versa.
 */
export function reconciliationSchedulePlan(env = process.env) {
  if (!env.CRON_SECRET) return { enabled: false, reason: "CRON_SECRET_REQUIRED" };
  if (!env.WEBHOOK_URL?.startsWith("https://")) return { enabled: false, reason: "WEBHOOK_URL_HTTPS_REQUIRED" };
  // Vercel Cron's minimum supported granularity is once per minute on paid
  // plans; Hobby is limited to once per day. The repository does not declare
  // which deployment plan it uses, so vercel.json intentionally has no cron:
  // adding this minute schedule there could make deployment invalid. Configure
  // it only after the paid-plan constraint is recorded, or invoke this route
  // from an external scheduler every 1-2 minutes with the same Bearer secret.
  return { enabled: true, method: "GET", path: "/api/internal/reconcile", authorization: "Bearer <CRON_SECRET>", cadence: "*/1 * * * *", dryRunSupported: true };
}
