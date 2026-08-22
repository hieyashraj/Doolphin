import { getProductStudioPreset } from "./config.js";

const DEFAULT_ANALYSIS = Object.freeze({
  category: "general product",
  wearable: false,
  edible: false,
  drinkable: false,
  topical: false,
  electronic: false,
});

function normalizedText(value) {
  return String(value || "").toLowerCase();
}

export function normalizeProductAnalysis(analysis = {}) {
  const source = { ...DEFAULT_ANALYSIS, ...(analysis || {}) };
  const evidence = normalizedText([source.category, source.identity, source.suggestedName, ...(source.visibleText || [])].join(" "));
  const matches = (pattern) => pattern.test(evidence);
  return {
    ...source,
    category: source.category || source.identity || "general product",
    wearable: Boolean(source.wearable || matches(/t-?shirt|shirt|dress|jacket|hoodie|hat|cap|glasses|necklace|shoe|sneaker|bag|handbag|apparel|garment/)),
    edible: Boolean(source.edible || matches(/food|snack|cookie|meal|cereal|chocolate/)),
    drinkable: Boolean(source.drinkable || matches(/drink|beverage|coffee|tea|juice|soda|bottle/)),
    topical: Boolean(source.topical || matches(/skincare|serum|cream|lotion|cosmetic|makeup|lipstick|sunscreen/)),
    electronic: Boolean(source.electronic || matches(/phone|camera|device|electronic|speaker|headphone|keyboard|watch/)),
  };
}

function explicitInteraction(instructions) {
  const text = normalizedText(instructions);
  const prohibited = new Set();
  if (/do not (drink|consume)/.test(text)) prohibited.add("drink");
  if (/do not (eat|consume)/.test(text)) prohibited.add("eat");
  if (/do not apply/.test(text)) prohibited.add("apply");
  if (/do not wear/.test(text)) prohibited.add("wear");
  const requested = [];
  const add = (value, pattern) => { if (pattern.test(text) && !prohibited.has(value)) requested.push(value); };
  add("wear", /\bwear\b/); add("apply", /\bapply\b/); add("unbox", /\bunbox\b/); add("open", /\bopen\b/);
  add("pour", /\bpour\b/); add("drink", /\bdrink\b/); add("eat", /\beat\b/); add("operate", /\b(turn on|operate|use the controls)\b/);
  add("hold", /\bhold\b/); add("show_to_camera", /\b(show|beside your face|toward camera)\b/); add("demonstrate", /\bdemonstrate\b/);
  return { requested: [...new Set(requested)], prohibited: [...prohibited] };
}

export function planProductInteraction({ analysis, presetId, instructions = "" } = {}) {
  const product = normalizeProductAnalysis(analysis);
  const override = explicitInteraction(instructions);
  if (override.requested.length) return { source: "user", modes: override.requested, prohibited: override.prohibited, category: product.category };

  let modes;
  if (product.wearable) modes = ["wear", "show_to_camera"];
  else if (product.topical) modes = ["hold", "open", "apply", "show_to_camera"];
  else if (product.drinkable) modes = ["hold", "open", "drink"];
  else if (product.edible) modes = ["open", "serve", "eat"];
  else if (product.electronic) modes = ["hold", "operate", "demonstrate"];
  else modes = [...getProductStudioPreset(presetId).interaction];

  modes = modes.filter((mode) => !override.prohibited.includes(mode));
  if (!modes.length) modes = ["hold", "show_to_camera"];
  return { source: "automatic", modes: [...new Set(modes)], prohibited: override.prohibited, category: product.category };
}
