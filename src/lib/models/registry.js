import { grokImagineImage2EditDefinition } from "./definitions/grok-imagine-image-2-edit.js";
import { seedanceSpicyVideoExtendDefinition } from "./definitions/seedance-2.5-spicy-video-extend-480p.js";
import { seedance2OmniReferenceFastDefinition } from "./definitions/seedance-2-omni-reference-fast.js";
import { getProviderCatalog } from "./catalogStore.js";

/**
 * 3-Layer Model Registry Architecture:
 * - Layer 1: In-memory static catalog & golden definitions (bootstrap)
 * - Layer 2: Provider Authority specs (from catalogStore resolution)
 * - Layer 3: Application product policies & legacy alias mappings
 */

const LOCAL_MODEL_DEFINITIONS = Object.freeze({
  [grokImagineImage2EditDefinition.productPolicy.id]: grokImagineImage2EditDefinition,
  [seedanceSpicyVideoExtendDefinition.productPolicy.id]: seedanceSpicyVideoExtendDefinition,
  [seedance2OmniReferenceFastDefinition.productPolicy.id]: seedance2OmniReferenceFastDefinition,
});

export async function getModel(modelId) {
  if (!modelId || typeof modelId !== "string") return null;

  // 1. Direct match on local definitions
  if (LOCAL_MODEL_DEFINITIONS[modelId]) {
    return LOCAL_MODEL_DEFINITIONS[modelId];
  }

  // 2. Check legacy alias resolution
  for (const def of Object.values(LOCAL_MODEL_DEFINITIONS)) {
    if (def.productPolicy.legacyAliases.includes(modelId)) {
      return def;
    }
  }

  // 3. Dynamic lookup from 3-level catalogStore
  const catalog = await getProviderCatalog();
  if (catalog && Array.isArray(catalog.models)) {
    const entry = catalog.models.find(
      (m) => m.providerModelId === modelId || m.id === modelId
    );
    if (entry) {
      return {
        providerSpec: entry,
        productPolicy: {
          id: entry.providerModelId,
          displayName: entry.providerModelId,
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
