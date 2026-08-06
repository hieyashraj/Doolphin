import { interpretProduct } from "./productInterpreter.js";

/**
 * Server-Side Prompt Compiler
 * Resolves all template placeholders and builds explicit composition directives for video models.
 */
export function compileGenerationPrompt({
  rawPrompt = "",
  spokenScript = "",
  sceneMotion = "",
  additionalInstructions = "",
  preset = null,
  avatarName = "AI UGC Actor",
  productName = "Product",
  primaryBenefit = "transformative results",
  painPoint = "daily frustration",
  cta = "link below to get yours today",
  aspectRatio = "9:16",
  duration = 5,
  presetCategory = "",
  modelId = "",
  hasAvatarImage = false,
  hasProductImage = false,
  hasAudio = false
}) {
  let baseTemplate = rawPrompt || (preset ? preset.prompt : "") || spokenScript || sceneMotion;

  if (!baseTemplate.trim()) {
    baseTemplate = "Authentic iPhone UGC video of [Avatar] showcasing [Target Product].";
  }
  
  if (sceneMotion && baseTemplate !== sceneMotion) {
    baseTemplate += ` ${sceneMotion}`;
  }

  const hasAvatar = rawPrompt && /\[Avatar\]/i.test(rawPrompt);
  const hasProduct = rawPrompt && /\[Target Product\]/i.test(rawPrompt);

  // Resolve all template placeholders cleanly
  let compiled = baseTemplate
    .replace(/\[Avatar\]/gi, avatarName)
    .replace(/\[Target Product\]/gi, productName)
    .replace(/\[Brand\]/gi, productName)
    .replace(/\[Primary Benefit\]/gi, primaryBenefit)
    .replace(/\[Pain Point\]/gi, painPoint)
    .replace(/\[CTA\]/gi, cta)
    .replace(/\[Script\]/gi, spokenScript || "spontaneous reaction")
    .replace(/\[Duration\]/gi, `${duration}s`);

  if (avatarName && !hasAvatar) {
    compiled += ` Featuring avatar: ${avatarName}.`;
  }
  
  if (productName && !hasProduct) {
    compiled += ` Product being showcased: ${productName}.`;
  }

  // Product interpretation directives
  const productInterp = interpretProduct(productName, presetCategory);
  compiled += ` ${productInterp.promptDirectives}`;

  // Aspect ratio composition instructions
  if (aspectRatio === "9:16") {
    compiled += " Framed in vertical 9:16 mobile canvas as a natural medium UGC selfie shot.";
  } else if (aspectRatio === "16:9") {
    compiled += " Framed in horizontal 16:9 widescreen canvas with extended environmental context surrounding the avatar.";
  } else if (aspectRatio === "1:1" || aspectRatio === "4:5") {
    compiled += " Framed in balanced 1:1 square canvas with adjusted camera distance so avatar and product interaction remain fully visible.";
  }

  // Identity and physical consistency directives
  compiled += " Avatar and product references must remain consistent across all frames with natural lighting, physical depth, contact points, and zero flat overlays.";

  if (additionalInstructions) {
    compiled += ` ${additionalInstructions}`;
  }

  // Seedance 2 specific syntax
  if (modelId === "seedance-2") {
    let seedancePrefix = [];
    if (hasAvatarImage) {
      seedancePrefix.push("@image1 is the main character presenting the product.");
    }
    if (hasProductImage) {
      seedancePrefix.push("@image2 is the product being presented by @image1.");
    }
    if (hasAudio) {
      seedancePrefix.push("@audio1 is the spoken audio narration.");
    }
    if (seedancePrefix.length > 0) {
      compiled = `${seedancePrefix.join(" ")} ${compiled}`;
    }
  }

  return {
    compiledPrompt: compiled.trim(),
    productInterpretation: productInterp,
    resolvedPlaceholders: {
      avatar: avatarName,
      product: productName,
      duration: `${duration}s`,
      aspectRatio
    }
  };
}
