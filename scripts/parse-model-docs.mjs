#!/usr/bin/env node
/**
 * Parses the founder-supplied "Models and their Pricing" document (already
 * flattened to text by scripts/extract-docx.mjs) into a structured catalog.
 *
 * WHY THIS EXISTS
 * ---------------
 * The provider catalog's `cost` field is the price at each model's DEFAULT
 * parameters, not the maximum a single call can cost. The document exposes the
 * full price surface -- duration tables, resolution tiers, quality tiers -- and
 * for several models the maximum is many times the default:
 *
 *   veo3.1-lite-image-to-video   $0.30 (720p default)  ->  $1.50 (4k)     5.0x
 *   seedance-2.5-omni-reference  $1.70 (5s default)    ->  $10.20 (30s)   6.0x
 *
 * Billing a user against the default cost while the provider charges the
 * maximum is a direct, user-controllable money leak. This parser therefore
 * extracts the whole price surface and derives an explicit ceiling per model.
 *
 * Output: src/lib/models/catalog/muapi-model-docs.json
 */
import { readFileSync, writeFileSync } from "node:fs";

const SRC = process.argv[2] ?? ".work/models-pricing.txt";
const OUT = process.argv[3] ?? "src/lib/models/catalog/muapi-model-docs.json";

const raw = readFileSync(SRC, "utf8");
const allLines = raw.split("\n");

/** Section markers that terminate the "Result"/pricing region. */
const SECTION_ICONS = ["📝", "💰", "⚙️", "📖", "❓"];

