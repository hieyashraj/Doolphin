import ceilings from "./catalog/muapi-cost-ceilings.json" with { type: "json" };
import { calculateRequiredCredits } from "../entitlements/pricing.js";

/**
 * THE USER-FACING MODEL CATALOGUE
 * ===============================
 * Turns the pricing document into the list the model selector renders: grouped
 * by family, badged with resolution and duration, tagged NEW or Coming soon, and
 * carrying an indicative credit cost.
 *
 * Derived from the same artifact the billing guards read, so the catalogue cannot
 * advertise a model the pricing layer would refuse, or show a cost the billing
 * layer disagrees with. A separate hand-maintained UI list is exactly how a
 * selector ends up offering models that fail on click.
 *
 * Credit figures here are INDICATIVE, computed from the documented ceiling so the
 * user sees the most it could cost. The amount actually charged comes from the
 * provider's own estimate at preflight, which is never higher than this bound.
 */

const MODELS = ceilings.models;

/** Families ordered so the newest and most capable appear first. */
const FAMILY_ORDER = [
  "seedance-2.5",
  "veo-4",
  "veo3.1",
  "sora",
  "kling-v3-omni",
  "kling-v3.0",
  "sd-2",
  "sd-v2.0",
  "veo",
  "kling-v2.6",
  "kling-o1",
  "kling-v2.5",
  "grok",
  "gpt",
  "video-generation",
];

/** Human labels for the family group headers. */
const FAMILY_LABELS = Object.freeze({
  "seedance-2.5": "Seedance 2.5",
  "seedance-2": "Seedance 2",
  "sd-2": "Seedance 2",
  "sd-v2.0": "Seedance 2.0",
  "veo-4": "Veo 4",
  "veo3.1": "Veo 3.1",
  veo: "Veo 3",
  sora: "OpenAI Sora 2",
  "kling-v3-omni": "Kling 3 Omni",
  "kling-v3.0": "Kling 3.0",
  "kling-v2.6": "Kling 2.6",
  "kling-v2.5": "Kling 2.5",
  "kling-o1": "Kling O1",
  grok: "Grok Imagine",
  gpt: "OpenAI GPT Image",
  "video-generation": "Other",
});

/** Coarse mode used for the primary tabs, from the provider category. */
function modeFor(category) {
  const c = String(category || "").toLowerCase();
  if (c.includes("video to video")) return "EDIT_VIDEO";
  if (c.includes("image to video")) return "IMAGE_TO_VIDEO";
  if (c.includes("text to video")) return "TEXT_TO_VIDEO";
  if (c.includes("text to image")) return "TEXT_TO_IMAGE";
  if (c.includes("audio to video")) return "AUDIO_TO_VIDEO";
  return "OTHER";
}

/** `4s-30s`, or `8s` when the model has a single fixed duration. */
function durationLabel(min, max) {
  if (!max) return null;
  if (!min || min === max) return `${max}s`;
  return `${min}s-${max}s`;
}

/**
 * Indicative credit cost at the documented ceiling.
 *
 * Deliberately the CEILING rather than the default: a user shown the default
 * price for a model that costs six times more at the settings they are about to
 * pick would consider that a bait-and-switch. Showing the maximum means the
 * number can only ever go down at preflight.
 */
function indicativeCredits(entry) {
  const usd = entry.effectiveCeilingUsd ?? entry.ceilingUsd;
  if (usd === null || usd === undefined) return null;
  return Number(
    calculateRequiredCredits({
      provider: BigInt(Math.ceil(usd * 1_000_000)),
      infra: 20_000n,
    }).quotedCredits,
  );
}

/**
 * Badges for one model, in render order.
 *
 * `kind` is returned alongside `label` so the UI can pick an icon per badge type
 * without re-parsing the string.
 */
