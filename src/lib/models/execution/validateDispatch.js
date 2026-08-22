import crypto from "crypto";
import { resolveTrustedExecutionUrl } from "./muapiExecutor.js";
import { validateProviderModelIdentityBinding } from "../cutoverEligibility.js";
import { ModelPlatformError, ERROR_CODES } from "../errors.js";

/**
 * Pure production helper for MODEL_PLATFORM_V1 prepared plan dispatch validation.
 * Enforces all cutover pre-dispatch invariants before allowing paid provider POST.
 */
export function validateModelPlatformPreparedQuoteForDispatch({
  quote,
  request,
  routingSnapshot,
  now = new Date(),
}) {
  if (!routingSnapshot || routingSnapshot.authority !== "MODEL_PLATFORM_V1") {
    throw new ModelPlatformError(ERROR_CODES.INVALID_PREPARED_PLAN, "Quote authority is not MODEL_PLATFORM_V1");
  }

  const preparedPlan = routingSnapshot.modelPlatformPreparedPlan;
  if (!preparedPlan) {
    throw new ModelPlatformError(ERROR_CODES.INVALID_PREPARED_PLAN, "Prepared execution plan is missing");
  }

  // Defect 3: Mandatory authorityVersion check
  const authorityVersion = preparedPlan.authorityVersion || preparedPlan.preparedPlanVersion;
  if (authorityVersion !== "MODEL_PLATFORM_PREPARED_V1") {
    throw new ModelPlatformError(
      ERROR_CODES.INVALID_PREPARED_PLAN,
      `Prepared plan authorityVersion '${authorityVersion}' is invalid; expected 'MODEL_PLATFORM_PREPARED_V1'`
    );
  }

  // A1. providerSpecSource === LIVE_PROVIDER
  const specSource = preparedPlan.provenance?.source || preparedPlan.providerSpecSource;
  if (specSource !== "LIVE_PROVIDER") {
    throw new ModelPlatformError(ERROR_CODES.PROVENANCE_NOT_LIVE, "MODEL_PLATFORM_V1 quote requires LIVE_PROVIDER spec source");
  }

  // Defect 3: Tighten stale provenance checks (missing stale field = fail closed, contradictory fields = fail closed)
  const provStale = preparedPlan.provenance?.stale;
  const rootStale = preparedPlan.providerStale;

  if (provStale === undefined && rootStale === undefined) {
    throw new ModelPlatformError(ERROR_CODES.PROVENANCE_STALE, "MODEL_PLATFORM_V1 quote has missing providerStale metadata");
  }

  if (provStale === true || rootStale === true) {
    throw new ModelPlatformError(ERROR_CODES.PROVENANCE_STALE, "MODEL_PLATFORM_V1 quote cannot use a stale provider spec");
  }

  if (provStale !== undefined && rootStale !== undefined && provStale !== rootStale) {
    throw new ModelPlatformError(ERROR_CODES.PROVENANCE_STALE, "MODEL_PLATFORM_V1 quote has contradictory providerStale metadata");
  }

  // A3. prepared-plan expiration check
  if (preparedPlan.expiresAt && new Date(preparedPlan.expiresAt) <= now) {
    throw new ModelPlatformError(ERROR_CODES.PREPARED_PLAN_EXPIRED, "MODEL_PLATFORM_V1 prepared plan has expired");
  }

  // A4. signed-asset expiration safety check
  if (preparedPlan.earliestSignedAssetExpiry && new Date(preparedPlan.earliestSignedAssetExpiry).getTime() - 5 * 60 * 1000 <= now.getTime()) {
    throw new ModelPlatformError(ERROR_CODES.SIGNED_ASSETS_EXPIRED, "Signed asset URLs expire too soon for prepared plan execution");
  }

  // A5. SHA256(providerPayloadJson) === providerPayloadHash
  const calculatedHash = crypto.createHash("sha256").update(preparedPlan.providerPayloadJson).digest("hex");
  if (preparedPlan.providerPayloadHash !== calculatedHash) {
    throw new ModelPlatformError(ERROR_CODES.HASH_TAMPERED, "Provider payload hash mismatch between JSON content and stored hash");
  }

  // A6. providerPayloadHash === routingSnapshot.providerPayloadFingerprint
  if (preparedPlan.providerPayloadHash !== routingSnapshot.providerPayloadFingerprint) {
    throw new ModelPlatformError(ERROR_CODES.HASH_TAMPERED, "Prepared plan payload fingerprint mismatch with routing snapshot");
  }

  // A7. quote.internalCreditsToReserve === workflowPricing.quotedCredits
  if (quote.internalCreditsToReserve !== preparedPlan.workflowPricing.quotedCredits) {
    throw new ModelPlatformError(ERROR_CODES.CREDIT_MISMATCH, "Quote reserved credits does not match prepared plan workflow pricing");
  }

  // A8. request outputCount === workflowPricing.outputCount
  if (request.settings.outputCount !== preparedPlan.workflowPricing.outputCount) {
    throw new ModelPlatformError(ERROR_CODES.OUTPUT_COUNT_MISMATCH, "Request outputCount does not match prepared plan workflow pricing");
  }

  // A9. quote.pricingRevision === workflowPricing.pricingRevisionId
  if (quote.pricingRevision !== preparedPlan.workflowPricing.pricingRevisionId) {
    throw new ModelPlatformError(ERROR_CODES.PRICING_REVISION_MISMATCH, "Quote pricing revision does not match prepared plan pricing revision");
  }

  // A10. quote.registryRevision === providerSpecHash
  if (quote.registryRevision !== preparedPlan.providerSpecHash) {
    throw new ModelPlatformError(ERROR_CODES.REGISTRY_REVISION_MISMATCH, "Quote registry revision does not match prepared plan providerSpecHash");
  }

  // New Model Platform quotes bind both the reviewed adapter and capability
  // descriptor revisions. A deploy between quote and submit must not silently
  // attribute frozen payload bytes to a different implementation.
  const adapterRevision = preparedPlan.adapterRevision;
  const capabilityRevision = preparedPlan.capabilityRevision;
  if (!adapterRevision || !capabilityRevision) {
    throw new ModelPlatformError(ERROR_CODES.REGISTRY_REVISION_MISMATCH, "Prepared plan is missing adapter or capability revision binding");
  }
  if (adapterRevision !== quote.adapterVersion || adapterRevision !== routingSnapshot.model?.adapterVersion) {
    throw new ModelPlatformError(ERROR_CODES.REGISTRY_REVISION_MISMATCH, "Quote adapter revision does not match the prepared plan and capability snapshot");
  }
  if (capabilityRevision !== routingSnapshot.model?.capabilityRevision) {
    throw new ModelPlatformError(ERROR_CODES.REGISTRY_REVISION_MISMATCH, "Quote capability revision does not match the prepared plan");
  }

  // A11. provider model identity binding validated
  const validBinding = validateProviderModelIdentityBinding({
    requestedModelId: quote.selectedModelId,
    returnedProviderModelId: preparedPlan.providerModelId,
    canonicalModelId: preparedPlan.canonicalModelId,
  });
  if (!validBinding) {
    throw new ModelPlatformError(ERROR_CODES.MODEL_IDENTITY_MISMATCH, "Returned providerModelId does not match requested providerModelId");
  }

  // A13. trusted MU API endpoint validation
  const executionEndpoint = resolveTrustedExecutionUrl(preparedPlan.providerEndpoint);

  return {
    providerPayloadJson: preparedPlan.providerPayloadJson,
    providerPayloadHash: preparedPlan.providerPayloadHash,
    providerEndpoint: executionEndpoint,
    providerSpecHash: preparedPlan.providerSpecHash,
    pricingRevisionId: preparedPlan.workflowPricing.pricingRevisionId,
    adapterRevision,
    capabilityRevision,
    workflowPricing: preparedPlan.workflowPricing,
  };
}
