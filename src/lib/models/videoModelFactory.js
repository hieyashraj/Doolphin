import catalog from "./catalog/muapi-model-catalog.json" with { type: "json" };

/**
 * CATALOG-DRIVEN MODEL DEFINITIONS.
 *
 * The platform's three-layer registry expects, per model, a providerSpec + a
 * productPolicy + a businessPolicy + a toProviderPayload transformer. Those were
 * hand-authored, so only three models existed and the Video Studio fell back to a
 * hardcoded list of placeholder names that resolved to nothing.
 *
 * This builds the same shape for every model in the provider's own export
 * (scripts/generate-model-catalog.mjs), so the studios offer the real bench.
 *
 * ── WHAT IS AUTHORITATIVE, AND WHAT IS NOT ────────────────────────────────────
 * PRICING is not guessed here. 602 of the 609 exported models declare
 * dynamic_pricing, so the billed amount always comes from the provider's
 * estimate-cost endpoint at preflight (estimateAuthoritativeModelCost), exactly
 * as the three hand-written definitions already worked. The `cost` value carried
 * here is the provider's published representative base, used only for display and
 * for the drift guard in verifiedCosts.js that refuses an implausible quote.
 *
 * The INPUT SCHEMA is the honest limitation: the provider's export does not
 * include per-model input schemas. So the transformer below emits the fields
 * MuAPI's generation endpoints share (prompt, the reference the mode requires,
 * and duration/aspect_ratio/resolution ONLY when the caller supplied them), and
 * omits everything else rather than inventing parameters. At runtime the registry
 * merges the live provider spec over this one (registry.js step 3), so where a
 * live schema is available it wins. Sending no speculative fields is what keeps a
 * generated definition safe.
 */

const VIDEO_MODES = Object.freeze(["text-to-video", "image-to-video", "video-extend"]);
const VIDEO_STUDIOS = Object.freeze(["video-studio", "product-studio", "app-studio"]);

/** Aspect ratios Doolphin's studios offer. Sent only when the caller picks one. */
export const STUDIO_ASPECT_RATIOS = Object.freeze(["9:16", "16:9", "1:1", "4:3", "3:4"]);

function buildInputSchema(mode) {
  const properties = {
    prompt: { type: "string", maxLength: 5000 },
    duration: { type: "integer", minimum: 1, maximum: 60 },
    aspect_ratio: { type: "string", enum: [...STUDIO_ASPECT_RATIOS] },
    resolution: { type: "string" },
  };
  const required = ["prompt"];
  if (mode === "image-to-video") {
    properties.image_url = { type: "string", description: "Source image URL" };
    required.push("image_url");
  }
  if (mode === "video-extend") {
    properties.video_url = { type: "string", description: "Source video URL" };
    required.push("video_url");
  }
  return { type: "object", required, properties };
}

/**
 * Emits the provider body. Deliberately conservative: a field is included only
 * when the caller actually supplied it, so no speculative parameter is ever sent
 * to a provider whose schema we could not verify.
 */
function makeTransformer(entry) {
  return function toProviderPayload(normalizedInput) {
    const prompt = String(normalizedInput?.prompt || "").trim();
    if (!prompt) throw new Error(`[${entry.providerModelId}] prompt is required`);

    const payload = { prompt };

    // The reference the mode structurally requires. Fail closed when absent:
    // submitting an image-to-video job with no image would be billed and return
    // something unrelated to the user's intent.
    if (entry.mode === "image-to-video") {
      const image =
        normalizedInput.imageUrl ||
        normalizedInput.image_url ||
        normalizedInput.extraInputs?.images?.[0] ||
        normalizedInput.images?.[0] ||
        null;
      if (!image) throw new Error(`[${entry.providerModelId}] this model needs a source image`);
      payload.image_url = String(image);
    }
    if (entry.mode === "video-extend") {
      const video = normalizedInput.videoUrl || normalizedInput.video_url || null;
      if (!video) throw new Error(`[${entry.providerModelId}] this model needs a source video`);
      payload.video_url = String(video);
    }

    if (normalizedInput.duration !== undefined && normalizedInput.duration !== null) {
      const duration = Number(normalizedInput.duration);
      if (!Number.isInteger(duration) || duration < 1 || duration > 60) {
        throw new Error(`[${entry.providerModelId}] duration must be a whole number of seconds between 1 and 60 (received ${normalizedInput.duration})`);
      }
      payload.duration = duration;
    }

    if (normalizedInput.aspectRatio) {
      if (!STUDIO_ASPECT_RATIOS.includes(normalizedInput.aspectRatio)) {
        throw new Error(`[${entry.providerModelId}] unsupported aspect ratio '${normalizedInput.aspectRatio}'`);
      }
      payload.aspect_ratio = normalizedInput.aspectRatio;
    }

    if (normalizedInput.resolution) payload.resolution = String(normalizedInput.resolution).toLowerCase();

    return payload;
  };
}

