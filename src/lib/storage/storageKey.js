const WRITE_NAMESPACES = new Set(["uploads", "final", "images", "thumbnails", "quarantine", "verification", "curated"]);

function assertNoContradictoryEnvironment(env = process.env) {
  if (env.DOOLPHIN_ENV === "staging" && env.VERCEL_ENV === "production") {
    throw new Error("CONTRADICTORY_ENVIRONMENT_SIGNALS");
  }
  if (env.DOOLPHIN_ENV === "production" && env.VERCEL_ENV && env.VERCEL_ENV !== "production") {
    throw new Error("CONTRADICTORY_ENVIRONMENT_SIGNALS");
  }
}

function isStaging(env = process.env) {
  assertNoContradictoryEnvironment(env);
  return env.DOOLPHIN_ENV === "staging" && env.VERCEL_ENV !== "production";
}

function isProduction(env = process.env) {
  assertNoContradictoryEnvironment(env);
  return env.VERCEL_ENV === "production" || (env.DOOLPHIN_ENV === "production" && env.VERCEL_ENV === "production");
}

function safeSegment(value) {
  const segment = String(value || "");
  if (!segment || segment === "." || segment === ".." || segment.includes("/") || segment.includes("\\") || segment.includes("\0")) {
    throw new Error("INVALID_STORAGE_KEY_SEGMENT");
  }
  return segment;
}

/**
 * The sole constructor for new durable object keys. Its environment comes
 * strictly from trusted server process configuration, never a request, adapter, or client.
 */
export function buildStorageKey(namespace, segments, env = process.env) {
  if (!WRITE_NAMESPACES.has(namespace)) throw new Error("INVALID_STORAGE_NAMESPACE");
  if (!Array.isArray(segments) || !segments.length) throw new Error("INVALID_STORAGE_KEY_SEGMENTS");

  assertNoContradictoryEnvironment(env);

  const stagingEnv = isStaging(env);
  const prodEnv = isProduction(env);

  if (!stagingEnv && !prodEnv) {
    throw new Error("AMBIGUOUS_STORAGE_ENVIRONMENT");
  }

  const key = [namespace, ...segments.map(safeSegment)].join("/");
  return stagingEnv ? `staging/${key}` : key;
}

/** Enforced at every R2 write boundary; reads intentionally use raw legacy keys. */
export function assertWritableStorageKey(storageKey, env = process.env) {
  const key = String(storageKey || "");
  if (!key || key.startsWith("/") || key.includes("\\") || key.split("/").some((part) => !part || part === "." || part === "..")) {
    throw new Error("INVALID_STORAGE_WRITE_KEY");
  }

  assertNoContradictoryEnvironment(env);

  const stagingEnv = isStaging(env);
  const prodEnv = isProduction(env);

  if (!stagingEnv && !prodEnv) {
    throw new Error("AMBIGUOUS_STORAGE_ENVIRONMENT");
  }

  if (stagingEnv && !key.startsWith("staging/")) throw new Error("STAGING_STORAGE_NAMESPACE_REQUIRED");
  if (prodEnv && key.startsWith("staging/")) throw new Error("CROSS_ENVIRONMENT_STORAGE_NAMESPACE");
  return key;
}

export function isStagingStorageEnvironment(env = process.env) {
  return isStaging(env);
}
