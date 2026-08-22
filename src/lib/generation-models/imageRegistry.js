import gptImage2I2I from "./image-definitions/gpt-image-2-image-to-image.js";
import gptImage2T2I from "./image-definitions/gpt-image-2-text-to-image.js";
import seedream5Pro from "./image-definitions/seedream-5-pro.js";
import seedreamV45 from "./image-definitions/seedream-v45.js";
import seedreamV4 from "./image-definitions/seedream-v4.js";
import nanoBanana2Lite from "./image-definitions/nano-banana-2-lite.js";
import nanoBanana2 from "./image-definitions/nano-banana-2.js";
import nanoBananaPro from "./image-definitions/nano-banana-pro.js";
import nanoBanana from "./image-definitions/nano-banana.js";
import grokQuality from "./image-definitions/grok-imagine-quality.js";
import grokImage2 from "./image-definitions/grok-imagine-image-2.js";
import grokI2I from "./image-definitions/grok-imagine-image-to-image.js";
import grokT2I from "./image-definitions/grok-imagine-text-to-image.js";
import { canGenerate, deploymentState } from "./types.js";

/**
 * Models whose provider contract was verified against MuAPI's OpenAPI + metadata
 * (see each definition's `evidence`) AND that have a verified pricing basis in
 * imagePricing.js. These are cleared for real users in BOTH environments.
 *
 * Deliberately excluded (and therefore still hidden from the picker):
 *   muapi.seedream-5-pro-t2i   — no verified pricing entry in imagePricing.js
 *   muapi.grok-imagine-image-2 — no verified pricing entry in imagePricing.js
 * An unpriced model must never be selectable: calculateImageQuote would refuse
 * it at preflight, so offering it would only produce a dead Generate button.
 */
const VERIFIED_CONTRACT_IDS = new Set([
  "muapi.gpt-image-2-i2i", "muapi.gpt-image-2-t2i", "muapi.seedream-v45-t2i", "muapi.seedream-v4-t2i",
  "muapi.nano-banana-2-lite-t2i", "muapi.nano-banana-2-t2i", "muapi.nano-banana-pro-t2i", "muapi.nano-banana-t2i",
  "muapi.grok-imagine-quality-t2i", "muapi.grok-imagine-i2i", "muapi.grok-imagine-t2i",
]);
const RAW_IMAGE_MODELS = [gptImage2I2I,gptImage2T2I,seedream5Pro,seedreamV45,seedreamV4,nanoBanana2Lite,nanoBanana2,nanoBananaPro,nanoBanana,grokQuality,grokImage2,grokI2I,grokT2I];
export const IMAGE_MODELS = Object.freeze(RAW_IMAGE_MODELS.map((model) => Object.freeze({
  ...model,
  deployments: Object.freeze({
    ...model.deployments,
    staging: VERIFIED_CONTRACT_IDS.has(model.id) ? "STAGING_ENABLED" : model.deployments.staging,
    production: VERIFIED_CONTRACT_IDS.has(model.id) ? "ENABLED" : model.deployments.production,
  }),
})));
export function getImageModel(id) { return IMAGE_MODELS.find((model) => model.id === id) || null; }
export function listImageModels(env = process.env) { return IMAGE_MODELS.map((model) => ({ id:model.id, displayName:model.displayName, mediaType:model.mediaType, provider:model.provider, family:model.family || null, variant:model.variant || null, providerModelId:model.providerModelId || model.estimateCostModelId || null, capabilityMetadataRevision:model.capabilityMetadataRevision || null, status:deploymentState(model, env), available:canGenerate(model, env), productCapabilities:model.productCapabilities, settlementMode:model.settlementMode })); }
