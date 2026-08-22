/**
 * App Studio's product contract. This is intentionally separate from the
 * provider-wide catalog: it contains only the two multi-reference Seedance
 * models that can keep an actor and application as distinct semantic inputs.
 */
export const APP_STUDIO_MAX_DURATION = 15;

export const APP_STUDIO_MODELS = Object.freeze([
  Object.freeze({
    id: "muapi.seedance-2.5-omni-reference",
    providerModelId: "seedance-2.5-omni-reference",
    name: "Seedance 2.5",
    description: "Multi-reference UGC app video · 720p",
    resolutions: Object.freeze(["720p"]),
    aspectRatios: Object.freeze(["16:9", "9:16", "1:1", "4:3", "3:4", "21:9", "9:21"]),
    minDuration: 4,
    maxDuration: APP_STUDIO_MAX_DURATION,
    maxImages: 30,
    maxVideos: 10,
    maxAudio: 10,
    nativeAudio: true,
  }),
  Object.freeze({
    id: "muapi.seedance-2-omni-reference",
    providerModelId: "seedance-2-omni-reference",
    name: "Seedance 2.0",
    description: "Omni Reference UGC app video · 720p",
    resolutions: Object.freeze(["720p"]),
    aspectRatios: Object.freeze(["16:9", "9:16", "1:1", "4:3", "3:4", "21:9"]),
    minDuration: 4,
    maxDuration: APP_STUDIO_MAX_DURATION,
    maxImages: 9,
    maxVideos: 3,
    maxAudio: 3,
    nativeAudio: true,
  }),
]);

export const APP_STUDIO_PRESETS = Object.freeze([
  Object.freeze({ id: "app-screen-to-life", name: "App Screen to Life", composition: "PIP", direction: "The creator introduces the app, then a crisp picture-in-picture view demonstrates the supplied interface." }),
  Object.freeze({ id: "saas-founder-walkthrough", name: "SaaS Founder Walkthrough", composition: "SIDE_BY_SIDE", direction: "The presenter explains a problem at a desk while the supplied dashboard remains clear beside them." }),
  Object.freeze({ id: "app-pip-demo", name: "App PiP Demo", composition: "PIP", direction: "Keep the presenter visible while the real app screen appears as an intentionally readable picture-in-picture demo." }),
  Object.freeze({ id: "app-problem-solution", name: "App Problem → Solution", composition: "INSERT", direction: "Open with the creator's problem, then reveal the real app interface as the solution." }),
  Object.freeze({ id: "app-store-install", name: "App Store / Install Style", composition: "FULL_SCREEN", direction: "Use a fast creator recommendation and a clean full-screen insert of the supplied app." }),
  Object.freeze({ id: "creator-recommendation", name: "Creator Recommendation", composition: "PIP", direction: "Make the creator's recommendation feel candid while preserving a readable app moment." }),
  Object.freeze({ id: "direct-testimonial", name: "Direct-to-Camera Testimonial", composition: "INSERT", direction: "Use an authentic direct-to-camera testimonial followed by a short exact app demonstration." }),
]);

export function getAppStudioModel(modelId) {
  return APP_STUDIO_MODELS.find((model) => model.id === modelId) || null;
}

export function getAppStudioPreset(presetId) {
  return APP_STUDIO_PRESETS.find((preset) => preset.id === presetId) || APP_STUDIO_PRESETS[0];
}

/** Creates neutral, analysis-led dialogue when the user leaves the script blank. */
export function buildAppStudioAutoScript({ appAnalysis, presetId } = {}) {
  const preset = getAppStudioPreset(presetId);
  const name = String(appAnalysis?.suggestedName || appAnalysis?.identity || "this app").replace(/[\r\n]+/g, " ").trim().slice(0, 72) || "this app";
  const visible = Array.isArray(appAnalysis?.visibleText)
    ? appAnalysis.visibleText.find((value) => typeof value === "string" && value.trim())
    : null;
  const visibleDetail = visible
    ? `The interface includes “${String(visible).trim().slice(0, 80)}”.`
    : "The supplied interface shows the real app flow.";
  const presentation = {
    PIP: "I’ll keep the interface visible while I walk through it.",
    SIDE_BY_SIDE: "I’ll walk through it beside the interface.",
    INSERT: "Let’s cut to the interface and follow the flow.",
    FULL_SCREEN: "Let’s look at the interface full screen.",
  }[preset.composition] || "Let’s walk through the supplied interface.";
  return `Here is ${name}. ${visibleDetail} ${presentation}`.slice(0, 300);
}
