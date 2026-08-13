/** @typedef {'IMAGE'|'VIDEO'} GenerationMediaType */
/** @typedef {'DISABLED_PENDING_STAGING_POC'|'STAGING_ENABLED'|'DISABLED'} DeploymentState */
/** @typedef {'ATOMIC_JOB'|'PER_VARIANT'} SettlementMode */

/**
 * Runtime shape shared by all future media-model definitions.  Definitions are
 * declarative; durable jobs, billing, R2, QA execution and reconciliation are
 * deliberately owned by shared services rather than by a model adapter.
 */
export function defineGenerationModel(definition) {
  if (!definition?.id || !definition?.mediaType || !definition?.adapter) throw new Error("Invalid generation model definition");
  return Object.freeze({
    ...definition,
    deployments: Object.freeze({
      staging: "DISABLED_PENDING_STAGING_POC",
      production: "DISABLED",
      ...(definition.deployments || {}),
    }),
  });
}

export function deploymentEnvironment(env = process.env) {
  // DOOLPHIN_ENV is server-owned deployment configuration. A request cannot
  // influence this decision through headers, JSON, query parameters, or UI.
  // A Vercel Preview is not authority to spend sandbox/provider capacity. An
  // explicit Doolphin assertion is mandatory, and a Production Vercel context
  // is an additional hard stop even if misconfigured.
  if (env.DOOLPHIN_ENV === "staging" && env.VERCEL_ENV !== "production") return "staging";
  return "production";
}

export function isStagingEnvironment(env = process.env) {
  return deploymentEnvironment(env) === "staging";
}

export function deploymentState(model, env = process.env) {
  return model.deployments[deploymentEnvironment(env)] || "DISABLED";
}

export function canGenerate(model, env = process.env) {
  // Production remains blocked even if a malformed environment variable says
  // otherwise. Model enablement requires an explicit future staging POC gate.
  return deploymentEnvironment(env) === "staging" && deploymentState(model, env) === "STAGING_ENABLED";
}
