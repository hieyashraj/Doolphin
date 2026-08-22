import { getAppStudioPreset } from "../app-studio/config.js";

const PRODUCT_ROLES = new Set(["PRIMARY_PRODUCT", "PRODUCT_PACKAGING", "PRODUCT_USAGE_REFERENCE"]);

function describeAsset(asset, imageIndex, studio) {
  const tag = `@image${imageIndex}`;
  if (asset.role === "ACTOR_REFERENCE") {
    return `${tag} is the selected AI avatar and the sole permitted human identity in the output.`;
  }
  if (PRODUCT_ROLES.has(asset.role)) {
    return `${tag} is the confirmed "${asset.alias}" view of product group "${asset.groupId}"; preserve its packaging, colors, shape, label, and logo.`;
  }
  if (asset.role === "APP_PRIMARY_SCREEN") {
    return `${tag} is a confirmed ${asset.analysis?.deviceType || "app"} interface screen named "${asset.alias}"; preserve its UI structure and do not invent replacement text.`;
  }
  if (asset.role === "STYLE_REFERENCE") {
    return `${tag} is style/composition reference only. Never copy any person's face, body identity, clothing identity, or voice from this image.`;
  }
  return `${tag} is a supporting visual reference named "${asset.alias}".`;
}

function describeVideoAsset(asset, videoIndex) {
  const tag = `@video${videoIndex}`;
  if (asset.role === "APP_SCREEN_RECORDING") {
    return `${tag} is the confirmed "${asset.alias}" app screen recording; preserve its real interaction sequence and use it as the app demonstration reference.`;
  }
  if (asset.role === "SOURCE_VIDEO") return `${tag} is the source video to transform as directed.`;
  return `${tag} is a supporting video reference named "${asset.alias}".`;
}

function defaultShotPlan(request, supportsNativeAudio = true) {
  const delivery = request.instructions.confirmedDelivery;
  if (!supportsNativeAudio) {
    if (request.studio === "PRODUCT_STUDIO") return "Create a visual product-ad sequence using the selected identity and exact uploaded product references. Do not synthesize dialogue or lip movement; treat the script as scene and performance direction.";
    if (request.studio === "APP_STUDIO") return "Create a visual app demonstration using the selected identity and exact uploaded interface references. Do not synthesize dialogue or lip movement; treat the script as scene direction; the final compositor preserves app pixels whenever readable UI is shown.";
    return "Create the requested visual sequence with the selected identity and references. Do not synthesize dialogue or lip movement; treat the script as visual and performance direction.";
  }
  if (request.studio === "PRODUCT_STUDIO") {
    const groups = [...new Set(request.assets.filter((asset) => PRODUCT_ROLES.has(asset.role)).map((asset) => asset.groupId || asset.alias))];
    const instruction = request.instructions.raw.toLowerCase();
    const explicitlyNamed = groups.filter((group) => instruction.includes(group.toLowerCase()));
    const featured = explicitlyNamed.length ? explicitlyNamed : groups;
    return `The selected avatar naturally introduces and handles ${featured.map((group) => `"${group}"`).join(" and ")}. ${explicitlyNamed.length ? "Only the explicitly named product group is mandatory." : "No group was excluded, so every selected product group must receive clear screen time."} Use natural interaction shots and clean close-up moments suitable for exact uploaded product B-roll. ${delivery === "VOICEOVER" ? "Deliver the script as voiceover while the avatar demonstrates silently." : "The avatar delivers the on-camera portions."}`;
  }
  if (request.studio === "APP_STUDIO") {
    const preset = getAppStudioPreset(request.presetId);
    const screens = request.assets.filter((asset) => asset.role === "APP_PRIMARY_SCREEN");
    const deviceTypes = [...new Set(screens.map((asset) => asset.analysis?.deviceType).filter(Boolean))];
    const deviceType = deviceTypes.length > 1 ? "mixed" : (deviceTypes[0] || "mobile");
    const device = deviceType === "mixed" ? "phone and laptop/desktop as appropriate to each confirmed screen" : ["desktop", "browser", "laptop"].includes(deviceType) ? "laptop or desktop" : "phone";
    return `${preset.direction} Prioritize the selected avatar naturally holding or using a ${device}. ${delivery === "VOICEOVER" ? "Use voiceover over the demonstration; do not animate unrelated lip speech." : "The avatar speaks authentically."} Create a clean demonstration beat where exact app UI B-roll can be inserted; the final compositor preserves app pixels whenever readable UI is shown.`;
  }
  if (delivery === "VOICEOVER") return "Natural handheld UGC framing with the selected avatar as the sole person, while the exact script is delivered as voiceover over purposeful creator and B-roll shots.";
  return "Natural handheld UGC framing. The selected avatar speaks directly to camera with believable expression and restrained camera motion.";
}

