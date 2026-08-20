#!/usr/bin/env node
/**
 * MuAPI MODEL, SCHEMA & PRICE DISCOVERY — authoritative, no guessing.
 *
 * ── CONFIRMED API SURFACE ───────────────────────────────────────────────────
 * Verified against MuAPI's own OpenAPI document (https://api.muapi.ai/openapi.json):
 *
 *   GET  /api/v1/models
 *        Public catalog of every model, with human-readable description,
 *        category, base USD `cost` per call, and a `pricing_strategy` flag.
 *
 *   GET  /api/v1/models/{name}
 *        Pricing + metadata for one model, PLUS the full `input_schema` and
 *        `output_schema` — i.e. everything needed to render a correct per-model
 *        form without reading /openapi.json.
 *
 *   POST /api/v1/models/{name}/estimate-cost
 *        Body is the same JSON you would POST to /api/v1/{name}. For models with
 *        dynamic pricing (duration, resolution, audio length, ...) this runs the
 *        SAME cost function the billing system uses, so the quote matches what
 *        you will actually be charged. For fixed-price models it returns the base
 *        cost unchanged. Intended exactly for pre-flight price preview in a UI.
 *
 * ── PRICING SEMANTICS (this is the part that must never be guessed) ─────────
 *   pricing_strategy == "fixed_cost"  ->  `cost` IS the exact USD price per call.
 *   anything else (dynamic)           ->  `cost` is only a REPRESENTATIVE BASE.
 *                                         The real price depends on the payload
 *                                         and MUST come from estimate-cost.
 *
 * Treating a dynamic model's base `cost` as the final price is precisely the
 * mis-pricing this script exists to prevent.
 *
 * ── COST OF RUNNING ────────────────────────────────────────────────────────
 * Catalog and schema reads are GETs. estimate-cost is a POST but is explicitly a
 * pricing-preview endpoint — it quotes, it does not generate, and it returns no
 * media. No generation endpoint (POST /api/v1/{name}) is ever called here.
 * Still, --estimate is opt-in and refuses to use a production credential.
 *
 * ── USAGE ───────────────────────────────────────────────────────────────────
 *   # Catalog + per-model schemas (recommended first run)
 *   MUAPI_API_KEY_SANDBOX=sk_... node scripts/discover-muapi-models.mjs
 *
 *   # Also fetch exact prices for representative payloads of dynamic models
 *   DOOLPHIN_ENV=staging MUAPI_API_KEY_SANDBOX=sk_... \
 *     node scripts/discover-muapi-models.mjs --estimate
 *
 *   # Limit to specific models
 *   ... --only veo3.1-fast-image-to-video,kling-v2.6-pro-i2v
 *
 * ── OUTPUT ──────────────────────────────────────────────────────────────────
 *   evidence/muapi-discovery/catalog-<ts>.json    verbatim GET /models
 *   evidence/muapi-discovery/models-<ts>.json     per-model schema + pricing
 *   evidence/muapi-discovery/report-<ts>.md       human review  <-- send this back
 */

import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const API = "https://api.muapi.ai/api/v1";
const OUT_DIR = path.resolve("evidence/muapi-discovery");
const TIMEOUT_MS = 25000;

/** Models Doolphin intends to sell in Video Studio. */
const TARGETS = [
  // Seedance 2 family (the "2.5-spicy-*" names do not exist upstream)
  "seedance-2-omni-reference-no-video-fast", "seedance-2-omni-reference-no-video",
  "seedance-2-omni-reference", "seedance-2-omni-reference-480p",
  "seedance-2-vip-omni-reference-fast", "seedance-2-vip-omni-reference",
  "seedance-2-vip-omni-reference-1080p",
  "seedance-2-image-to-video", "seedance-2-image-to-video-fast", "seedance-2-i2v", "seedance-2-i2v-480p",
  "seedance-2-first-last-frame", "seedance-2-first-last-frame-fast",
  "seedance-2-video-edit", "seedance-2-extend", "seedance-2-vip-extend", "seedance-2-vip-extend-1080p",
  "seedance-2-new-omni", "seedance-2-new-first-last",
  // Veo
  "veo3.1-lite-image-to-video", "veo3.1-fast-image-to-video", "veo3.1-image-to-video",
  "veo3.1-4k-video", "veo3.1-reference-to-video", "veo3.1-extend-video", "veo-4-image-to-video",
  // Kling
  "kling-v2.6-pro-i2v", "kling-v3.0-pro-image-to-video", "kling-v3.0-standard-image-to-video",
  "kling-v3.0-omni-pro-image-to-video", "kling-v3.0-4k-image-to-video",
  "kling-o1-image-to-video", "kling-o1-reference-to-video", "kling-o1-video-edit",
  // Others
  "openai-sora-2-image-to-video", "openai-sora-2-pro-image-to-video",
  "grok-imagine-image-to-video", "grok-imagine-extend",
  "gemini-omni-image-to-video", "gemini-omni-video-edit",
];

