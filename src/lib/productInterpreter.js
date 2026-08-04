/**
 * Product Interpretation Stage
 * Analyzes product context to categorize product type and build explicit prompt interaction directives.
 */
export function interpretProduct(productText = "", presetCategory = "") {
  const text = (productText + " " + presetCategory).toLowerCase();

  let category = "handheld";
  let interactionType = "handheld";
  let promptDirectives = "The avatar is physically holding and presenting the product directly on camera.";

  if (text.includes("shirt") || text.includes("jacket") || text.includes("dress") || text.includes("wear") || text.includes("hoodie") || text.includes("clothing") || text.includes("apparel") || text.includes("shoes")) {
    category = "wearable";
    interactionType = "wearable";
    promptDirectives = "The avatar is wearing the apparel item naturally with realistic fabric folds, fit, body movement, and lighting.";
  } else if (text.includes("app") || text.includes("saas") || text.includes("screen") || text.includes("dashboard") || text.includes("software") || text.includes("mobile") || text.includes("iphone")) {
    category = "digital_screen";
    interactionType = "digital_screen";
    promptDirectives = "The avatar is holding a smartphone / device screen displaying the readable app UI in macro close-up view.";
  } else if (text.includes("bag") || text.includes("purse") || text.includes("watch") || text.includes("glasses")) {
    category = "accessory";
    interactionType = "accessory";
    promptDirectives = "The avatar is showcasing and carrying the accessory naturally, demonstrating its design and material details.";
  } else if (text.includes("desk") || text.includes("chair") || text.includes("sofa") || text.includes("furniture")) {
    category = "furniture_large";
    interactionType = "furniture_large";
    promptDirectives = "The product is placed naturally in the surrounding background environment, with believable lighting and shadow.";
  }

  return {
    category,
    interactionType,
    scale: category === "furniture_large" ? "large" : category === "wearable" ? "human_body" : "compact",
    promptDirectives,
    identityFeatures: ["Preserve recognizable shape, color, logo placement, and packaging proportions."],
    forbiddenDistortions: ["No floating PNG overlays", "No missing fingers", "No identity warping"]
  };
}
