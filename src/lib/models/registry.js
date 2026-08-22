import { grokImagineImage2EditDefinition } from "./definitions/grok-imagine-image-2-edit.js";
import { seedanceSpicyVideoExtendDefinition } from "./definitions/seedance-2.5-spicy-video-extend-480p.js";
import { resolveAuthoritativeProviderSpec } from "./providerCatalog.js";
import { GENERATED_MODELS_BY_ID } from "./videoModelFactory.js";
import { ModelPlatformError, ERROR_CODES } from "./errors.js";

/**
 * 3-Layer Model Registry Architecture:
 * Local Doolphin Policy (productPolicy + businessPolicy + toProviderPayload)
 *                       +
 * Authoritative Provider Spec (from resolveAuthoritativeProviderSpec)
 *                       ↓
 * Resolved Model Definition
 */

/**
 * Legacy hand-authored definitions remain directly resolvable for compatibility,
 * but curated definitions own any overlapping portfolio ID. Studio listings are
 * constrained below to the DOCX-backed curated descriptors.
 */
const HAND_AUTHORED_DEFINITIONS = {
  [grokImagineImage2EditDefinition.productPolicy.id]: grokImagineImage2EditDefinition,
  [seedanceSpicyVideoExtendDefinition.productPolicy.id]: seedanceSpicyVideoExtendDefinition,
};

const LOCAL_MODEL_DEFINITIONS = Object.freeze({
  ...GENERATED_MODELS_BY_ID,
  ...HAND_AUTHORED_DEFINITIONS,
});

export async function getModel(modelId, { fetchImpl, env = process.env, forceRefresh = false } = {}) {
  if (!modelId || typeof modelId !== "string") return null;

  // 1. Resolve local Doolphin base definition by ID or legacy alias
  let localDef = LOCAL_MODEL_DEFINITIONS[modelId] || null;
  if (!localDef) {
    for (const def of Object.values(LOCAL_MODEL_DEFINITIONS)) {
      if (def.providerSpec.providerModelId === modelId || def.productPolicy.legacyAliases.includes(modelId)) {
        localDef = def;
        break;
      }
    }
  }

  const targetProviderModelId = localDef?.providerSpec?.providerModelId || modelId;

  // 2. Resolve Authoritative Provider Spec with explicit provenance
  const providerResolution = await resolveAuthoritativeProviderSpec(targetProviderModelId, {
    fetchImpl,
    env,
    forceRefresh,
  });

  const isCutoverEnabled = env.MODEL_PLATFORM_SEEDANCE_CUTOVER_ENABLED === "true";

  // Cutover fail-closed guard: Cutover mode requires source === "LIVE_PROVIDER" and stale === false
  //
  // NOTE: MODEL_PLATFORM_V1 is now the sole authoritative dispatch path at
  // the route level (src/app/api/preflight/route.js, generations/route.js
  // no longer have a legacy fallback) — but this specific guard is
  // deliberately left flag-scoped rather than made unconditional here.
  // Making it unconditional would also newly reject the bootstrap-catalog
  // fallback path for image-studio models (see
  // tests/models/phase1_infrastructure.test.js, "3-Layer Model Registry
  // studio filtering and lookups", which calls getModel() with no live
  // fetchImpl and asserts a successful BOOTSTRAP-sourced resolution) without
  // an accompanying decision about whether image models should also require
  // a live provider spec. That is a real, separate follow-up decision, not
  // a side effect of retiring the Seedance cutover flag — flagged for a
  // deliberate follow-up rather than bundled into this change.
  if (isCutoverEnabled && localDef && (providerResolution.provenance.source !== "LIVE_PROVIDER" || providerResolution.provenance.stale === true)) {
    throw new ModelPlatformError(
      ERROR_CODES.PROVIDER_SPEC_UNAVAILABLE,
      `Authoritative Provider Authority spec unavailable for cutover model '${modelId}'`
    );
  }

  const resolvedSpec = providerResolution.success ? providerResolution.spec : (localDef?.providerSpec || null);
  const provenance = providerResolution.provenance;

  // 3. Merge Authoritative Provider Authority spec over Doolphin local definition
  if (localDef && resolvedSpec) {
    const authoritativeSpec = {
      providerModelId: resolvedSpec.providerModelId || resolvedSpec.id || localDef.providerSpec.providerModelId,
      endpoint: resolvedSpec.endpoint || localDef.providerSpec.endpoint,
      category: resolvedSpec.category || localDef.providerSpec.category,
      description: resolvedSpec.description || localDef.providerSpec.description,
      cost: resolvedSpec.cost !== undefined ? resolvedSpec.cost : localDef.providerSpec.cost,
      dynamicPricing: Boolean(resolvedSpec.dynamic_pricing ?? resolvedSpec.dynamicPricing ?? localDef.providerSpec.dynamicPricing),
      estimateEndpoint: resolvedSpec.estimateEndpoint || resolvedSpec.estimate_endpoint || localDef.providerSpec.estimateEndpoint,
      inputSchema: resolvedSpec.inputSchema || resolvedSpec.input_schema || localDef.providerSpec.inputSchema,
      outputSchema: resolvedSpec.outputSchema || resolvedSpec.output_schema || localDef.providerSpec.outputSchema,
      provenance,
    };

    return {
      ...localDef,
      providerSpec: authoritativeSpec,
    };
  }

  // 4. Dynamic lookup fallback for unregistered provider models
  if (providerResolution.success && providerResolution.spec) {
    const spec = providerResolution.spec;
    return {
      providerSpec: {
        ...spec,
        provenance,
      },
      productPolicy: {
        id: spec.providerModelId || spec.id,
        displayName: spec.providerModelId || spec.id,
        studios: ["explore"],
        enabled: true,
        legacyAliases: [],
        curated: false,
      },
      capabilityDescriptor: Object.freeze({
        providerId: spec.providerModelId || spec.id,
        confidence: "LOW",
        dispatchable: false,
        adapterRevision: "generic-prompt-only-v1",
      }),
      businessPolicy: {
        targetContributionMarginBps: 3000,
        variableInfraCostMicroUsd: 10000n,
        minimumCredits: 1,
      },
      toProviderPayload(input) {
        return { prompt: input.prompt };
      },
    };
  }

  return null;
}

export async function listModelsByStudio(studio) {
  const matches = [];
  const curatedOnly = ["video-studio", "product-studio", "app-studio"].includes(studio);
  for (const def of Object.values(LOCAL_MODEL_DEFINITIONS)) {
    if (
      def.productPolicy.enabled &&
      def.productPolicy.studios.includes(studio) &&
      (!curatedOnly || (def.productPolicy.curated && def.productPolicy.studioReady && def.capabilityDescriptor?.dispatchable))
    ) {
      matches.push(def);
    }
  }
  return matches.sort((a, b) => a.productPolicy.displayOrder - b.productPolicy.displayOrder);
}
