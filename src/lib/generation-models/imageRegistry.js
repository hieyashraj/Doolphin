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

export const IMAGE_MODELS = Object.freeze([gptImage2I2I,gptImage2T2I,seedream5Pro,seedreamV45,seedreamV4,nanoBanana2Lite,nanoBanana2,nanoBananaPro,nanoBanana,grokQuality,grokImage2,grokI2I,grokT2I]);
export function getImageModel(id) { return IMAGE_MODELS.find((model) => model.id === id) || null; }
export function listImageModels(env = process.env) { return IMAGE_MODELS.map((model) => ({ id:model.id, displayName:model.displayName, mediaType:model.mediaType, provider:model.provider, status:deploymentState(model, env), available:canGenerate(model, env), productCapabilities:model.productCapabilities, settlementMode:model.settlementMode })); }
