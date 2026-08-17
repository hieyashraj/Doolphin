import { grokImagineImage2EditDefinition } from "./definitions/grok-imagine-image-2-edit.js";
import { seedanceSpicyVideoExtendDefinition } from "./definitions/seedance-2.5-spicy-video-extend-480p.js";
import { seedance2OmniReferenceFastDefinition } from "./definitions/seedance-2-omni-reference-fast.js";
import { resolveAuthoritativeProviderSpec } from "./providerCatalog.js";
import { ModelPlatformError, ERROR_CODES } from "./errors.js";

/**
 * 3-Layer Model Registry Architecture:
 * Local Doolphin Policy (productPolicy + businessPolicy + toProviderPayload)
 *                       +
 * Authoritative Provider Spec (from resolveAuthoritativeProviderSpec)
 *                       ↓
 * Resolved Model Definition
 */

const LOCAL_MODEL_DEFINITIONS = Object.freeze({
  [grokImagineImage2EditDefinition.productPolicy.id]: grokImagineImage2EditDefinition,
  [seedanceSpicyVideoExtendDefinition.productPolicy.id]: seedanceSpicyVideoExtendDefinition,
  [seedance2OmniReferenceFastDefinition.productPolicy.id]: seedance2OmniReferenceFastDefinition,
});

export async function getModel(modelId, { fetchImpl, env = process.env, forceRefresh = false } = {}) {
  if (!modelId || typeof modelId !== "string") return null;

  // 1. Resolve local Doolphin base definition by ID or legacy alias
  let localDef = LOCAL_MODEL_DEFINITIONS[modelId] || null;
  if (!localDef) {
    for (const def of Object.values(LOCAL_MODEL_DEFINITIONS)) {
      if (def.productPolicy.legacyAliases.includes(modelId)) {
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

  // Cutover fail-closed guard: Cutover mode refuses LOCAL_FALLBACK for authoritative model cutover
  if (isCutoverEnabled && localDef && providerResolution.provenance.source === "LOCAL_FALLBACK") {
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
      },
      businessPolicy: {
        targetContributionMarginBps: 3000,
        variableInfraCostMicroUsd: 10000n,
        minimumCredits: 5,
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
  for (const def of Object.values(LOCAL_MODEL_DEFINITIONS)) {
    if (def.productPolicy.enabled && def.productPolicy.studios.includes(studio)) {
      matches.push(def);
    }
  }
  return matches.sort((a, b) => a.productPolicy.displayOrder - b.productPolicy.displayOrder);
}
