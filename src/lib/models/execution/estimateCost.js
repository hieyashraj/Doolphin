import { getMuapiApiKey } from "../../generation/muapiCredentials.js";
import { calculateCommercialCreditQuote, parseUsdToMicroUsdConservatively } from "../pricingIntegration.js";
import { canonicalJsonSerialize } from "./prepareExecutionPlan.js";
import { ERROR_CODES } from "../errors.js";
import { assertLiveCostWithinVerifiedBand, assertStaticCostMatchesCatalog } from "../verifiedCosts.js";
import {
  assertLiveCostWithinDocumentedCeiling,
  assertModelCostIsBoundable,
  getDocumentedCeilingUsd,
} from "../documentedCostSurface.js";

const DEFAULT_ESTIMATE_TIMEOUT_MS = 3000;

export async function estimateAuthoritativeModelCost({
  modelDefinition,
  normalizedInput,
  alreadyPreparedPayload,
  alreadyPreparedPayloadJson,
  fetchImpl = fetch,
  env = process.env,
  timeoutMs = DEFAULT_ESTIMATE_TIMEOUT_MS,
} = {}) {
  if (!modelDefinition) {
    return {
      priced: false,
      code: ERROR_CODES.PRICING_UNAVAILABLE,
      reason: "Model definition is required for cost estimation",
    };
  }

  const { providerSpec, businessPolicy } = modelDefinition;
  const providerModelId = providerSpec.providerModelId || providerSpec.provider_model_id;

  // ADMISSION GATE — runs before any pricing work, including the network call.
  //
  // Some models cannot have a maximum cost at all. The pricing document shows
  // two shapes:
  //
  //   * billed on the duration of user-supplied media, e.g.
  //     kling-v2.6-pro-motion-control at "$0.145/sec of input video", or
  //     seedance-2.5-omni-reference billed on "output + every reference video's
  //     duration" across up to 10 clips. Nothing in the request bounds those
  //     durations, so a caller can point at a 10-minute file and multiply the
  //     bill arbitrarily. That is a user-controllable spend amplifier.
  //
  //   * price-varying parameters whose prices the document omits, so a provider
  //     figure cannot be cross-checked against anything.
  //
  // Both are refused here rather than mitigated downstream. An estimate could be
  // obtained for them, but it would be a number with no independent bound, and
  // the whole point of this layer is that no unvalidated figure reaches a
  // customer's balance.
  const boundable = assertModelCostIsBoundable({ providerModelId });
  if (!boundable.ok) {
    return {
      priced: false,
      code: ERROR_CODES.MODEL_COST_NOT_BOUNDABLE,
      reason: boundable.reason,
      pricingClass: boundable.pricingClass,
      unboundedEvidence: boundable.evidence ?? [],
      providerModelId,
    };
  }

  // Primary pricing-mode signal: dynamic_pricing boolean
  const isDynamic = Boolean(providerSpec.dynamicPricing ?? providerSpec.dynamic_pricing);

  // 1. Fixed-Price Strategy: dynamic_pricing === false with valid provider cost
  if (!isDynamic) {
    const rawAmount = providerSpec.cost?.amount ?? providerSpec.cost?.cost ?? providerSpec.cost;

    if (rawAmount === null || rawAmount === undefined) {
      return {
        priced: false,
        code: ERROR_CODES.PRICING_UNAVAILABLE,
        reason: `Model '${modelDefinition.productPolicy.id}' is configured with fixed pricing (dynamic_pricing: false), but has missing cost metadata`,
      };
    }

    let unitCostUsd;
    try {
      unitCostUsd = Number(rawAmount);
      if (isNaN(unitCostUsd) || unitCostUsd < 0) throw new Error();
    } catch {
      return {
        priced: false,
        code: ERROR_CODES.PRICING_UNAVAILABLE,
        reason: `Model '${modelDefinition.productPolicy.id}' is configured with fixed pricing (dynamic_pricing: false), but has invalid cost metadata`,
      };
    }

    // ── BILLING BASIS: dynamic_pricing is the ONLY valid signal ─────────────
    //
    // An earlier version of this code parsed `cost.strategy` as a billing-basis
    // enum ("fixed_cost" / "per_second") and multiplied by duration. That was
    // built on a wrong premise. MuAPI's real `cost_strategy` field is an OPAQUE
    // internal identifier — the live catalog contains values like
    // "seedance-2.5-4k-video", "veo3.1-fast-video" and "creatify-lipsync". It is
    // not an enum, carries no billing semantics, and must never be parsed.
    //
    // MuAPI's actual contract, confirmed against the live `GET /api/v1/models`
    // response (every dynamic model has an estimate endpoint; every fixed one
    // has `estimate_endpoint: null`):
    //
    //   dynamic_pricing === false -> `cost` IS the exact USD price per call.
    //   dynamic_pricing === true  -> price varies with the request and is only
    //                                knowable from the estimate-cost endpoint.
    //
    // Duration- and resolution-dependent pricing is therefore real, but MuAPI
    // resolves it server-side. Doolphin must never reconstruct it arithmetically.
    //
    // A definition that still carries a duration-scaling marker is a mis-authored
    // leftover: honouring it would multiply an already-total price by duration
    // (over-charging the customer), and ignoring it would risk billing a
    // per-unit rate as a total (under-charging us). Neither is acceptable, so
    // fail closed and make the developer fix the definition.
    const declaredStrategy = String(providerSpec.cost?.strategy || "").toLowerCase();
    const DURATION_SCALING_MARKERS = new Set(["per_second", "per_sec", "per_minute", "per_frame"]);
    if (DURATION_SCALING_MARKERS.has(declaredStrategy)) {
      return {
        priced: false,
        code: ERROR_CODES.PRICING_UNAVAILABLE,
        reason: `Model '${modelDefinition.productPolicy.id}' declares a duration-scaling billing basis ('${declaredStrategy}') on a fixed-price path. MuAPI does not publish per-unit rates: dynamic_pricing=false means 'cost' is the exact price per call. Remove the strategy marker or mark the model dynamic so its estimate-cost endpoint is used.`,
      };
    }

    // Independent cross-check against MuAPI's own catalog BEFORE billing a
    // hardcoded number. This is the path where a hand-typed cost or a wrong
    // pricing-mode flag turns straight into a money leak, because no provider
    // call happens to correct it.
    const staticCheck = assertStaticCostMatchesCatalog({
      providerModelId: providerSpec.providerModelId || providerSpec.provider_model_id,
      staticCostUsd: unitCostUsd,
    });
    if (!staticCheck.ok) {
      return {
        priced: false,
        code: ERROR_CODES.PRICING_UNAVAILABLE,
        reason: staticCheck.reason,
        catalogCostUsd: staticCheck.catalogCostUsd,
        catalogPricingMode: staticCheck.catalogPricingMode,
      };
    }

    // Second, independent cross-check: does the hardcoded figure sit inside the
    // published price surface? assertStaticCostMatchesCatalog above compares
    // against the provider catalog's DEFAULT cost, which says nothing about the
    // maximum. A definition claiming a flat $0.30 for a model documented up to
    // $1.50 would pass that check and still under-bill every non-default request.
    const staticCeilingCheck = assertLiveCostWithinDocumentedCeiling({
      providerModelId,
      liveCostUsd: unitCostUsd,
    });
    if (!staticCeilingCheck.ok) {
      return {
        priced: false,
        code: staticCeilingCheck.code,
        reason: staticCeilingCheck.reason,
        liveCostUsd: staticCeilingCheck.liveCostUsd,
        documentedCeilingUsd: staticCeilingCheck.ceilingUsd,
      };
    }

    const providerCostUsd = unitCostUsd;

    const quote = calculateCommercialCreditQuote({
      providerCostUsd,
      variableInfraCostMicroUsd: businessPolicy?.variableInfraCostMicroUsd || 0n,
    });

    return {
      ...quote,
      strategy: "provider_fixed_cost",
      isDynamic: false,
      modelId: modelDefinition.productPolicy.id,
      providerCostUsd,
      unitCostUsd,
      // Recorded verbatim for audit, never interpreted.
      providerCostStrategyLabel: providerSpec.cost?.strategy ?? null,
      catalogCrossChecked: staticCheck.checked === true,
      catalogCostUsd: staticCheck.catalogCostUsd ?? null,
      billedDurationSeconds: null,
      estimatedAt: new Date().toISOString(),
    };
  }

  // 2. Dynamic-Pricing Strategy: Require authoritative MU API estimate endpoint
  const estimateEndpoint = providerSpec.estimateEndpoint;
  if (!estimateEndpoint) {
    return {
      priced: false,
      code: ERROR_CODES.PRICING_UNAVAILABLE,
      reason: `Model '${modelDefinition.productPolicy.id}' requires dynamic cost estimation, but no estimateEndpoint is configured`,
    };
  }

  // Resolve EXACT canonical provider payload JSON body
  let requestBodyString = alreadyPreparedPayloadJson;
  if (!requestBodyString) {
    let payload = alreadyPreparedPayload;
    if (!payload) {
      try {
        payload = modelDefinition.toProviderPayload(normalizedInput);
      } catch (error) {
        return {
          priced: false,
          code: ERROR_CODES.PRICING_UNAVAILABLE,
          reason: `Failed to construct provider payload for cost estimation: ${error.message}`,
        };
      }
    }
    requestBodyString = canonicalJsonSerialize(payload);
  }

  let headers = {
    "Content-Type": "application/json",
    Accept: "application/json",
  };

  try {
    const apiKey = getMuapiApiKey(env);
    if (apiKey && !apiKey.includes("placeholder")) {
      headers["x-api-key"] = apiKey;
    }
  } catch {
    // Credentials optional for public cost estimation endpoints
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetchImpl(estimateEndpoint, {
      method: "POST",
      headers,
      body: requestBodyString,
      signal: controller.signal,
      redirect: "error",
    });
    clearTimeout(timer);

    if (!response.ok) {
      const errorBody = await response.json().catch(() => ({}));
      return {
        priced: false,
        code: ERROR_CODES.PRICING_UNAVAILABLE,
        reason: `MU API estimate-cost HTTP ${response.status}: ${errorBody.error || errorBody.message || "Unknown pricing error"}`,
      };
    }

    const payload = await response.json();
    const rawCost = payload.cost ?? payload.estimated_cost ?? payload.amount ?? payload.amount_usd;

    if (rawCost === undefined || rawCost === null) {
      return {
        priced: false,
        code: ERROR_CODES.PRICING_UNAVAILABLE,
        reason: "MU API estimate-cost returned missing cost property",
      };
    }

    const providerCostMicroUsd = parseUsdToMicroUsdConservatively(rawCost);
    const providerCostUsd = Number(providerCostMicroUsd) / 1_000_000;

    // INDEPENDENT CROSS-CHECK before anything is billed. The provider is the
    // pricing authority, but a single unchecked source can silently under-charge
    // us forever if it regresses (a units change, a $0.00 for a paid model, a
    // malformed-but-parseable value). Compare against an independently sourced
    // verified snapshot and fail closed on implausible divergence rather than
    // charging a figure nobody has validated.
    // The catalog baseline for a dynamic model is a representative base at an
    // unspecified duration, so the upper bound is scaled by how much longer this
    // render is than the model's own shortest supported duration. Without that,
    // a legitimate 30s render of a ~5s-based model would be rejected.
    const durationSchema = providerSpec.inputSchema?.properties?.duration;
    const referenceDurationSeconds =
      Number(durationSchema?.default) || Number(durationSchema?.minimum) || null;

    // When the pricing document records a real maximum for this model, it
    // supersedes the snapshot's heuristic upper bound. The heuristic multiplies a
    // DEFAULT cost by a fixed multiple, which misjudges both directions: a
    // legitimate 4k render of veo3.1-lite costs 5x its 720p default and would be
    // rejected, while a model with a genuinely narrow price surface gets a band
    // 4x wider than reality. Passing the documented ceiling replaces guesswork
    // with the published number.
    const documentedCeilingUsd = getDocumentedCeilingUsd(providerModelId);

    const drift = assertLiveCostWithinVerifiedBand({
      providerModelId,
      liveCostUsd: providerCostUsd,
      requestedDurationSeconds: Number(normalizedInput?.duration) || null,
      referenceDurationSeconds,
      documentedCeilingUsd,
    });
    if (!drift.ok) {
      return {
        priced: false,
        code: drift.code,
        reason: drift.reason,
        liveCostUsd: drift.liveCostUsd,
        verifiedCostUsd: drift.verifiedCostUsd,
      };
    }

    // Upper bound from the pricing document itself. Independent of the snapshot
    // band above: that one guards against the snapshot drifting, this one
    // guards against the provider exceeding its own published price surface.
    const ceilingCheck = assertLiveCostWithinDocumentedCeiling({
      providerModelId,
      liveCostUsd: providerCostUsd,
    });
    if (!ceilingCheck.ok) {
      return {
        priced: false,
        code: ceilingCheck.code,
        reason: ceilingCheck.reason,
        liveCostUsd: ceilingCheck.liveCostUsd,
        documentedCeilingUsd: ceilingCheck.ceilingUsd,
      };
    }

    const quote = calculateCommercialCreditQuote({
      providerCostMicroUsd,
      variableInfraCostMicroUsd: businessPolicy?.variableInfraCostMicroUsd || 0n,
    });

    return {
      ...quote,
      strategy: payload.strategy || "estimate_cost_dynamic",
      isDynamic: true,
      modelId: modelDefinition.productPolicy.id,
      providerCostUsd,
      // Auditability: record whether an independent cross-check actually ran and
      // what it compared against, so a later investigation can distinguish
      // "verified in band" from "no snapshot available".
      verifiedCostCrossChecked: drift.checked === true,
      verifiedCostUsd: drift.verifiedCostUsd ?? null,
      // Whether the published price surface bounded this quote, and what the
      // bound was. Distinguishes "within a documented maximum" from "no
      // documented maximum exists for this model".
      documentedCeilingCrossChecked: ceilingCheck.checked === true,
      documentedCeilingUsd: ceilingCheck.ceilingUsd ?? null,
      estimatedAt: new Date().toISOString(),
    };
  } catch (error) {
    clearTimeout(timer);
    return {
      priced: false,
      code: ERROR_CODES.PRICING_UNAVAILABLE,
      reason: error.name === "AbortError" ? `MU API cost estimation timed out after ${timeoutMs}ms` : `Network or estimation exception: ${error.message}`,
    };
  }
}
