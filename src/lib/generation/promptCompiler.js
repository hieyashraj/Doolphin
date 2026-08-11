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

function defaultShotPlan(request) {
  const delivery = request.instructions.confirmedDelivery;
  if (request.studio === "PRODUCT_STUDIO") {
    const groups = [...new Set(request.assets.filter((asset) => PRODUCT_ROLES.has(asset.role)).map((asset) => asset.groupId || asset.alias))];
    const instruction = request.instructions.raw.toLowerCase();
    const explicitlyNamed = groups.filter((group) => instruction.includes(group.toLowerCase()));
    const featured = explicitlyNamed.length ? explicitlyNamed : groups;
    return `The selected avatar naturally introduces and handles ${featured.map((group) => `"${group}"`).join(" and ")}. ${explicitlyNamed.length ? "Only the explicitly named product group is mandatory." : "No group was excluded, so every selected product group must receive clear screen time."} Use natural interaction shots and clean close-up moments suitable for exact uploaded product B-roll. ${delivery === "VOICEOVER" ? "Deliver the script as voiceover while the avatar demonstrates silently." : "The avatar delivers the on-camera portions."}`;
  }
  if (request.studio === "APP_STUDIO") {
    const screens = request.assets.filter((asset) => asset.role === "APP_PRIMARY_SCREEN");
    const deviceTypes = [...new Set(screens.map((asset) => asset.analysis?.deviceType).filter(Boolean))];
    const deviceType = deviceTypes.length > 1 ? "mixed" : (deviceTypes[0] || "mobile");
    const device = deviceType === "mixed" ? "phone and laptop/desktop as appropriate to each confirmed screen" : ["desktop", "browser", "laptop"].includes(deviceType) ? "laptop or desktop" : "phone";
    return `Prioritize the selected avatar naturally holding or using a ${device}. ${delivery === "VOICEOVER" ? "Use voiceover over the demonstration; do not animate unrelated lip speech." : "The avatar speaks authentically."} Then create a clean demonstration beat where exact app UI B-roll can be inserted, followed by an avatar CTA when timing permits.`;
  }
  if (delivery === "VOICEOVER") return "Natural handheld UGC framing with the selected avatar as the sole person, while the exact script is delivered as voiceover over purposeful creator and B-roll shots.";
  return "Natural handheld UGC framing. The selected avatar speaks directly to camera with believable expression and restrained camera motion.";
}

export function compileCanonicalPrompt(request) {
  const imageAssets = request.assets.filter((asset) => asset.role !== "APP_SCREEN_RECORDING");
  const roleMap = imageAssets.map((asset, index) => ({
    imageIndex: index + 1,
    tag: `@image${index + 1}`,
    assetId: asset.assetId,
    role: asset.role,
    alias: asset.alias,
    groupId: asset.groupId || null,
    url: asset.url,
  }));

  const sections = [
    "IDENTITY LOCK",
    "@image1 is the sole permitted human identity and the only on-camera creator. Do not create, substitute, or borrow another person's identity from any reference.",
    "",
    "ASSET MAP",
    ...imageAssets.map((asset, index) => describeAsset(asset, index + 1, request.studio)),
    "",
    "DIALOGUE",
    `${request.instructions.confirmedDelivery === "VOICEOVER" ? "The voiceover says" : "The creator says"} exactly: \"${request.script.text.replaceAll('"', '\\"')}\"`,
    `Do not paraphrase, add, remove, translate, or replace words. Generate native speech.${request.instructions.confirmedDelivery === "VOICEOVER" ? " Do not create unrelated visible lip speech." : " Synchronize accurate lip movement during on-camera dialogue."}`,
    "",
    "SHOT PLAN",
    defaultShotPlan(request),
  ];

  if (request.instructions.raw) {
    sections.push(`User direction: ${request.instructions.raw}`);
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
    imageUrls: roleMap.map((entry) => entry.url),
    compositionAssets: request.assets.filter((asset) => asset.role === "APP_SCREEN_RECORDING" || PRODUCT_ROLES.has(asset.role)),
  };
}
