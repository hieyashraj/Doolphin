import { grokImagineImage2EditDefinition } from "./definitions/grok-imagine-image-2-edit.js";
import { seedanceSpicyVideoExtendDefinition } from "./definitions/seedance-2.5-spicy-video-extend-480p.js";
import { seedance2OmniReferenceFastDefinition } from "./definitions/seedance-2-omni-reference-fast.js";
import { getProviderCatalog } from "./catalogStore.js";
import { computeCatalogHash } from "./providerCatalog.js";

/**
 * 3-Layer Model Registry Architecture:
 * Local Doolphin Policy (productPolicy + businessPolicy + toProviderPayload)
 *                       +
 * Authoritative Provider Spec (from catalogStore resolution)
 *                       ↓
 * Resolved Model Definition
 */

const LOCAL_MODEL_DEFINITIONS = Object.freeze({
  [grokImagineImage2EditDefinition.productPolicy.id]: grokImagineImage2EditDefinition,
  [seedanceSpicyVideoExtendDefinition.productPolicy.id]: seedanceSpicyVideoExtendDefinition,
  [seedance2OmniReferenceFastDefinition.productPolicy.id]: seedance2OmniReferenceFastDefinition,
});

export async function getModel(modelId) {
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

  // 2. Fetch authoritative provider catalog
  const catalogRes = await getProviderCatalog();
  const catalogData = catalogRes?.catalog;
  const catalogModels = Array.isArray(catalogData?.models) ? catalogData.models : [];

  const targetProviderModelId = localDef?.providerSpec?.providerModelId || modelId;
  const catalogEntry = catalogModels.find(
    (m) => m.providerModelId === targetProviderModelId || m.id === targetProviderModelId
  );

  const catalogProvenance = catalogData?.provenance || {
    source: catalogRes?.source || "BOOTSTRAP",
    loadedAt: new Date().toISOString(),
    providerFetchedAt: null,
    validationStatus: "VALID",
    stale: true,
  };

  // 3. If local definition exists, merge authoritative Provider Authority spec over local spec
  if (localDef) {
    const authoritativeSpec = catalogEntry ? {
      providerModelId: catalogEntry.providerModelId || catalogEntry.id || localDef.providerSpec.providerModelId,
      endpoint: catalogEntry.endpoint || localDef.providerSpec.endpoint,
      category: catalogEntry.category || localDef.providerSpec.category,
      description: catalogEntry.description || localDef.providerSpec.description,
      cost: catalogEntry.cost !== undefined ? catalogEntry.cost : localDef.providerSpec.cost,
      dynamicPricing: Boolean(catalogEntry.dynamic_pricing ?? catalogEntry.dynamicPricing ?? localDef.providerSpec.dynamicPricing),
      estimateEndpoint: catalogEntry.estimateEndpoint || catalogEntry.estimate_endpoint || localDef.providerSpec.estimateEndpoint,
      inputSchema: catalogEntry.inputSchema || catalogEntry.input_schema || localDef.providerSpec.inputSchema,
      outputSchema: catalogEntry.outputSchema || catalogEntry.output_schema || localDef.providerSpec.outputSchema,
      provenance: catalogProvenance,
    } : {
      ...localDef.providerSpec,
      provenance: catalogProvenance,
    };

    return {
      ...localDef,
      providerSpec: authoritativeSpec,
    };
  }

  // 4. Fallback: Dynamic lookup from catalog for unregistered models
  if (catalogEntry) {
    return {
      providerSpec: {
        ...catalogEntry,
        provenance: catalogProvenance,
      },
      productPolicy: {
        id: catalogEntry.providerModelId || catalogEntry.id,
        displayName: catalogEntry.providerModelId || catalogEntry.id,
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
