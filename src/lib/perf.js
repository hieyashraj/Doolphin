/**
 * Lightweight structured performance timing for staging/preview environments.
 *
 * Logs are emitted only when VERCEL_ENV !== "production" (i.e. Preview and
 * local development). They are silent in Production with no code change needed.
 *
 * Log shape:
 *   { event: "perf", reqId, label, durationMs, ...extra }
 */

/** Returns true when running in a non-production deployment. */
export function isPerfLoggingEnabled() {
  return process.env.VERCEL_ENV !== "production";
}

/**
 * Generate a short random correlation ID for a request.
 * Format: 8 hex chars, e.g. "a3f1c2b0"
 */
export function newReqId() {
  return Math.floor(Math.random() * 0xffffffff).toString(16).padStart(8, "0");
}

/**
 * Emit a structured perf log line to stdout.
 * Silently no-ops in Production.
 *
 * @param {string} reqId   - Correlation ID for this request.
 * @param {string} label   - Human-readable step name.
 * @param {number} startMs - performance.now() or Date.now() at step start.
 * @param {object} [extra] - Optional additional fields.
 */
export function logPerf(reqId, label, startMs, extra = {}) {
  if (!isPerfLoggingEnabled()) return;
  const durationMs = Math.round(performance.now() - startMs);
  // Use a single JSON line so Vercel log parser captures it atomically.
  console.log(
    JSON.stringify({ event: "perf", reqId, label, durationMs, ...extra })
  );
}

/**
 * Convenience: run an async fn, log its duration, and return its result.
 *
 * @template T
 * @param {string} reqId
 * @param {string} label
 * @param {() => Promise<T>} fn
 * @param {object} [extra]
 * @returns {Promise<T>}
 */
export async function timed(reqId, label, fn, extra = {}) {
  const start = performance.now();
  try {
    const result = await fn();
    logPerf(reqId, label, start, extra);
    return result;
  } catch (err) {
    logPerf(reqId, label, start, { ...extra, error: err?.message ?? String(err) });
    throw err;
  }
}
