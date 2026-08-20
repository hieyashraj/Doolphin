import gptImage2T2I from "./image-definitions/gpt-image-2-text-to-image.js";
import gptImage2I2I from "./image-definitions/gpt-image-2-image-to-image.js";
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
 * IMAGE MODEL ENABLEMENT
 * ======================
 * Image generation is restricted to the single image model the pricing document
 * covers: OpenAI GPT Image 2 text-to-image (`gpt-image-2-text-to-image`).
 *
 * The restriction is a commercial requirement, not a technical one. Every other
 * definition below stays in the registry so its id still RESOLVES -- a request
 * naming a disabled model must fail with "not enabled here" rather than "unknown
 * model", and removing the definitions would silently change that error and
 * break the pricing/adapter tests that reference them. Enablement, not
 * existence, is what gates generation.
 *
 * `gpt-image-2-image-to-image` is deliberately NOT enabled. The document
 * specifies only the text-to-image endpoint, and enabling an image model whose
 * price surface has not been verified against the document is exactly the
 * pattern that produces unpriced spend. Editing and avatar flows will need it;
 * enabling it is a one-line change once its pricing is in the document.
 */
const DOCUMENTED_IMAGE_MODEL_IDS = Object.freeze(["muapi.gpt-image-2-t2i"]);

/**
 * The enabled set. Kept as an explicit, named allow-list rather than a per-file
 * deployment flag so that "which image models can spend money" is answerable by
 * reading one line.
 */
export const ENABLED_IMAGE_MODEL_IDS = Object.freeze(new Set(DOCUMENTED_IMAGE_MODEL_IDS));

const RAW_IMAGE_MODELS = [
  gptImage2T2I,
  gptImage2I2I,
  seedream5Pro,
  seedreamV45,
  seedreamV4,
  nanoBanana2Lite,
  nanoBanana2,
  nanoBananaPro,
  nanoBanana,
  grokQuality,
  grokImage2,
  grokI2I,
  grokT2I,
];

// Fail loudly if a definition is missing rather than shipping an `undefined`
// entry. A hole here previously reached the array as a dangling identifier,
// which throws at module load and takes the whole image path down.
for (const [index, model] of RAW_IMAGE_MODELS.entries()) {
  if (!model || typeof model.id !== "string") {
    throw new Error(`Image definition at index ${index} is missing or has no id`);
  }
}

const registeredIds = new Set(RAW_IMAGE_MODELS.map((model) => model.id));
for (const id of ENABLED_IMAGE_MODEL_IDS) {
  if (!registeredIds.has(id)) {
    throw new Error(
      `ENABLED_IMAGE_MODEL_IDS names '${id}', which is not a registered image definition. ` +
        `An enabled-but-unregistered id would silently disable image generation.`,
    );
  }
}

export const IMAGE_MODELS = Object.freeze(
  RAW_IMAGE_MODELS.map((model) =>
    Object.freeze({
      ...model,
      deployments: Object.freeze({
        ...model.deployments,
        staging: ENABLED_IMAGE_MODEL_IDS.has(model.id)
          ? "STAGING_ENABLED"
          : "DISABLED_NOT_IN_PRICING_DOCUMENT",
      }),
    }),
  ),
);

export function getImageModel(id) {
  return IMAGE_MODELS.find((model) => model.id === id) || null;
}

export function listImageModels(env = process.env) {
  return IMAGE_MODELS.map((model) => ({
    id: model.id,
    displayName: model.displayName,
    mediaType: model.mediaType,
    provider: model.provider,
    status: deploymentState(model, env),
    available: canGenerate(model, env),
    productCapabilities: model.productCapabilities,
    settlementMode: model.settlementMode,
  }));
}