function badgesFor(entry) {
  const badges = [];

  if (entry.resolutions?.length) {
    // Normalise casing before display: the document writes 4k, 4K, 2K and 1K
    // inconsistently, and a badge reading "720p-4k" next to another reading
    // "4K" looks like a bug.
    const canonical = (value) => {
      const v = String(value).trim().toLowerCase();
      if (v === "4k") return "4K";
      if (v === "2k") return "2K";
      if (v === "1k") return "1K";
      return v;
    };
    // Descending capability, so the headline resolution is unambiguous.
    const ranked = ["4K", "2K", "1080p", "720p", "540p", "480p", "1K"];
    const sorted = [...new Set(entry.resolutions.map(canonical))].sort(
      (a, b) => ranked.indexOf(a) - ranked.indexOf(b),
    );
    const label = sorted.length > 1 ? `${sorted[sorted.length - 1]}-${sorted[0]}` : sorted[0];
    badges.push({ kind: "resolution", label });
  }

  const duration = durationLabel(entry.durationMinSeconds, entry.durationMaxSeconds);
  if (duration) badges.push({ kind: "duration", label: duration });

  if (modeFor(entry.category) === "EDIT_VIDEO") {
    badges.push({ kind: "capability", label: "Edit Video" });
  }

  // Reference-input capabilities, which are a real differentiator between
  // otherwise similar models.
  const limits = entry.referenceLimits || {};
  if (limits.audios) badges.push({ kind: "capability", label: "Audio" });
  if (limits.videos) badges.push({ kind: "capability", label: `${limits.videos} video refs` });
  else if (limits.images) badges.push({ kind: "capability", label: `${limits.images} image refs` });

  return badges;
}

function toCatalogueEntry(providerModelId, entry) {
  const comingSoon = entry.availability === "COMING_SOON";
  return Object.freeze({
    providerModelId,
    title: entry.title || providerModelId,
    family: entry.family,
    familyLabel: FAMILY_LABELS[entry.family] || entry.family || "Other",
    category: entry.category,
    mode: modeFor(entry.category),
    resolutions: entry.resolutions ?? [],
    minDurationSeconds: entry.durationMinSeconds,
    maxDurationSeconds: entry.durationMaxSeconds,
    durationLabel: durationLabel(entry.durationMinSeconds, entry.durationMaxSeconds),
    badges: badgesFor(entry),
    isNew: Boolean(entry.isNew),
    available: !comingSoon,
    comingSoon,
    /**
     * Why it cannot be used yet, phrased for a user rather than an engineer.
     * Null when the model is available.
     */
    comingSoonLabel: comingSoon
      ? entry.comingSoonReason === "UNRELEASED_NO_PUBLISHED_PRICING"
        ? "Not released by the provider yet"
        : "Awaiting final pricing from the provider"
      : null,
    /** Present only for models billed per second of user-supplied video. */
    inputVideoCapSeconds: entry.inputVideoPolicy?.applies
      ? entry.inputVideoPolicy.capSeconds
      : null,
    referenceLimits: entry.referenceLimits ?? {},
    maxCredits: indicativeCredits(entry),
    endpoint: entry.endpoint ?? null,
  });
}

/** Every documented model, including coming-soon ones. */
export function listCatalogueModels({ includeComingSoon = true, mode = null } = {}) {
  return Object.entries(MODELS)
    .map(([id, entry]) => toCatalogueEntry(id, entry))
    .filter((m) => (includeComingSoon ? true : m.available))
    .filter((m) => (mode ? m.mode === mode : true))
    .sort((a, b) => {
      // Available before coming-soon, then by family order, then NEW first,
      // then cheapest first so the affordable option is the easy one to reach.
      if (a.available !== b.available) return a.available ? -1 : 1;
      const fa = FAMILY_ORDER.indexOf(a.family);
      const fb = FAMILY_ORDER.indexOf(b.family);
      if (fa !== fb) return (fa === -1 ? 999 : fa) - (fb === -1 ? 999 : fb);
      if (a.isNew !== b.isNew) return a.isNew ? -1 : 1;
      return (a.maxCredits ?? 0) - (b.maxCredits ?? 0);
    });
}

/** The same list grouped into family sections for a sectioned dropdown. */
export function listCatalogueGroupedByFamily(options = {}) {
  const groups = new Map();
  for (const model of listCatalogueModels(options)) {
    if (!groups.has(model.family)) {
      groups.set(model.family, {
        family: model.family,
        familyLabel: model.familyLabel,
        isNew: false,
        models: [],
      });
    }
    const group = groups.get(model.family);
    group.models.push(model);
    if (model.isNew) group.isNew = true;
  }
  return [...groups.values()];
}

export function getCatalogueModel(providerModelId) {
  const entry = MODELS[String(providerModelId || "")];
  return entry ? toCatalogueEntry(String(providerModelId), entry) : null;
}

/**
 * A small featured set for the top of the selector.
 *
 * Newest family first, cheapest within it, so the highlighted options are both
 * current and affordable rather than merely expensive.
 */
export function listFeaturedModels(limit = 6) {
  return listCatalogueModels({ includeComingSoon: false })
    .filter((m) => m.isNew || m.family === "veo3.1" || m.family === "sora")
    .slice(0, limit);
}

export const CATALOGUE_REVISION = ceilings.revision;
