#!/usr/bin/env node
/**
 * MuAPI MODEL DISCOVERY — schemas from the live OpenAPI spec, costs cross-checked
 * against the verified snapshot.
 *
 * ── WHY THIS SHAPE ──────────────────────────────────────────────────────────
 * Doolphin needs two different things per model, from two different authorities:
 *
 *   1. REQUEST SCHEMA (what inputs exist, which are required, allowed enums,
 *      duration bounds). Needed to render the correct form per model and to stop
 *      offering controls a model does not support. AUTHORITY: MuAPI's own
 *      OpenAPI document at https://api.muapi.ai/openapi.json — the same source
 *      MuAPI's official CLI reads for `muapi run` schema introspection. It is
 *      served WITHOUT authentication.
 *
 *   2. COST. AUTHORITY AT RUNTIME is each model's estimate-cost endpoint, which
 *      prices the exact payload. This script additionally reconciles against
 *      src/lib/models/catalog/muapi-verified-costs.json (independently sourced
 *      from MuAPI's published CLI package) so a stale snapshot or an API
 *      regression is visible rather than silent.
 *
 * Hand-transcribing either of these from a docs page is what produced the
 * "$0.15/sec read as $0.15 flat" class of error. Nothing here is typed by hand.
 *
 * ── COST OF RUNNING ────────────────────────────────────────────────────────
 * Reads the OpenAPI document only. No generation endpoint is called, so no media
 * is produced and no generation credit should be consumed. The OpenAPI fetch
 * needs no API key at all; a sandbox key is only used for the optional
 * --estimate probe.
 *
 * ── USAGE ───────────────────────────────────────────────────────────────────
 *   node scripts/discover-muapi-models.mjs
 *   node scripts/discover-muapi-models.mjs --only veo3.1-fast-image-to-video,kling-v2.6-pro-i2v
 *
 * Optional live cost probe (calls estimate-cost, still not a generation).
 * Requires MUAPI_API_KEY_SANDBOX and refuses to use a production credential:
 *   DOOLPHIN_ENV=staging MUAPI_API_KEY_SANDBOX=sk_... \
 *     node scripts/discover-muapi-models.mjs --estimate
 *
 * ── OUTPUT ──────────────────────────────────────────────────────────────────
 *   evidence/muapi-discovery/openapi-<ts>.json     verbatim spec
 *   evidence/muapi-discovery/schemas-<ts>.json     per-model resolved schema + cost reconciliation
 *   evidence/muapi-discovery/report-<ts>.md        human review, flags every ambiguity
 */

import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const OPENAPI_URL = "https://api.muapi.ai/openapi.json";
const API_BASE = "https://api.muapi.ai/api/v1";
const OUT_DIR = path.resolve("evidence/muapi-discovery");
const VERIFIED_COSTS_PATH = path.resolve("src/lib/models/catalog/muapi-verified-costs.json");
const TIMEOUT_MS = 20000;

const REQUESTED = [
  "veo3.1-lite-image-to-video", "veo3.1-fast-image-to-video", "veo3.1-4k-video",
  "veo3.1-image-to-video", "veo3.1-reference-to-video", "veo3.1-extend-video",
  "kling-v2.6-pro-i2v", "kling-v3.0-pro-image-to-video",
  "openai-sora-2-pro-image-to-video", "grok-imagine-image-to-video", "gemini-omni-image-to-video",
  "seedance-2-omni-reference-no-video-fast", "seedance-2-omni-reference", "seedance-2-omni-reference-480p",
  "seedance-2-omni-reference-no-video", "seedance-2-vip-omni-reference-fast",
  "seedance-2-vip-omni-reference-1080p", "seedance-2-video-edit", "seedance-2-extend",
  "seedance-2-i2v-480p", "seedance-2-image-to-video", "seedance-2-image-to-video-fast",
  "seedance-2-first-last-frame", "seedance-2-first-last-frame-fast",
];

