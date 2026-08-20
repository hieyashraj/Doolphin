export class ModelPlatformError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "ModelPlatformError";
    this.code = code;
    this.details = details;
  }
}

export const ERROR_CODES = Object.freeze({
  MODEL_NOT_FOUND: "MODEL_NOT_FOUND",
  MODEL_DISABLED: "MODEL_DISABLED",
  INVALID_MODEL_INPUT: "INVALID_MODEL_INPUT",
  PROVIDER_SPEC_UNAVAILABLE: "PROVIDER_SPEC_UNAVAILABLE",
  PRICING_UNAVAILABLE: "PRICING_UNAVAILABLE",
  /**
   * The model's maximum cost cannot be bounded before dispatch, so it must not
   * be sold. Distinct from PRICING_UNAVAILABLE because that signals a transient
   * outage worth retrying, whereas this is a permanent property of the model:
   * retrying changes nothing, and the caller should not be told to try again.
   */
  MODEL_COST_NOT_BOUNDABLE: "MODEL_COST_NOT_BOUNDABLE",
  /**
   * The model is real and priced but not released for sale yet. Distinct from
   * MODEL_COST_NOT_BOUNDABLE because it is a product state the UI should surface
   * as "coming soon", not a safety refusal.
   */
  MODEL_COMING_SOON: "MODEL_COMING_SOON",
  INVALID_PREPARED_PLAN: "INVALID_PREPARED_PLAN",
  PROVIDER_AUTH_UNAVAILABLE: "PROVIDER_AUTH_UNAVAILABLE",
  PROVIDER_REQUEST_FAILED: "PROVIDER_REQUEST_FAILED",
  PROVIDER_RESPONSE_INVALID: "PROVIDER_RESPONSE_INVALID",
  UNTRUSTED_ENDPOINT_REJECTED: "UNTRUSTED_ENDPOINT_REJECTED",
  PROVENANCE_NOT_LIVE: "PROVENANCE_NOT_LIVE",
  PROVENANCE_STALE: "PROVENANCE_STALE",
  PREPARED_PLAN_EXPIRED: "PREPARED_PLAN_EXPIRED",
  SIGNED_ASSETS_EXPIRED: "SIGNED_ASSETS_EXPIRED",
  HASH_TAMPERED: "HASH_TAMPERED",
  CREDIT_MISMATCH: "CREDIT_MISMATCH",
  OUTPUT_COUNT_MISMATCH: "OUTPUT_COUNT_MISMATCH",
  PRICING_REVISION_MISMATCH: "PRICING_REVISION_MISMATCH",
  REGISTRY_REVISION_MISMATCH: "REGISTRY_REVISION_MISMATCH",
  MODEL_IDENTITY_MISMATCH: "MODEL_IDENTITY_MISMATCH",
});
