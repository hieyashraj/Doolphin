#!/usr/bin/env node
/**
 * MuAPI MODEL & PRICE DISCOVERY — the anti-hallucination tool.
 *
 * WHY THIS EXISTS
 * Hand-transcribing prices from playground pages into model definitions is how
 * pricing drifts and how the "we charged the 5-second rate for a 30-second
 * render" class of bug gets introduced. A published rate is also frequently a
 * PER-SECOND rate presented alongside a sample table (e.g. "$0.15/sec" with
 * rows for 5s/8s/10s) — transcribing the first number in that table as a flat
 * cost silently under-charges by up to 30x.
 *
 * This script asks MuAPI directly for its own model list and per-model spec, and
 * writes the result to disk verbatim. Nothing is inferred, rounded, or guessed.
 *
 * COST: this reads METADATA only (GET /api/v1/models and
 * GET /api/v1/models/{id}). It never calls a generation endpoint, so it does not
 * produce media and should not consume generation credit. Verify your MuAPI
 * balance before and after your first run if you want independent confirmation.
 *
 * SAFETY: refuses to run with a production credential. It requires
 * MUAPI_API_KEY_SANDBOX and asserts the resolved key is that sandbox key, so it
 * can never authenticate as production even if both variables are present.
 *
 * USAGE (run locally, never in CI against production):
 *   DOOLPHIN_ENV=staging MUAPI_API_KEY_SANDBOX=sk_... node scripts/discover-muapi-models.mjs
 *
 * Optional: restrict to the models you care about
 *   ... node scripts/discover-muapi-models.mjs --only veo3.1-fast-image-to-video,kling-v2.6-pro-i2v
 *
 * OUTPUT
 *   evidence/muapi-discovery/catalog-<timestamp>.json   full verbatim payloads
 *   evidence/muapi-discovery/pricing-report-<timestamp>.md  human-readable review
 */

import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const MUAPI_BASE = "https://api.muapi.ai";
const OUT_DIR = path.resolve("evidence/muapi-discovery");
const REQUEST_TIMEOUT_MS = 15000;

// The model families requested for Doolphin Video Studio. Discovery still lists
// everything MuAPI offers; this set is only used to flag which are of interest.
const REQUESTED_MODEL_IDS = [
  "veo3.1-lite-image-to-video",
  "veo3.1-4k-video",
  "veo3.1-fast-image-to-video",
  "kling-v2.6-pro-i2v",
  "kling-v3.0-pro-image-to-video",
  "openai-sora-2-pro-image-to-video",
  "grok-imagine-image-to-video",
  "gemini-omni-image-to-video",
  "seedance-2-omni-reference-no-video-fast",
  "seedance-2.5-spicy-video-extend-4k",
  "seedance-2.5-spicy-video-extend-1080p",
  "seedance-2.5-spicy-video-extend-480p",
  "seedance-2.5-spicy-video-edit-4k",
  "seedance-2.5-spicy-video-edit-1080p",
  "seedance-2.5-spicy-video-edit",
  "seedance-2.5-spicy-omni-reference-4k",
  "seedance-2.5-spicy-omni-reference-1080p",
  "seedance-2.5-spicy-omni-reference-480p",
  "seedance-2.5-spicy-omni-reference",
  "seedance-2.5-intl-omni-reference-1080p",
  "seedance-2.5-spicy-image-to-video-4k",
  "seedance-2.5-omni-reference-1080p",
  "seedance-2.5-omni-reference-480p",
  "seedance-2.5-image-to-video-4k",
  "seedance-2.5-image-to-video-1080p",
];

function resolveSandboxKeyOrExit() {
  const sandboxKey = process.env.MUAPI_API_KEY_SANDBOX;
  if (!sandboxKey || sandboxKey.includes("placeholder")) {
    console.error("REFUSING TO RUN: MUAPI_API_KEY_SANDBOX is required (and must not be a placeholder).");
    console.error("This script must never authenticate with a production credential.");
    process.exit(1);
  }
  if (process.env.MUAPI_API_KEY && process.env.MUAPI_API_KEY === sandboxKey) {
    console.error("REFUSING TO RUN: MUAPI_API_KEY and MUAPI_API_KEY_SANDBOX are identical.");
    console.error("Set them to genuinely different keys so sandbox work cannot bill production.");
    process.exit(1);
  }
  if (process.env.VERCEL_ENV === "production" || process.env.DOOLPHIN_ENV === "production") {
    console.error("REFUSING TO RUN: environment asserts production. Run this locally with DOOLPHIN_ENV=staging.");
    process.exit(1);
  }
  return sandboxKey;
}