/**
 * Variable infra reserve, scaled to the deliverable. Video costs materially more
 * to verify, store and serve than a single image, and the reserve must never be
 * larger than the margin it protects.
 */
function infraReserveMicroUsd(entry) {
  return entry.mediaType === "VIDEO" ? 20_000n : 5_000n;
}

function buildDefinition(entry, displayOrder) {
  const isVideo = VIDEO_MODES.includes(entry.mode);
  return Object.freeze({
    providerSpec: {
      providerModelId: entry.providerModelId,
      endpoint: entry.endpoint,
      category: isVideo ? "video-generation" : "image-generation",
      description: entry.description,
      cost: { amount: entry.cost, currency: entry.costCurrency },
      dynamicPricing: entry.dynamicPricing,
      estimateEndpoint: entry.estimateEndpoint,
      inputSchema: buildInputSchema(entry.mode),
    },
    productPolicy: {
      id: `muapi.${entry.providerModelId}`,
      displayName: entry.displayName,
      studios: isVideo ? [...VIDEO_STUDIOS] : ["image-studio"],
      generationMode: entry.mode,
      enabled: true,
      displayOrder,
      description: entry.description,
      legacyAliases: [],
      family: entry.family,
      mediaType: entry.mediaType,
    },
    businessPolicy: {
      targetContributionMarginBps: 3000,
      variableInfraCostMicroUsd: infraReserveMicroUsd(entry),
      minimumCredits: 1,
    },
    toProviderPayload: makeTransformer(entry),
  });
}

const ALL_ENTRIES = Object.values(catalog.models);

/**
 * Cheapest-first inside each family keeps the picker's default a sensible,
 * low-cost option rather than an arbitrary alphabetical one.
 */
const SORTED = [...ALL_ENTRIES].sort((a, b) => a.cost - b.cost || a.providerModelId.localeCompare(b.providerModelId));

export const CATALOG_REVISION = catalog.revision;

export const GENERATED_MODEL_DEFINITIONS = Object.freeze(
  SORTED.map((entry, index) => buildDefinition(entry, 100 + index))
);

export const GENERATED_MODELS_BY_ID = Object.freeze(
  Object.fromEntries(GENERATED_MODEL_DEFINITIONS.map((definition) => [definition.productPolicy.id, definition]))
);

export function listGeneratedModelsByStudio(studio) {
  return GENERATED_MODEL_DEFINITIONS.filter(
    (definition) => definition.productPolicy.enabled && definition.productPolicy.studios.includes(studio)
  );
}

/** Serializable shape for the client model picker. */
export function toClientModel(definition) {
  const { productPolicy, providerSpec } = definition;
  return {
    id: productPolicy.id,
    name: productPolicy.displayName,
    description: productPolicy.description,
    mode: productPolicy.generationMode,
    mediaType: productPolicy.mediaType,
    family: productPolicy.family,
    // The provider's published base, so the picker can show relative cost without
    // implying it is the amount that will be charged.
    referenceCostUsd: providerSpec.cost.amount,
    dynamicPricing: providerSpec.dynamicPricing,
    aspectRatios: [...STUDIO_ASPECT_RATIOS],
    requiresImage: productPolicy.generationMode === "image-to-video",
    requiresVideo: productPolicy.generationMode === "video-extend",
  };
}
