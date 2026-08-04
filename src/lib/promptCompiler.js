import { interpretProduct } from "./productInterpreter.js";

/**
 * Server-Side Prompt Compiler
 * Resolves all template placeholders and builds explicit composition directives for video models.
 */
export function compileGenerationPrompt({
  rawPrompt = "",
  spokenScript = "",
  sceneMotion = "",
  preset = null,
  avatarName = "AI UGC Actor",
  productName = "Product",
  aspectRatio = "9:16",
  duration = 5,
  presetCategory = ""
}) {
  let baseTemplate = rawPrompt || (preset ? preset.prompt : "") || spokenScript || sceneMotion;

  if (!baseTemplate.trim()) {
    baseTemplate = "Authentic iPhone UGC video of [Avatar] showcasing [Target Product].";
  }

  // Resolve all template placeholders cleanly
  let compiled = baseTemplate
    .replace(/\[Avatar\]/gi, avatarName)
    .replace(/\[Target Product\]/gi, productName)
    .replace(/\[Brand\]/gi, productName)
    .replace(/\[Primary Benefit\]/gi, "transformative results")
    .replace(/\[Pain Point\]/gi, "daily frustration")
    .replace(/\[CTA\]/gi, "link below to get yours today")
    .replace(/\[Script\]/gi, spokenScript || "spontaneous reaction")
    .replace(/\[Duration\]/gi, `${duration}s`);

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