async function getJson(url, apiKey) {
  const response = await fetch(url, {
    method: "GET",
    headers: { Accept: "application/json", "x-api-key": apiKey },
    redirect: "error",
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  const text = await response.text();
  let parsed = null;
  try { parsed = JSON.parse(text); } catch { /* keep raw */ }
  return { ok: response.ok, status: response.status, body: parsed, raw: text };
}

/**
 * Extracts every pricing signal present, WITHOUT collapsing it to one number.
 * A model may legitimately price per second, per resolution tier, or flat — and
 * the whole shape must be preserved for review. Anything unrecognised is
 * surfaced as `needsManualReview` rather than silently defaulted.
 */
function summarisePricing(spec) {
  if (!spec || typeof spec !== "object") return { needsManualReview: true, reason: "no spec object" };

  const dynamicPricing = spec.dynamic_pricing ?? spec.dynamicPricing ?? null;
  const estimateEndpoint = spec.estimate_endpoint ?? spec.estimateEndpoint ?? null;
  const cost = spec.cost ?? null;

  const summary = {
    dynamicPricing,
    estimateEndpoint,
    rawCost: cost,
    strategy: cost?.strategy ?? cost?.unit ?? null,
    amount: cost?.amount ?? cost?.cost ?? (typeof cost === "number" ? cost : null),
    currency: cost?.currency ?? "USD",
    // Preserve any tiered/table pricing verbatim rather than picking one row.
    tiers: spec.pricing_tiers ?? spec.price_tiers ?? spec.pricing ?? null,
  };

  // Fail loud on the exact shapes that previously caused mispricing.
  if (dynamicPricing === true && !estimateEndpoint) {
    summary.needsManualReview = true;
    summary.reason = "dynamic_pricing is true but no estimate_endpoint is published";
  } else if (dynamicPricing !== true) {
    if (summary.amount === null || summary.amount === undefined) {
      summary.needsManualReview = true;
      summary.reason = "fixed pricing declared but no cost amount published";
    } else if (!summary.strategy) {
      summary.needsManualReview = true;
      summary.reason = "cost amount published with NO strategy — cannot tell per-second from flat; refusing to assume";
    }
  }
  if (summary.tiers) {
    summary.needsManualReview = true;
    summary.reason = (summary.reason ? summary.reason + "; " : "") + "tiered pricing table present — confirm which dimension drives cost";
  }

  return summary;
}

function extractCapabilities(spec) {
  const schema = spec?.input_schema ?? spec?.inputSchema ?? null;
  const props = schema?.properties ?? {};
  const pick = (name) => props?.[name] ?? null;
  return {
    endpoint: spec?.endpoint ?? null,
    providerModelId: spec?.providerModelId ?? spec?.id ?? spec?.model_id ?? null,
    category: spec?.category ?? null,
    requiredInputs: Array.isArray(schema?.required) ? schema.required : [],
    duration: pick("duration"),
    aspectRatio: pick("aspect_ratio"),
    resolution: pick("resolution") ?? pick("quality") ?? pick("size"),
    supportsAudio: Boolean(pick("generate_audio")),
    acceptsImageList: Boolean(pick("images_list") ?? pick("image_url") ?? pick("image")),
    acceptsSourceVideo: Boolean(pick("video")),
    allInputKeys: Object.keys(props),
  };
}

async function main() {
  const apiKey = resolveSandboxKeyOrExit();
  const onlyArg = process.argv.find((a) => a.startsWith("--only"));
  const onlyList = onlyArg
    ? (onlyArg.includes("=") ? onlyArg.split("=")[1] : process.argv[process.argv.indexOf(onlyArg) + 1] || "")
        .split(",").map((s) => s.trim()).filter(Boolean)
    : null;

  fs.mkdirSync(OUT_DIR, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");

  console.log("Listing models from MuAPI (metadata only, no generation)...");
  const list = await getJson(`${MUAPI_BASE}/api/v1/models`, apiKey);
  if (!list.ok) {
    console.error(`FAILED: GET /api/v1/models -> HTTP ${list.status}`);
    console.error(list.raw.slice(0, 500));
    process.exit(1);
  }

  const models = Array.isArray(list.body) ? list.body : (list.body?.models ?? list.body?.data ?? []);
  console.log(`MuAPI returned ${models.length} models.`);

  const targets = onlyList && onlyList.length
    ? onlyList
    : REQUESTED_MODEL_IDS;

  const results = [];
  for (const id of targets) {
    process.stdout.write(`  fetching ${id} ... `);
    const detail = await getJson(`${MUAPI_BASE}/api/v1/models/${encodeURIComponent(id)}`, apiKey);
    if (!detail.ok) {
      console.log(`HTTP ${detail.status}`);
      results.push({ id, found: false, status: detail.status, raw: detail.raw?.slice(0, 300) });
      continue;
    }
    const spec = detail.body?.model ?? detail.body?.data ?? detail.body;
    const pricing = summarisePricing(spec);
    const capabilities = extractCapabilities(spec);
    results.push({ id, found: true, pricing, capabilities, rawSpec: spec });
    console.log(pricing.needsManualReview ? "OK (NEEDS REVIEW)" : "OK");
  }

  const catalogPath = path.join(OUT_DIR, `catalog-${stamp}.json`);
  fs.writeFileSync(catalogPath, JSON.stringify({
    fetchedAt: new Date().toISOString(),
    source: MUAPI_BASE,
    note: "Verbatim MuAPI metadata. Prices here are authoritative; do not hand-edit.",
    listedModelCount: models.length,
    listedModels: models,
    requested: results,
  }, null, 2));

  // Human-reviewable report
  const lines = [];
  lines.push(`# MuAPI Discovery Report`);
  lines.push(``);
  lines.push(`Fetched: ${new Date().toISOString()}`);
  lines.push(`Models listed by MuAPI: ${models.length}`);
  lines.push(``);
  lines.push(`> Prices below come directly from MuAPI's API. Any row marked NEEDS REVIEW`);
  lines.push(`> must be resolved before that model is sold, because its billing basis is`);
  lines.push(`> ambiguous from the metadata alone.`);
  lines.push(``);
  lines.push(`| Model | Found | Dynamic | Strategy | Amount | Estimate endpoint | Review |`);
  lines.push(`|---|---|---|---|---|---|---|`);
  for (const r of results) {
    if (!r.found) {
      lines.push(`| \`${r.id}\` | NO (HTTP ${r.status}) | - | - | - | - | **RESOLVE ID** |`);
      continue;
    }
    lines.push(`| \`${r.id}\` | yes | ${r.pricing.dynamicPricing} | ${r.pricing.strategy ?? "-"} | ${r.pricing.amount ?? "-"} | ${r.pricing.estimateEndpoint ? "yes" : "no"} | ${r.pricing.needsManualReview ? "**" + r.pricing.reason + "**" : "ok"} |`);
  }
  lines.push(``);
  lines.push(`## Capability detail`);
  for (const r of results.filter((x) => x.found)) {
    lines.push(``);
    lines.push(`### \`${r.id}\``);
    lines.push(`- endpoint: \`${r.capabilities.endpoint ?? "?"}\``);
    lines.push(`- category: ${r.capabilities.category ?? "?"}`);
    lines.push(`- required inputs: ${r.capabilities.requiredInputs.join(", ") || "none declared"}`);
    lines.push(`- all input keys: ${r.capabilities.allInputKeys.join(", ") || "none declared"}`);
    lines.push(`- duration: \`${JSON.stringify(r.capabilities.duration)}\``);
    lines.push(`- aspect ratio: \`${JSON.stringify(r.capabilities.aspectRatio)}\``);
    lines.push(`- resolution: \`${JSON.stringify(r.capabilities.resolution)}\``);
    lines.push(`- native audio: ${r.capabilities.supportsAudio}`);
    lines.push(`- accepts image refs: ${r.capabilities.acceptsImageList} | source video: ${r.capabilities.acceptsSourceVideo}`);
    lines.push(`- raw cost object: \`${JSON.stringify(r.pricing.rawCost)}\``);
    if (r.pricing.tiers) lines.push(`- **tiered pricing present**: \`${JSON.stringify(r.pricing.tiers)}\``);
  }
  const reportPath = path.join(OUT_DIR, `pricing-report-${stamp}.md`);
  fs.writeFileSync(reportPath, lines.join("\n"));

  const review = results.filter((r) => r.found && r.pricing.needsManualReview);
  const missing = results.filter((r) => !r.found);

  console.log(``);
  console.log(`Wrote ${catalogPath}`);
  console.log(`Wrote ${reportPath}`);
  console.log(``);
  console.log(`SUMMARY: ${results.filter((r) => r.found).length}/${targets.length} resolved, ${missing.length} unresolved ID(s), ${review.length} needing pricing review.`);
  if (missing.length) console.log(`Unresolved IDs: ${missing.map((m) => m.id).join(", ")}`);
  if (review.length) console.log(`Needs review: ${review.map((m) => m.id).join(", ")}`);
}

main().catch((error) => {
  console.error("Discovery failed:", error?.message || error);
  process.exit(1);
});
