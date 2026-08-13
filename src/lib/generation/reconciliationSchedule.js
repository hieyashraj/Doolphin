/**
 * Scheduler configuration is intentionally a pure plan until staging supplies
 * an authenticated cron secret and an explicit staging deployment marker.
 * Production is never eligible through this mechanism.
 */
import { isStagingEnvironment } from "../generation-models/types.js";

export function reconciliationSchedulePlan(env = process.env) {
  const isStaging = isStagingEnvironment(env);
  if (!isStaging) return { enabled: false, reason: "STAGING_ENVIRONMENT_REQUIRED" };
  if (!env.CRON_SECRET) return { enabled: false, reason: "CRON_SECRET_REQUIRED" };
  if (!env.WEBHOOK_URL?.startsWith("https://")) return { enabled: false, reason: "WEBHOOK_URL_HTTPS_REQUIRED" };
  return { enabled: true, method: "POST", path: "/api/internal/reconcile", authorization: "Bearer <CRON_SECRET>", cadence: "*/1 * * * *", dryRunSupported: true };
}
