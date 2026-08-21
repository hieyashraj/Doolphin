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

/**
 * Whether a model may be offered to a user in the current environment.
 *
 * A model is generatable when the state for THIS environment explicitly says so:
 *   "STAGING_ENABLED" — cleared for the staging environment
 *   "ENABLED"         — cleared for production (contract + pricing verified)
 * Anything else (notably the "DISABLED" / "DISABLED_PENDING_STAGING_POC"
 * defaults) is refused, so enablement stays an explicit, reviewed decision per
 * model rather than an environment-wide switch.
 *
 * HISTORY: this used to hard-require `deploymentEnvironment === "staging"`, which
 * meant EVERY image model was unavailable on the production deployment — the
 * Image Studio model dropdown rendered "No model available" and the Generate
 * button could never enable. Production is now a first-class enabled state,
 * granted per model in the registry.
 */
export function canGenerate(model, env = process.env) {
  return ["STAGING_ENABLED", "ENABLED"].includes(deploymentState(model, env));
}