/** Minimal representative payloads used ONLY for estimate-cost previews. */
const ESTIMATE_PAYLOADS = {
  default: { prompt: "pricing probe", duration: 5, aspect_ratio: "9:16" },
  durations: [4, 5, 8, 10, 15, 30],
};

function resolveKey({ required }) {
  const sandbox = process.env.MUAPI_API_KEY_SANDBOX;
  if (process.env.VERCEL_ENV === "production" || process.env.DOOLPHIN_ENV === "production") {
    console.error("REFUSING: environment asserts production. Run locally with DOOLPHIN_ENV=staging.");
    process.exit(1);
  }
  if (sandbox && process.env.MUAPI_API_KEY && process.env.MUAPI_API_KEY === sandbox) {
    console.error("REFUSING: MUAPI_API_KEY equals MUAPI_API_KEY_SANDBOX. Use genuinely different keys.");
    process.exit(1);
  }
  if (required && (!sandbox || sandbox.includes("placeholder"))) {
    console.error("REFUSING: MUAPI_API_KEY_SANDBOX is required (never a production key).");
    process.exit(1);
  }
  return sandbox || null;
}

async function req(url, { method = "GET", key = null, body = null } = {}) {
  const headers = { Accept: "application/json" };
  if (key) headers["x-api-key"] = key;
  if (body) headers["Content-Type"] = "application/json";
  let response;
  try {
    response = await fetch(url, {
      method, headers,
      body: body ? JSON.stringify(body) : undefined,
      redirect: "follow",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (error) {
    return { ok: false, status: 0, error: error?.message || String(error) };
  }
  const text = await response.text();
  let parsed = null;
  try { parsed = JSON.parse(text); } catch { /* keep raw */ }
  // Generations return the real charge in this header; capture it if present.
  const costHeader = response.headers.get("x-muapi-cost-usd");
  return { ok: response.ok, status: response.status, body: parsed, raw: text, costHeader };
}

/** Reads the exact cost from an estimate-cost response, without inventing one. */
function readCost(body) {
  if (!body || typeof body !== "object") return null;
  for (const k of ["cost", "cost_usd", "estimated_cost", "amount", "amount_usd", "price", "total_cost"]) {
    if (body[k] !== undefined && body[k] !== null) return Number(body[k]);
  }
  return null;
}

function isFixedPrice(strategy) {
  const s = String(strategy || "").toLowerCase();
  return s === "fixed_cost" || s === "fixed" || s === "per_request" || s === "per_generation";
}

/** Maps a JSON-schema property to the UI control the studio should render. */
function control(name, prop = {}) {
  const t = prop.type;
  if (Array.isArray(prop.enum) && prop.enum.length) return { control: "select", options: prop.enum, default: prop.default ?? null };
  if (t === "integer" || t === "number") return { control: "number", min: prop.minimum ?? null, max: prop.maximum ?? null, default: prop.default ?? null };
  if (t === "boolean") return { control: "toggle", default: prop.default ?? null };
  if (t === "array") return { control: "multi-asset", itemType: prop.items?.type ?? "string", maxItems: prop.maxItems ?? null };
  if (/image|video|audio|url|frame|mask/i.test(name)) return { control: "asset-upload" };
  if ((prop.maxLength ?? 0) > 200 || /prompt|description|script/i.test(name)) return { control: "textarea", maxLength: prop.maxLength ?? null };
  return { control: "text", maxLength: prop.maxLength ?? null };
}

async function main() {
  const args = process.argv.slice(2);
  const doEstimate = args.includes("--estimate");
  const onlyArg = args.find((a) => a.startsWith("--only"));
  const only = onlyArg
    ? (onlyArg.includes("=") ? onlyArg.split("=")[1] : args[args.indexOf(onlyArg) + 1] || "")
        .split(",").map((s) => s.trim()).filter(Boolean)
    : null;

  const key = resolveKey({ required: doEstimate });
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");

  // ---- 1. Full catalog ----------------------------------------------------
  console.log(`GET ${API}/models`);
  const catalog = await req(`${API}/models`, { key });
  if (!catalog.ok) {
    console.error(`FAILED: HTTP ${catalog.status} ${catalog.error || ""}`);
    console.error((catalog.raw || "").slice(0, 500));
    console.error(`\nIf this needs auth, set MUAPI_API_KEY_SANDBOX and retry.`);
    process.exit(1);
  }
  const list = Array.isArray(catalog.body) ? catalog.body : (catalog.body?.models ?? catalog.body?.data ?? []);
  fs.writeFileSync(path.join(OUT_DIR, `catalog-${stamp}.json`), JSON.stringify(catalog.body, null, 2));
  console.log(`  -> ${list.length} models in catalog`);

  const byName = new Map(list.map((m) => [m.name ?? m.model ?? m.id, m]));
  const targets = only?.length ? only : TARGETS;

  // ---- 2. Per-model schema + pricing -------------------------------------
  const results = [];
  for (const name of targets) {
    process.stdout.write(`  ${name} ... `);
    const detail = await req(`${API}/models/${encodeURIComponent(name)}`, { key });
    if (!detail.ok) {
      console.log(`HTTP ${detail.status}`);
      results.push({ name, found: false, status: detail.status });
      continue;
    }
    const spec = detail.body?.model ?? detail.body?.data ?? detail.body;
    const strategy = spec?.pricing_strategy ?? spec?.pricingStrategy ?? byName.get(name)?.pricing_strategy ?? null;
    const baseCost = spec?.cost ?? byName.get(name)?.cost ?? null;
    const fixed = isFixedPrice(strategy);

    const inputSchema = spec?.input_schema ?? spec?.inputSchema ?? null;
    const props = inputSchema?.properties ?? {};
    const controls = {};
    for (const [k, v] of Object.entries(props)) {
      controls[k] = { ...control(k, v), required: (inputSchema?.required ?? []).includes(k), raw: v };
    }

    // ---- 3. Exact price via estimate-cost (dynamic models only) ----------
    let estimates = null;
    if (doEstimate) {
      estimates = {};
      const durationProp = props.duration;
      const durations = fixed
        ? [null] // fixed price: payload cannot change the cost
        : (durationProp ? ESTIMATE_PAYLOADS.durations.filter((d) =>
            (durationProp.minimum == null || d >= durationProp.minimum) &&
            (durationProp.maximum == null || d <= durationProp.maximum)) : [null]);

      for (const d of durations) {
        const payload = { ...ESTIMATE_PAYLOADS.default };
        if (d === null) delete payload.duration; else payload.duration = d;
        if (props.aspect_ratio?.enum?.length && !props.aspect_ratio.enum.includes(payload.aspect_ratio)) {
          payload.aspect_ratio = props.aspect_ratio.enum[0];
        }
        const q = await req(`${API}/models/${encodeURIComponent(name)}/estimate-cost`, { method: "POST", key, body: payload });
        estimates[d === null ? "base" : `${d}s`] = q.ok
          ? { exactCostUsd: readCost(q.body), raw: q.body }
          : { error: `HTTP ${q.status}`, raw: (q.raw || "").slice(0, 200) };
      }
    }

    results.push({
      name, found: true,
      endpoint: `${API}/${name}`,
      category: spec?.category ?? null,
      description: spec?.description ?? null,
      pricingStrategy: strategy,
      pricingStrategyKnown: strategy !== null && strategy !== undefined,
      isFixedPrice: fixed,
      baseCostUsd: baseCost,
      exactCostIsBaseCost: fixed,
      requiredInputs: inputSchema?.required ?? [],
      controls,
      estimates,
      rawSpec: spec,
    });
    console.log(fixed ? `OK (fixed $${baseCost})` : `OK (dynamic, base $${baseCost})`);
  }

  fs.writeFileSync(path.join(OUT_DIR, `models-${stamp}.json`), JSON.stringify({
    fetchedAt: new Date().toISOString(), api: API, catalogSize: list.length, results,
  }, null, 2));

  // ---- 4. Report ---------------------------------------------------------
  const L = [];
  L.push(`# MuAPI Discovery Report`);
  L.push(``);
  L.push(`- Fetched: ${new Date().toISOString()}`);
  L.push(`- Catalog size: ${list.length} models`);
  L.push(`- estimate-cost probed: ${doEstimate ? "yes" : "no (re-run with --estimate for exact dynamic prices)"}`);
  L.push(``);
  L.push(`## Pricing semantics`);
  L.push(``);
  L.push(`- \`pricing_strategy == fixed_cost\` -> base cost IS the exact price per call.`);
  L.push(`- any other strategy -> base cost is only REPRESENTATIVE; the exact price`);
  L.push(`  comes from \`POST /api/v1/models/{name}/estimate-cost\` for the actual payload.`);
  L.push(``);
  L.push(`## Coverage`);
  L.push(``);
  L.push(`| Model | Found | Strategy | Fixed? | Base cost | Exact prices |`);
  L.push(`|---|---|---|---|---|---|`);
  for (const r of results) {
    if (!r.found) { L.push(`| \`${r.name}\` | **NO (${r.status})** | - | - | - | - |`); continue; }
    const ex = r.estimates
      ? Object.entries(r.estimates).map(([k, v]) => `${k}=${v.exactCostUsd ?? v.error}`).join(", ")
      : "not probed";
    L.push(`| \`${r.name}\` | yes | ${r.pricingStrategy ?? "**UNKNOWN**"} | ${r.isFixedPrice ? "yes" : "no"} | $${r.baseCostUsd ?? "?"} | ${ex} |`);
  }

  L.push(``);
  L.push(`## Per-model form specification`);
  for (const r of results.filter((x) => x.found)) {
    L.push(``);
    L.push(`### \`${r.name}\``);
    L.push(`- endpoint: \`${r.endpoint}\``);
    L.push(`- category: ${r.category ?? "?"}`);
    L.push(`- pricing: ${r.isFixedPrice ? `FIXED $${r.baseCostUsd} per call` : `DYNAMIC (base $${r.baseCostUsd}; exact via estimate-cost)`}`);
    if (r.estimates) {
      for (const [k, v] of Object.entries(r.estimates)) {
        L.push(`  - ${k}: ${v.exactCostUsd !== undefined && v.exactCostUsd !== null ? `$${v.exactCostUsd}` : v.error}`);
      }
    }
    L.push(`- required inputs: ${r.requiredInputs.join(", ") || "none declared"}`);
    L.push(``);
    L.push(`| Input | Required | Control | Options / bounds | Default |`);
    L.push(`|---|---|---|---|---|`);
    for (const [k, c] of Object.entries(r.controls)) {
      const bounds = c.options ? c.options.join(" \\| ")
        : (c.min != null || c.max != null) ? `${c.min ?? "?"}..${c.max ?? "?"}`
        : c.maxLength ? `maxLength ${c.maxLength}`
        : c.maxItems ? `maxItems ${c.maxItems}` : "-";
      L.push(`| \`${k}\` | ${c.required ? "**yes**" : "no"} | ${c.control} | ${bounds} | ${c.default ?? "-"} |`);
    }
  }

  const missing = results.filter((r) => !r.found);
  const unknownStrategy = results.filter((r) => r.found && !r.pricingStrategyKnown);
  if (missing.length || unknownStrategy.length) {
    L.push(``);
    L.push(`## Action required`);
    if (missing.length) {
      L.push(``); L.push(`### Not found (ID may have changed, or not enabled on this account)`);
      for (const r of missing) L.push(`- \`${r.name}\` (HTTP ${r.status})`);
    }
    if (unknownStrategy.length) {
      L.push(``); L.push(`### pricing_strategy missing — DO NOT SELL until resolved`);
      L.push(`Without this flag we cannot tell an exact price from a representative base.`);
      for (const r of unknownStrategy) L.push(`- \`${r.name}\``);
    }
  }

  fs.writeFileSync(path.join(OUT_DIR, `report-${stamp}.md`), L.join("\n"));

  console.log(``);
  console.log(`Wrote:`);
  console.log(`  ${path.join(OUT_DIR, `catalog-${stamp}.json`)}`);
  console.log(`  ${path.join(OUT_DIR, `models-${stamp}.json`)}`);
  console.log(`  ${path.join(OUT_DIR, `report-${stamp}.md`)}   <-- send this back`);
  console.log(``);
  console.log(`SUMMARY: ${results.filter((r) => r.found).length}/${targets.length} found | ${missing.length} missing | ${unknownStrategy.length} without a pricing_strategy`);
}

main().catch((e) => { console.error("Discovery failed:", e?.stack || e?.message || e); process.exit(1); });