/** Normalise a heading into the provider's model name. */
function normaliseSlug(heading) {
  return heading
    .replace(/^#\s*/, "")
    .trim()
    .replace(/^\/+/, "")
    .replace(/^muapi\//, "")
    .trim();
}

/** Parse a money token like `$1.20` / `$0.15` / `$1.5` into a number. */
function money(token) {
  const m = /\$\s*([0-9]+(?:\.[0-9]+)?)/.exec(token ?? "");
  return m ? Number(m[1]) : null;
}

/** Split the flattened document into per-model line ranges. */
function splitSections(lines) {
  const starts = [];
  lines.forEach((line, i) => {
    if (/^#\s+\S/.test(line)) starts.push(i);
  });
  return starts.map((start, idx) => ({
    slug: normaliseSlug(lines[start]),
    headingRaw: lines[start].replace(/^#\s*/, "").trim(),
    start,
    end: idx + 1 < starts.length ? starts[idx + 1] : lines.length,
  }));
}

const isTabRow = (line) => line.includes("\t");
const cells = (line) => line.split("\t").map((c) => c.trim());

/**
 * Finds every tab-delimited table in a line range whose header's final column
 * is `Cost`. Returns { header, rows } where rows keep the raw cell order.
 */
function findCostTables(lines) {
  const tables = [];
  for (let i = 0; i < lines.length; i += 1) {
    if (!isTabRow(lines[i])) continue;
    const header = cells(lines[i]);
    if (header.length < 2) continue;
    if (header[header.length - 1].toLowerCase() !== "cost") continue;
    // 'Provider | Cost | Notes' tables end in Notes, so they never match here.
    const rows = [];
    let j = i + 1;
    while (j < lines.length) {
      const line = lines[j];
      if (!isTabRow(line)) {
        // A blank/prose line ends the table, but provider tables interleave
        // notes lines; for cost tables a non-tab line is a genuine terminator.
        break;
      }
      const row = cells(line);
      if (row.length !== header.length) break;
      rows.push(row);
      j += 1;
    }
    if (rows.length) tables.push({ header, rows, at: i });
    i = j - 1;
  }
  return tables;
}

/** Extract the `muapiapp` row from the Pricing & Value provider table. */
function findProviderPricing(lines) {
  for (let i = 0; i < lines.length; i += 1) {
    if (!isTabRow(lines[i])) continue;
    const c = cells(lines[i]);
    if (c[0].toLowerCase() !== "muapiapp") continue;
    const costText = c.slice(1).filter(Boolean).join(" ");
    // Notes are the following non-tab prose lines.
    const notes = [];
    let j = i + 1;
    while (j < lines.length && !isTabRow(lines[j]) && !SECTION_ICONS.includes(lines[j].trim())) {
      if (lines[j].trim()) notes.push(lines[j].trim());
      j += 1;
    }
    return { costText, notes: notes.join(" ") };
  }
  return { costText: "", notes: "" };
}

/** Extract the configuration schema parameter list. */
function findConfigSchema(lines) {
  const idx = lines.findIndex(
    (l) => isTabRow(l) && /^parameter$/i.test(cells(l)[0]) && /type/i.test(cells(l)[1] ?? ""),
  );
  if (idx === -1) return [];
  const params = [];
  let i = idx + 1;
  while (i < lines.length) {
    const line = lines[i];
    if (SECTION_ICONS.includes(line.trim())) break;
    if (/^(Implementation Guide|Common Questions|Developer documentation)$/i.test(line.trim()))
      break;
    if (isTabRow(line)) {
      const c = cells(line);
      const name = c[0];
      const type = c[1] ?? "";
      // Description and default follow as prose lines until the next tab row.
      const prose = [];
      let j = i + 1;
      while (j < lines.length && !isTabRow(lines[j]) && !SECTION_ICONS.includes(lines[j].trim())) {
        if (lines[j].trim()) prose.push(lines[j].trim());
        j += 1;
      }
      if (name) {
        params.push({
          label: name,
          type,
          description: prose.length > 1 ? prose.slice(0, -1).join(" ") : prose.join(" "),
          default: prose.length > 1 ? prose[prose.length - 1] : null,
        });
      }
      i = j;
      continue;
    }
    i += 1;
  }
  return params;
}

/** The pricing-variance sentence that follows `Result`. */
function findPricingDescriptor(lines) {
  const rIdx = lines.findIndex((l) => l.trim() === "Result");
  if (rIdx === -1) return "";
  // Playground chrome that appears between `Result` and the real pricing line.
  const NOISE = /^(Generated output|No result data found\.|Tutorial|Preview.?|Download)$/i;
  for (let i = rIdx + 1; i < Math.min(rIdx + 8, lines.length); i += 1) {
    const t = lines[i].trim();
    if (!t || NOISE.test(t)) continue;
    if (isTabRow(lines[i]) || SECTION_ICONS.includes(t)) break;
    return t;
  }
  return "";
}

/** True when the document explicitly declares the model a flat per-run price. */
function declaresFlatRate(lines) {
  return lines.some((l) => /^\s*Flat rate per run\s*$/i.test(l));
}

/**
 * A single-column `Cost` / `$X` table, used by flat-rate models.
 * findCostTables() requires >=2 columns, so these are read separately.
 */
function findFlatRateCost(lines) {
  for (let i = 0; i < lines.length; i += 1) {
    if (lines[i].trim().toLowerCase() !== "cost") continue;
    for (let j = i + 1; j < Math.min(i + 4, lines.length); j += 1) {
      const v = money(lines[j]);
      if (v !== null) return v;
    }
  }
  return null;
}

/**
 * Request parameters that can move the price, excluding those pinned to a
 * single enum value (`Enum (1 options)`), which cannot vary.
 */
function findVariablePriceParams(params) {
  return params
    .filter((p) => /duration|resolution|quality|extend/i.test(p.label))
    .filter((p) => !/^Enum \(1 options\)/i.test(p.type))
    .map((p) => p.label);
}

/** `Generate ($1.5)` -> 1.5 */
function findGenerateCost(lines) {
  for (const line of lines) {
    const m = /Generate\s*\(\s*\$\s*([0-9]+(?:\.[0-9]+)?)\s*\)/.exec(line);
    if (m) return Number(m[1]);
  }
  return null;
}

/**
 * Collect `$X/sec` (or `$X per second`) rates from a bounded piece of text.
 *
 * Scoping matters: the Pricing & Value section also lists Fal.ai and Replicate
 * rates. Mixing a competitor's rate into our ceiling produces a number that is
 * not MuAPI's price -- wrong in whichever direction the competitor differs, and
 * silently under-charging if they are cheaper. Callers therefore pass only
 * MuAPI-authored text (the pricing descriptor and the `muapiapp` row).
 */
function findPerSecondRates(text) {
  const out = [];
  // Accepts `$0.34/sec`, `$0.025/s`, `$0.25 per second`. The trailing \b stops
  // `/s` from matching the start of an unrelated word such as `/set`.
  const re = /\$\s*([0-9]+(?:\.[0-9]+)?)\s*(?:\/\s*s(?:ec(?:ond)?)?\b|\s+per\s+second\b)/gi;
  let m;
  while ((m = re.exec(text))) {
    const ctxStart = Math.max(0, m.index - 90);
    out.push({
      rateUsdPerSecond: Number(m[1]),
      context: (text.slice(ctxStart, m.index) + text.slice(m.index, m.index + 90))
        .replace(/\s+/g, " ")
        .trim(),
    });
  }
  return out;
}

/** Rates attributed to a named competitor, recorded for reference only. */
function findCompetitorRates(lines) {
  const out = [];
  for (let i = 0; i < lines.length; i += 1) {
    if (!isTabRow(lines[i])) continue;
    const c = cells(lines[i]);
    const who = c[0].toLowerCase();
    if (who !== "fal.ai" && who !== "replicate" && who !== "openai" && who !== "google") continue;
    for (const r of findPerSecondRates(c.slice(1).join(" "))) {
      out.push({ provider: c[0], ...r });
    }
  }
  return out;
}

/**
 * Duration bounds, read from the schema description (authoritative) with the
 * pricing table as a fallback. Handles en-dash and hyphen ranges.
 */
function findDurationBounds(params, priceTables, sectionText) {
  for (const p of params) {
    if (!/duration/i.test(p.label)) continue;
    const m = /\(?\s*([0-9]+)\s*[–\-—]\s*([0-9]+)\s*(?:seconds|secs?|s)?\s*\)?/.exec(
      p.description ?? "",
    );
    if (m) {
      return { minSeconds: Number(m[1]), maxSeconds: Number(m[2]), source: "schema" };
    }
  }
  const m2 = /(?:up to|clips up to)\s+([0-9]+)\s*[- ]?seconds?/i.exec(sectionText);
  if (m2) return { minSeconds: null, maxSeconds: Number(m2[1]), source: "prose" };

  // Fall back to the widest duration appearing in a cost table.
  let max = null;
  let min = null;
  for (const t of priceTables) {
    const di = t.header.findIndex((h) => /duration/i.test(h));
    if (di === -1) continue;
    for (const row of t.rows) {
      const d = /([0-9]+(?:\.[0-9]+)?)\s*s\b/.exec(row[di]);
      if (!d) continue;
      const v = Number(d[1]);
      max = max === null ? v : Math.max(max, v);
      min = min === null ? v : Math.min(min, v);
    }
  }
  return max === null
    ? { minSeconds: null, maxSeconds: null, source: "unknown" }
    : { minSeconds: min, maxSeconds: max, source: "price-table" };
}

/** Reference-list capacities, e.g. "Up to 10 clips" / "0/10 items". */
function findReferenceLimits(params, sectionText) {
  const limits = {};
  for (const p of params) {
    if (!/(image|video|audio)/i.test(p.label)) continue;
    if (!/array/i.test(p.type)) continue;
    const m = /up to\s+([0-9]+)/i.exec(p.description ?? "");
    const kind = /video/i.test(p.label) ? "videos" : /audio/i.test(p.label) ? "audios" : "images";
    if (m) limits[kind] = Math.max(limits[kind] ?? 0, Number(m[1]));
  }
  const vm = /Reference Videos\s*\n\s*0\/([0-9]+)\s*items/i.exec(sectionText);
  if (vm) limits.videos = Math.max(limits.videos ?? 0, Number(vm[1]));
  return limits;
}

/**
 * Derives the maximum a single call can cost.
 *
 * Precedence, strongest evidence first:
 *   1. An explicit cost table, extrapolated to max duration when the table
 *      stops short of the schema's duration ceiling and a per-second rate is
 *      stated.
 *   2. A per-second rate multiplied by the max duration.
 *   3. The default cost -- only when nothing varies.
 *
 * `unbounded` marks models whose price depends on the duration of a
 * user-supplied reference video, which is not knowable from the request
 * payload. Those must never be billed from a static number.
 */
function deriveCeiling({
  descriptor,
  sectionText,
  priceTables,
  perSecondRates,
  duration,
  defaultCost,
  limits,
  flatRateDeclared,
  flatRateCost,
  variablePriceParams,
}) {
  const notes = [];

  /*
   * Detect billing that scales with the duration of USER-SUPPLIED video.
   *
   * Two shapes appear in the document, and neither is confined to the pricing
   * table -- the evidence hides in schema descriptions and implementation
   * guides, so the whole section must be scanned:
   *
   *   a) combined-duration billing
   *      "billed on output duration plus every reference video's duration"
   *   b) input surcharge billing
   *      "Cost = (rate x output_duration) + (0.3 x rate x total_input_video_duration)"
   *
   * Both make cost a function of the length of a video behind a URL the user
   * chose, which is not present in the request payload. No static number can
   * bound them.
   *
   * Note: seedance-2-omni-reference asserts "Flat per-second billing with no
   * surcharges" in its provider notes while its own schema and implementation
   * guide give the surcharge formula with a worked example. The explicit
   * formula is treated as authoritative over the marketing sentence.
   */
  /*
   * Each entry names one documented billing shape whose cost is a function of
   * user-supplied media duration. Kept as a named list rather than one large
   * alternation so that a match is auditable: the emitted evidence says which
   * rule fired and quotes the sentence that triggered it.
   *
   * The patterns require an adjacent rate or explicit billing verb. A bare
   * mention such as "URL of the input video" in a schema description must not
   * classify a model as unbounded.
   */
  const UNBOUNDED_BILLING_RULES = [
    {
      id: "combined-duration",
      // "billed on output duration plus every reference video's duration"
      pattern: /reference video'?s? duration|plus every reference video|output \+ reference duration/i,
    },
    {
      id: "combined-duration",
      // "combined duration of the input video plus the generated output"
      pattern: /combined duration of the input video plus the generated output/i,
    },
    {
      id: "input-rate",
      // "Price is $0.145/sec of input video", "~$0.09/sec of input video"
      pattern: /\$\s*[0-9.]+\s*\/\s*sec(?:ond)?\s+of\s+(?:the\s+)?input/i,
    },
    {
      id: "input-surcharge",
      // "$0.09/sec per input video second"
      pattern: /per input video second/i,
    },
    {
      id: "input-surcharge",
      // "Cost = (rate x output_duration) + (0.3 x rate x total_input_video_duration)"
      pattern: /total_input_video_duration/i,
    },
    {
      id: "input-surcharge",
      // "an additional 30% surcharge applies per second of combined input video duration"
      pattern: /surcharge (?:applies )?per second of (?:combined )?input/i,
    },
    {
      id: "reference-surcharge",
      // "plus a small surcharge per reference video clip"
      pattern: /surcharge per reference video/i,
    },
  ];

  const searchable = `${descriptor}\n${sectionText}`;
  const unboundedEvidence = [];
  for (const rule of UNBOUNDED_BILLING_RULES) {
    const hit = rule.pattern.exec(searchable);
    if (!hit) continue;
    // Quote the whole sentence/line the match sits in, for the audit trail.
    const lineStart = searchable.lastIndexOf("\n", hit.index) + 1;
    const lineEnd = searchable.indexOf("\n", hit.index);
    unboundedEvidence.push({
      rule: rule.id,
      quote: searchable
        .slice(lineStart, lineEnd === -1 ? undefined : lineEnd)
        .trim()
        .slice(0, 220),
    });
  }
  if (
    priceTables.some((t) => t.rows.some((r) => r.some((c) => /output \+ reference duration/i.test(c))))
  ) {
    unboundedEvidence.push({ rule: "combined-duration", quote: "price table row: output + reference duration(s)" });
  }

  const referenceBilled = unboundedEvidence.length > 0;
  const combinedDurationBilled = unboundedEvidence.some((e) => e.rule === "combined-duration");

  // Capture the surcharge formula when the document states one.
  const surchargeFormula =
    /Cost\s*=\s*\(rate[^\n]*total_input_video_duration\)[^\n]*/i.exec(sectionText)?.[0] ??
    /\$[0-9.]+\/sec per input video second/i.exec(sectionText)?.[0] ??
    null;

  const tableCosts = [];
  for (const t of priceTables) {
    for (const row of t.rows) {
      const v = money(row[row.length - 1]);
      if (v !== null) tableCosts.push(v);
    }
  }
  const tableMax = tableCosts.length ? Math.max(...tableCosts) : null;

  // The discounted reference-video rate is excluded from the primary ceiling:
  // it applies to a different (unbounded) billing basis handled separately.
  const primaryRates = perSecondRates.filter(
    (r) => !/65%|reduced|discounted/i.test(r.context),
  );
  const rateMax = primaryRates.length
    ? Math.max(...primaryRates.map((r) => r.rateUsdPerSecond))
    : null;

  const candidates = [];

  // Candidate 1: the widest cost the explicit table states.
  if (tableMax !== null) {
    candidates.push({ usd: tableMax, basis: "cost-table-max", note: `table max $${tableMax}` });
  }

  // Candidate 2: MuAPI's per-second rate carried out to the maximum duration.
  // Required because tables routinely stop short of the schema's ceiling --
  // e.g. a 5s/8s/10s table on a model that accepts 15s.
  if (rateMax !== null && duration.maxSeconds) {
    candidates.push({
      usd: rateMax * duration.maxSeconds,
      basis: "per-second-rate x max-duration",
      note: `$${rateMax}/sec x ${duration.maxSeconds}s`,
    });
  }

  let ceiling = null;
  let basis = "unknown";
  if (candidates.length) {
    // Take the largest: under-estimating the ceiling is the direction that
    // loses money, so ties and ambiguity resolve upward.
    const best = candidates.reduce((a, b) => (b.usd > a.usd ? b : a));
    ceiling = best.usd;
    basis = candidates.length > 1 ? `max(${candidates.map((c) => c.basis).join(", ")})` : best.basis;
    for (const c of candidates) notes.push(c.note);
  }

  if (ceiling === null && defaultCost !== null) {
    ceiling = defaultCost;
    basis = "flat-default-cost";
  }

  // The default cost must never exceed the derived ceiling; if it does, the
  // price surface was read wrong and the ceiling would under-bill.
  if (ceiling !== null && defaultCost !== null && defaultCost > ceiling) {
    ceiling = defaultCost;
    basis = `${basis} (raised to default cost)`;
    notes.push(`default cost $${defaultCost} exceeded derived ceiling; using default`);
  }

  // A reference-video-billed model can always exceed any static ceiling.
  // The authoritative discounted rate is the one printed on the table row whose
  // duration cell reads "output + reference duration(s)" -- prose ordering is
  // not reliable enough to pick it out of the rate list.
  let refRate = null;
  for (const t of priceTables) {
    for (const row of t.rows) {
      if (!row.some((c) => /output \+ reference duration/i.test(c))) continue;
      const perSec = /\$\s*([0-9]+(?:\.[0-9]+)?)\s*\/\s*sec/i.exec(row[row.length - 1]);
      if (perSec) refRate = { rateUsdPerSecond: Number(perSec[1]) };
    }
  }
  if (!refRate) {
    refRate = perSecondRates.find((r) => /65%|reduced|discounted/i.test(r.context)) ?? null;
  }
  if (referenceBilled) {
    const kinds = [...new Set(unboundedEvidence.map((e) => e.rule))].join("+");
    notes.push(
      `UNBOUNDED (${kinds}): cost scales with the duration of user-supplied media` +
        (limits.videos ? ` across up to ${limits.videos} reference clips` : "") +
        (refRate ? ` at $${refRate.rateUsdPerSecond}/sec` : ""),
    );
    for (const e of unboundedEvidence) notes.push(`  evidence [${e.rule}]: "${e.quote}"`);
  }

  /*
   * Classify how trustworthy the ceiling is. This drives whether a model may be
   * billed from a static number at all.
   *
   *   flat          document explicitly says "Flat rate per run" -> one price
   *   bounded       the whole price surface is derivable from the document
   *   unbounded     price scales with user-supplied reference video durations
   *   indeterminate the model has price-varying parameters but the document
   *                 does not state the corresponding prices
   *
   * `indeterminate` is the important one: the alternative to admitting it is
   * assuming the default cost is the maximum, which is exactly the assumption
   * that loses money on every non-default request.
   */
  let pricingClass;
  if (referenceBilled) {
    pricingClass = "unbounded";
  } else if (flatRateDeclared) {
    pricingClass = "flat";
    const flatCandidates = [flatRateCost, defaultCost, ceiling].filter((v) => v !== null);
    if (flatCandidates.length) ceiling = Math.max(...flatCandidates);
    basis = "flat-rate-per-run";
  } else if (priceTables.length === 0 && perSecondRates.length === 0) {
    // No price surface at all in the document.
    pricingClass = variablePriceParams.length ? "indeterminate" : "flat";
    if (pricingClass === "flat") basis = "flat-no-variable-parameters";
  } else {
    // A duration-driven model whose table stops short of the schema maximum
    // needs a per-second rate to extrapolate; without one the top of the range
    // is unknown.
    const tableDurations = [];
    for (const t of priceTables) {
      const di = t.header.findIndex((h) => /duration/i.test(h));
      if (di === -1) continue;
      for (const row of t.rows) {
        const dm = /([0-9]+(?:\.[0-9]+)?)\s*s\b/.exec(row[di]);
        if (dm) tableDurations.push(Number(dm[1]));
      }
    }
    const tableMaxDuration = tableDurations.length ? Math.max(...tableDurations) : null;
    const durationIsDriver = /duration/i.test(descriptor) || tableMaxDuration !== null;
    const shortOfMax =
      durationIsDriver &&
      duration.maxSeconds !== null &&
      tableMaxDuration !== null &&
      tableMaxDuration < duration.maxSeconds;

    if (shortOfMax && rateMax === null) {
      pricingClass = "indeterminate";
      notes.push(
        `price table stops at ${tableMaxDuration}s but the model accepts up to ` +
          `${duration.maxSeconds}s and no per-second rate is stated`,
      );
    } else {
      pricingClass = "bounded";
    }
  }

  if (pricingClass === "indeterminate") {
    notes.push(
      "INDETERMINATE: document does not state prices for all settings this model accepts" +
        (variablePriceParams.length ? ` (varies by: ${variablePriceParams.join(", ")})` : ""),
    );
  }

  return {
    ceilingUsd: ceiling,
    ceilingBasis: basis,
    pricingClass,
    /** Safe to bill from a static number without a live estimate. */
    staticallyBillable: pricingClass === "flat" || pricingClass === "bounded",
    unbounded: referenceBilled,
    unboundedKind: referenceBilled
      ? [...new Set(unboundedEvidence.map((e) => e.rule))].join("+")
      : null,
    unboundedEvidence,
    unboundedReason: referenceBilled
      ? "cost depends on the duration of user-supplied video, which is not derivable from the request payload"
      : null,
    surchargeFormula,
    indeterminateReason:
      pricingClass === "indeterminate"
        ? "the document omits the price surface for parameters this model exposes"
        : null,
    referenceRateUsdPerSecond: referenceBilled && refRate ? refRate.rateUsdPerSecond : null,
    variablePriceParams,
    notes,
  };
}

/** Which request parameters move the price. */
function findCostDrivers(descriptor, priceTables) {
  const drivers = new Set();
  const d = descriptor.toLowerCase();
  if (d.includes("duration")) drivers.add("duration");
  if (d.includes("resolution")) drivers.add("resolution");
  if (d.includes("quality")) drivers.add("quality");
  if (d.includes("audio")) drivers.add("audio");
  if (d.includes("extend count")) drivers.add("extend_count");
  if (d.includes("reference")) drivers.add("reference_videos");
  for (const t of priceTables) {
    for (const h of t.header.slice(0, -1)) {
      const hl = h.toLowerCase();
      if (hl.includes("duration")) drivers.add("duration");
      else if (hl.includes("resolution")) drivers.add("resolution");
      else if (hl.includes("quality")) drivers.add("quality");
      else if (hl.includes("video reference")) drivers.add("reference_videos");
      else if (hl.includes("audio")) drivers.add("audio");
      else if (hl.includes("extend")) drivers.add("extend_count");
      else if (h) drivers.add(hl.replace(/\s+/g, "_"));
    }
  }
  return [...drivers];
}

const sections = splitSections(allLines);
const models = [];
const parseWarnings = [];

for (const section of sections) {
  const lines = allLines.slice(section.start, section.end);
  const sectionText = lines.join("\n");

  const defaultCost = findGenerateCost(lines);
  const descriptor = findPricingDescriptor(lines);
  const priceTables = findCostTables(lines);
  const provider = findProviderPricing(lines);
  const params = findConfigSchema(lines);
  // Rates are read ONLY from MuAPI-authored text: the pricing descriptor and
  // the muapiapp provider row (plus its notes). Competitor rows are captured
  // separately and never influence pricing.
  // Schema descriptions are included because several models state their
  // per-second rate only there, e.g. grok-imagine-image-to-video documents
  // "Cost: $0.025/s at 480p, $0.05/s at 720p" on its Duration parameter.
  const muapiRateText = [
    descriptor,
    provider.costText,
    provider.notes,
    ...params.map((p) => `${p.label} ${p.description ?? ""}`),
  ].join(" \n ");
  const perSecondRates = findPerSecondRates(muapiRateText);
  const competitorRates = findCompetitorRates(lines);
  const duration = findDurationBounds(params, priceTables, sectionText);
  const limits = findReferenceLimits(params, sectionText);

  const categoryIdx = lines.findIndex((l) => new RegExp(`^muapi/${escapeRe(section.slug)}$`).test(l.trim()));
  const category = categoryIdx !== -1 ? (lines[categoryIdx + 1] ?? "").trim() : "";

  const flatRateDeclared = declaresFlatRate(lines);
  const flatRateCost = flatRateDeclared ? findFlatRateCost(lines) : null;
  const variablePriceParams = findVariablePriceParams(params);

  const ceiling = deriveCeiling({
    descriptor,
    sectionText,
    priceTables,
    perSecondRates,
    duration,
    defaultCost,
    limits,
    flatRateDeclared,
    flatRateCost,
    variablePriceParams,
  });

  if (defaultCost === null)
    parseWarnings.push(`${section.slug}: no "Generate ($X)" default cost found`);
  if (ceiling.ceilingUsd === null)
    parseWarnings.push(`${section.slug}: could not derive a cost ceiling`);
  if (ceiling.pricingClass === "indeterminate")
    parseWarnings.push(
      `${section.slug}: INDETERMINATE ceiling (varies by ${ceiling.variablePriceParams.join(", ") || "unknown"}) -- must not be billed statically`,
    );
  if (ceiling.unbounded)
    parseWarnings.push(
      `${section.slug}: UNBOUNDED (${ceiling.unboundedKind} billing on user-supplied video duration)`,
    );

  models.push({
    name: section.slug,
    headingRaw: section.headingRaw,
    category,
    title: (lines[1] ?? "").trim(),
    defaultCostUsd: defaultCost,
    pricingDescriptor: descriptor,
    costDrivers: findCostDrivers(descriptor, priceTables),
    priceTables: priceTables.map((t) => ({
      dimensions: t.header.slice(0, -1),
      rows: t.rows.map((r) => ({
        combination: r.slice(0, -1),
        costUsd: money(r[r.length - 1]),
        costRaw: r[r.length - 1],
      })),
    })),
    perSecondRates,
    competitorRates,
    duration,
    referenceLimits: limits,
    ceiling,
    providerPricing: provider,
    configSchema: params,
    docLineRange: [section.start + 1, section.end],
  });
}

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const payload = {
  $schema: "doolphin/muapi-model-docs@1",
  source: "Models and their Pricing.docx (founder-supplied, authoritative)",
  extractedFrom: SRC,
  note:
    "defaultCostUsd is the price at the model's DEFAULT parameters. ceiling.ceilingUsd is the " +
    "maximum a single call can cost. Bill against the ceiling, never the default. Models with " +
    "ceiling.unbounded === true have no derivable static maximum and must be gated.",
  totalModels: models.length,
  parseWarnings,
  models,
};

writeFileSync(OUT, JSON.stringify(payload, null, 2) + "\n", "utf8");

console.log(`parsed ${models.length} models -> ${OUT}`);
if (parseWarnings.length) {
  console.log(`\n${parseWarnings.length} parse warning(s):`);
  for (const w of parseWarnings) console.log(`  ! ${w}`);
}