export function compileCanonicalPrompt(request, model = null) {
  const supportsNativeAudio = Boolean(model?.nativeAudio?.supported || model?.supportsNativeAudio);
  const requestedNativeAudio = typeof request.settings?.generateAudio === "boolean"
    ? request.settings.generateAudio
    : typeof request.settings?.nativeAudio === "boolean"
    ? request.settings.nativeAudio
    : undefined;
  const nativeAudioEnabled = supportsNativeAudio && (typeof requestedNativeAudio === "boolean"
    ? requestedNativeAudio
    : model?.nativeAudio?.default !== false);
  const nonImageRoles = new Set(["APP_SCREEN_RECORDING", "SOURCE_VIDEO", "REFERENCE_VIDEO", "REFERENCE_AUDIO"]);
  const videoRoles = new Set(["APP_SCREEN_RECORDING", "SOURCE_VIDEO", "REFERENCE_VIDEO"]);
  const imageAssets = request.assets.filter((asset) => !nonImageRoles.has(asset.role) && !String(asset.mimeType || "").startsWith("video/") && !String(asset.mimeType || "").startsWith("audio/"));
  const videoAssets = request.assets.filter((asset) => videoRoles.has(asset.role) || String(asset.mimeType || "").startsWith("video/"));
  const roleMap = imageAssets.map((asset, index) => ({
    imageIndex: index + 1,
    tag: `@image${index + 1}`,
    assetId: asset.assetId,
    role: asset.role,
    alias: asset.alias,
    groupId: asset.groupId || null,
    url: asset.url,
  }));

  const videoRoleMap = videoAssets.map((asset, index) => ({
    videoIndex: index + 1,
    tag: `@video${index + 1}`,
    assetId: asset.assetId,
    role: asset.role,
    alias: asset.alias,
    groupId: asset.groupId || null,
    url: asset.url,
  }));

  const dialogueLines = nativeAudioEnabled
    ? [
        "DIALOGUE",
        `${request.instructions.confirmedDelivery === "VOICEOVER" ? "The voiceover says" : "The creator says"} exactly: \"${request.script.text.replaceAll('"', '\\"')}\"`,
        `Do not paraphrase, add, remove, translate, or replace words. Generate native speech.${request.instructions.confirmedDelivery === "VOICEOVER" ? " Do not create unrelated visible lip speech." : " Synchronize accurate lip movement during on-camera dialogue."}`,
      ]
    : [
        "CREATIVE DIRECTION",
        `Use this text as visual and performance direction only: \"${request.script.text.replaceAll('"', '\\"')}\"`,
        "This model does not provide controllable native speech. Do not invent dialogue or lip-sync.",
      ];

  const sections = [
    "IDENTITY LOCK",
    "@image1 is the sole permitted human identity and the only on-camera creator. Do not create, substitute, or borrow another person's identity from any reference.",
    "",
    "ASSET MAP",
    ...imageAssets.map((asset, index) => describeAsset(asset, index + 1, request.studio)),
    ...videoAssets.map((asset, index) => describeVideoAsset(asset, index + 1)),
    "",
    ...dialogueLines,
    "",
    "SHOT PLAN",
    defaultShotPlan(request, nativeAudioEnabled),
  ];

  if (request.instructions.raw) {
    sections.push(`User direction: ${request.instructions.raw}`);
  }
  if (request.studio === "APP_STUDIO") {
    const preset = getAppStudioPreset(request.presetId);
    sections.push(`APP STUDIO PRESET: ${preset.name}. Composition strategy: ${preset.composition}.`);
  }
  sections.push(
    `Delivery mode: ${request.instructions.confirmedDelivery}.`,
    "",
    "FORMAT",
    `${request.settings.aspectRatio}, ${request.settings.durationSeconds} seconds, ${request.settings.resolution}.`,
    "",
    "NEGATIVE CONSTRAINTS",
    "No additional people, unrelated products, animals, penguins, surfing, fantasy activity, substitute packaging, invented UI, unrequested captions, watermarks, or unrelated scene changes."
  );

  return {
    compiledPrompt: sections.join("\n").trim(),
    roleMap,
    videoRoleMap,
    assetRoleMap: [...roleMap, ...videoRoleMap],
    imageUrls: roleMap.map((entry) => entry.url),
    compositionAssets: request.assets.filter((asset) => asset.role === "APP_SCREEN_RECORDING" || asset.role === "APP_PRIMARY_SCREEN" || PRODUCT_ROLES.has(asset.role)),
  };
}