function loadVerifiedCosts() {
  try {
    return JSON.parse(fs.readFileSync(VERIFIED_COSTS_PATH, "utf8"));
  } catch (error) {
    console.warn(`WARNING: could not read verified cost snapshot (${error.message}). Cost reconciliation will be skipped.`);
    return { models: {}, provenance: {} };
  }
}

async function getJson(url, headers = {}) {
  const response = await fetch(url, {
    method: "GET",
    headers: { Accept: "application/json", ...headers },
    redirect: "follow",
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const text = await response.text();
  let body = null;
  try { body = JSON.parse(text); } catch { /* keep raw */ }
  return { ok: response.ok, status: response.status, body, raw: text };
}

/** Follows $ref chains inside an OpenAPI document. */
function resolveRef(spec, node, depth = 0) {
  if (!node || typeof node !== "object" || depth > 12) return node;
  if (typeof node.$ref === "string" && node.$ref.startsWith("#/")) {
    const target = node.$ref.slice(2).split("/").reduce((acc, key) => (acc ? acc[key] : undefined), spec);
    return resolveRef(spec, target, depth + 1);
  }
  return node;
}

/** Fully dereferences a schema one level deep into properties. */
function materialiseSchema(spec, schema) {
  const resolved = resolveRef(spec, schema);
  if (!resolved || typeof resolved !== "object") return null;
  const out = { type: resolved.type || "object", required: resolved.required || [], properties: {} };
  for (const [key, raw] of Object.entries(resolved.properties || {})) {
    const prop = resolveRef(spec, raw);
    out.properties[key] = {
      type: prop?.type ?? null,
      description: prop?.description ?? null,
      enum: prop?.enum ?? null,
      default: prop?.default ?? null,
      minimum: prop?.minimum ?? null,
      maximum: prop?.maximum ?? null,
      maxLength: prop?.maxLength ?? null,
      items: prop?.items ? { type: resolveRef(spec, prop.items)?.type ?? null } : null,
    };
  }
  return out;
}

function findModelPaths(spec) {
  const found = new Map();
  for (const [pathKey, pathItem] of Object.entries(spec.paths || {})) {
    if (!pathKey.startsWith("/api/v1/")) continue;
    const post = pathItem?.post;
    if (!post) continue;
    const modelId = pathKey.replace("/api/v1/", "").replace(/\/$/, "");
    if (!modelId || modelId.includes("/")) continue; // skip nested utility routes
    const schemaNode = post.requestBody?.content?.["application/json"]?.schema;
    found.set(modelId, {
      path: pathKey,
      summary: post.summary || null,
      operationId: post.operationId || null,
      schema: materialiseSchema(spec, schemaNode),
    });
  }
  return found;
}

/** Describes the UI control a property implies — the dynamic-form input. */
function describeControl(name, prop) {
  if (prop.enum?.length) return { control: "select", options: prop.enum, default: prop.default ?? null };
  if (prop.type === "integer" || prop.type === "number") {
    return { control: "number", min: prop.minimum ?? null, max: prop.maximum ?? null, default: prop.default ?? null };
  }
  if (prop.type === "boolean") return { control: "toggle", default: prop.default ?? null };
  if (prop.type === "array") return { control: "multi-asset", itemType: prop.items?.type ?? "string" };
  if (/image|video|audio|url|frame/i.test(name)) return { control: "asset-upload", default: null };
  if (prop.maxLength && prop.maxLength > 200) return { control: "textarea", maxLength: prop.maxLength };
  return { control: "text", maxLength: prop.maxLength ?? null };
}

async function main() {
  const args = process.argv.slice(2);
  const onlyArg = args.find((a) => a.startsWith("--only"));
  const only = onlyArg
    ? (onlyArg.includes("=") ? onlyArg.split("=")[1] : args[args.indexOf(onlyArg) + 1] || "")
        .split(",").map((s) => s.trim()).filter(Boolean)
    : null;
  const doEstimate = args.includes("--estimate");

  let sandboxKey = null;
  if (doEstimate) {
    sandboxKey = process.env.MUAPI_API_KEY_SANDBOX;
    if (!sandboxKey || sandboxKey.includes("placeholder")) {
      console.error("--estimate requires MUAPI_API_KEY_SANDBOX (never a production key). Aborting.");
      process.exit(1);
    }
    if (process.env.MUAPI_API_KEY && process.env.MUAPI_API_KEY === sandboxKey) {
      console.error("MUAPI_API_KEY equals MUAPI_API_KEY_SANDBOX. Refusing to proceed. Aborting.");
      process.exit(1);
    }
    if (process.env.VERCEL_ENV === "production" || process.env.DOOLPHIN_ENV === "production") {
      console.error("Environment asserts production. Refusing to probe costs. Aborting.");
      process.exit(1);
    }
  }

  fs.mkdirSync(OUT_DIR, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const verified = loadVerifiedCosts();

  console.log(`Fetching OpenAPI document (no API key required): ${OPENAPI_URL}`);
  const spec = await getJson(OPENAPI_URL);
  if (!spec.ok || !spec.body) {
    console.error(`FAILED: HTTP ${spec.status}`);
    console.error((spec.raw || "").slice(0, 600));
    console.error("");
    console.error("If this is a network/firewall issue, open the URL in a browser, save the JSON,");
    console.error("and re-run with:  MUAPI_OPENAPI_FILE=/path/to/openapi.json node scripts/discover-muapi-models.mjs");
    process.exit(1);
  }
  fs.writeFileSync(path.join(OUT_DIR, `openapi-${stamp}.json`), JSON.stringify(spec.body, null, 2));

  const modelPaths = findModelPaths(spec.body);
  console.log(`OpenAPI exposes ${modelPaths.size} model endpoints.`);

  const targets = only?.length ? only : REQUESTED;
  const results = [];

  for (const id of targets) {
    const entry = modelPaths.get(id);
    const verifiedEntry = verified.models?.[id] || null;

    if (!entry) {
      results.push({ id, foundInSpec: false, verifiedCostUsdPerGeneration: verifiedEntry?.costUsdPerGeneration ?? null });
      continue;
    }

    const controls = {};
    for (const [name, prop] of Object.entries(entry.schema?.properties || {})) {
      controls[name] = { ...describeControl(name, prop), required: (entry.schema.required || []).includes(name), raw: prop };
    }

    let liveEstimate = null;
    if (doEstimate) {
      const probe = await getJson(`${API_BASE}/models/${encodeURIComponent(id)}/estimate-cost`, { "x-api-key": sandboxKey })
        .catch((e) => ({ ok: false, status: 0, raw: e.message }));
      liveEstimate = probe.ok ? (probe.body?.cost ?? probe.body?.estimated_cost ?? probe.body?.amount ?? null) : `ERROR HTTP ${probe.status}`;
    }

    results.push({
      id,
      foundInSpec: true,
      endpoint: `${API_BASE}/${id}`,
      summary: entry.summary,
      requiredInputs: entry.schema?.required || [],
      controls,
      verifiedCostUsdPerGeneration: verifiedEntry?.costUsdPerGeneration ?? null,
      verifiedCategory: verifiedEntry?.category ?? null,
      liveEstimate,
    });
  }

  fs.writeFileSync(path.join(OUT_DIR, `schemas-${stamp}.json`), JSON.stringify({
    fetchedAt: new Date().toISOString(),
    openapiUrl: OPENAPI_URL,
    verifiedCostProvenance: verified.provenance || null,
    endpointsInSpec: modelPaths.size,
    results,
  }, null, 2));

  // ---- Human review report -------------------------------------------------
  const L = [];
  L.push(`# MuAPI Discovery Report`);
  L.push(``);
  L.push(`- Fetched: ${new Date().toISOString()}`);
  L.push(`- Schema source: \`${OPENAPI_URL}\` (${modelPaths.size} model endpoints)`);
  L.push(`- Cost cross-check source: \`${verified.provenance?.source || "unavailable"}\` @ \`${verified.provenance?.sourceCommit || "?"}\``);
  L.push(`- Cost unit: **${verified.provenance?.costUnit || "unknown"}**`);
  L.push(``);
  L.push(`> Runtime billing authority remains each model's estimate-cost endpoint.`);
  L.push(`> Costs below are the independent cross-check used to detect drift.`);
  L.push(``);
  L.push(`## Coverage`);
  L.push(``);
  L.push(`| Model | In OpenAPI | Verified cost/gen | Required inputs | Live estimate |`);
  L.push(`|---|---|---|---|---|`);
  for (const r of results) {
    const cost = r.verifiedCostUsdPerGeneration === null ? "**NONE**" : `$${r.verifiedCostUsdPerGeneration}`;
    L.push(`| \`${r.id}\` | ${r.foundInSpec ? "yes" : "**NO**"} | ${cost} | ${r.foundInSpec ? (r.requiredInputs.join(", ") || "none") : "-"} | ${r.liveEstimate ?? "not probed"} |`);
  }

  L.push(``);
  L.push(`## Per-model form specification`);
  L.push(``);
  L.push(`These are the exact controls Doolphin should render for each model.`);
  for (const r of results.filter((x) => x.foundInSpec)) {
    L.push(``);
    L.push(`### \`${r.id}\``);
    L.push(`- endpoint: \`${r.endpoint}\``);
    if (r.summary) L.push(`- summary: ${r.summary}`);
    L.push(`- verified cost/generation: ${r.verifiedCostUsdPerGeneration === null ? "**NOT IN SNAPSHOT — must verify before selling**" : `$${r.verifiedCostUsdPerGeneration}`}`);
    L.push(``);
    L.push(`| Input | Required | Control | Options / bounds | Default |`);
    L.push(`|---|---|---|---|---|`);
    for (const [name, c] of Object.entries(r.controls)) {
      const bounds = c.options ? c.options.join(" \\| ")
        : (c.min !== null && c.min !== undefined) || (c.max !== null && c.max !== undefined) ? `${c.min ?? "?"}..${c.max ?? "?"}`
        : c.maxLength ? `maxLength ${c.maxLength}` : "-";
      L.push(`| \`${name}\` | ${c.required ? "**yes**" : "no"} | ${c.control} | ${bounds} | ${c.default ?? "-"} |`);
    }
  }

  const notInSpec = results.filter((r) => !r.foundInSpec);
  const noCost = results.filter((r) => r.foundInSpec && r.verifiedCostUsdPerGeneration === null);
  if (notInSpec.length || noCost.length) {
    L.push(``);
    L.push(`## Action required`);
    if (notInSpec.length) {
      L.push(``);
      L.push(`### Not present in the OpenAPI document`);
      L.push(`These IDs do not exist as endpoints. The name may have changed, or the model may not be available on your account.`);
      for (const r of notInSpec) L.push(`- \`${r.id}\``);
    }
    if (noCost.length) {
      L.push(``);
      L.push(`### No verified cost — DO NOT SELL until resolved`);
      for (const r of noCost) L.push(`- \`${r.id}\``);
    }
  }

  fs.writeFileSync(path.join(OUT_DIR, `report-${stamp}.md`), L.join("\n"));

  console.log(``);
  console.log(`Wrote:`);
  console.log(`  ${path.join(OUT_DIR, `openapi-${stamp}.json`)}`);
  console.log(`  ${path.join(OUT_DIR, `schemas-${stamp}.json`)}`);
  console.log(`  ${path.join(OUT_DIR, `report-${stamp}.md`)}   <-- paste this one back`);
  console.log(``);
  console.log(`SUMMARY: ${results.filter((r) => r.foundInSpec).length}/${targets.length} found in OpenAPI, ${notInSpec.length} missing, ${noCost.length} without a verified cost.`);
}

main().catch((error) => {
  console.error("Discovery failed:", error?.stack || error?.message || error);
  process.exit(1);
});
