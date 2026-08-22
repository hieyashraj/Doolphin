export const PRODUCT_STUDIO_MAX_DURATION = 15;

// Product Studio is deliberately curated. Both entries are backed by real
// multi-reference MuAPI adapters in videoModelFactory rather than the generic
// catalog transformer, so actor, product, motion and audio references survive
// all the way to the provider payload.
export const PRODUCT_STUDIO_MODELS = Object.freeze([
  Object.freeze({
    id: "muapi.seedance-2.5-omni-reference",
    name: "Seedance 2.5",
    description: "Best quality · multi-reference product UGC",
    resolutions: Object.freeze(["720p"]),
    aspectRatios: Object.freeze(["9:16", "16:9", "1:1", "4:3", "3:4", "21:9", "9:21"]),
    minDuration: 4,
    maxDuration: PRODUCT_STUDIO_MAX_DURATION,
    maxImages: 30,
    maxVideos: 10,
    maxAudios: 10,
  }),
  Object.freeze({
    id: "muapi.seedance-2-omni-reference",
    name: "Seedance 2.0",
    description: "Reliable 720p · controlled product references",
    resolutions: Object.freeze(["720p"]),
    aspectRatios: Object.freeze(["9:16", "16:9", "1:1", "4:3", "3:4", "21:9"]),
    minDuration: 4,
    maxDuration: PRODUCT_STUDIO_MAX_DURATION,
    maxImages: 9,
    maxVideos: 3,
    maxAudios: 3,
  }),
]);

export const PRODUCT_STUDIO_PRESETS = Object.freeze([
  Object.freeze({ id: "product-testimonial", name: "Direct Product Testimonial", interaction: ["hold", "show_to_camera"], visibility: "balanced", direction: "A candid creator recommendation with the product clearly visible." }),
  Object.freeze({ id: "product-demo", name: "Product Demo", interaction: ["demonstrate", "show_to_camera"], visibility: "hero", direction: "Show the product in a clear, practical demonstration." }),
  Object.freeze({ id: "product-in-use", name: "Product In Use", interaction: ["use", "show_to_camera"], visibility: "balanced", direction: "Show a natural real-world use moment before a clear product reveal." }),
  Object.freeze({ id: "product-unboxing", name: "Product Unboxing", interaction: ["unbox", "open", "show_to_camera"], visibility: "hero", direction: "Create an authentic unboxing sequence with packaging details visible." }),
  Object.freeze({ id: "product-problem-solution", name: "Problem → Solution", interaction: ["demonstrate", "use"], visibility: "balanced", direction: "Open with a relatable problem then show the product as the practical solution." }),
  Object.freeze({ id: "product-hero", name: "Product Hero", interaction: ["show_to_camera", "place"], visibility: "hero", direction: "Make the product the visual hero with a polished close-up moment." }),
  Object.freeze({ id: "product-grwm", name: "GRWM / Product Use", interaction: ["use", "apply"], visibility: "balanced", direction: "A natural get-ready-with-me product-use sequence." }),
  Object.freeze({ id: "product-founder", name: "Founder / Recommendation", interaction: ["hold", "show_to_camera"], visibility: "balanced", direction: "A trustworthy personal recommendation from the creator." }),
  Object.freeze({ id: "product-lifestyle", name: "Lifestyle Showcase", interaction: ["use", "carry"], visibility: "balanced", direction: "Integrate the product naturally into a believable lifestyle moment." }),
]);

export function getProductStudioModel(modelId) {
  return PRODUCT_STUDIO_MODELS.find((model) => model.id === modelId) || null;
}

export function getProductStudioPreset(presetId) {
  return PRODUCT_STUDIO_PRESETS.find((preset) => preset.id === presetId) || PRODUCT_STUDIO_PRESETS[0];
}
