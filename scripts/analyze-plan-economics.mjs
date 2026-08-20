#!/usr/bin/env node
/**
 * Plan economics against the DOCUMENTED cost ceilings.
 *
 * Two separate questions, deliberately not conflated:
 *
 *   1. MARGIN — is every plan profitable in the worst case? This is structural:
 *      credits are derived by ceiling-dividing cost by a fixed per-credit cost
 *      ceiling, so margin cannot depend on which model is used.
 *
 *   2. AFFORDABILITY — can a plan actually buy what it advertises? This is NOT
 *      structural and does not follow from (1). A plan can be perfectly
 *      profitable while granting too few credits to complete a single render at
 *      the resolution its own marketing promises.
 *
 * Every credit figure is produced by calling the real pricing function rather
 * than reimplementing the arithmetic, so this report cannot drift from what the
 * application actually charges.
 */
import { APPROVED_PLANS } from "../src/lib/entitlements/plan-catalog.js";
import {
  PRICING_REVISION,
  calculateRequiredCredits,
  creditsGrantedOverTerm,
  netRevenuePerCreditMicroUsd,
  worstCaseContributionMarginBps,
} from "../src/lib/entitlements/pricing.js";
import {
  getDocumentedCeilingUsd,
  getDocumentedEntry,
  listDocumentedModelIds,
  resolveDocumentedCostUsd,
} from "../src/lib/models/documentedCostSurface.js";

/** Credits the app would charge for a given provider cost, via the real path. */
function creditsFor(providerCostUsd, variableInfraCostMicroUsd = 20_000n) {
  const providerMicro = BigInt(Math.ceil(providerCostUsd * 1_000_000));
  return Number(
    calculateRequiredCredits({ provider: providerMicro, infra: variableInfraCostMicroUsd })
      .quotedCredits,
  );
}

const pct = (bps) => `${(bps / 100).toFixed(1)}%`;
const pad = (s, n) => String(s).padEnd(n);
const lpad = (s, n) => String(s).padStart(n);

console.log("=".repeat(96));
console.log("PART 1 — MARGIN INVARIANT (must be >= 30% for every purchasable plan)");
console.log("=".repeat(96));
console.log(
  `cost ceiling: ${PRICING_REVISION.maxFullyLoadedCostPerCreditMicroUsd} microUSD/credit  |  ` +
    `net revenue floor: ${PRICING_REVISION.netRevenuePerCreditFloorMicroUsd} microUSD/credit`,
);
console.log();
console.log(
  `${pad("plan", 18)}${lpad("price", 12)}${lpad("credits", 9)}${lpad("term", 6)}${lpad("cr/term", 9)}${lpad("net/cr", 9)}${lpad("margin", 9)}  verdict`,
);

let marginFailures = 0;
for (const plan of APPROVED_PLANS) {
  const overTerm = creditsGrantedOverTerm(plan);
  const net = netRevenuePerCreditMicroUsd(plan);
  const bps = worstCaseContributionMarginBps(plan);
  const ok = bps >= 3000;
  if (!ok) marginFailures += 1;
  console.log(
    `${pad(plan.code, 18)}${lpad(plan.price, 12)}${lpad(plan.credits, 9)}${lpad(plan.termMonths + "mo", 6)}` +
      `${lpad(String(overTerm), 9)}${lpad(String(net), 9)}${lpad(pct(bps), 9)}  ${ok ? "PASS" : "*** FAIL ***"}`,
  );
}
console.log();
console.log(
  marginFailures === 0
    ? "All plans clear the 30% worst-case margin floor."
    : `${marginFailures} plan(s) BREACH the 30% floor.`,
);

console.log();
console.log("=".repeat(96));
console.log("PART 2 — WHAT A SINGLE RENDER COSTS IN CREDITS (documented ceilings)");
console.log("=".repeat(96));

// Representative ladder across the documented catalog, cheapest to dearest.
const LADDER = [
  ["gpt-image-2-text-to-image", { quality: "Low", resolution: "1K" }, "image, low/1K"],
  ["gpt-image-2-text-to-image", { quality: "High", resolution: "4K" }, "image, high/4K"],
  ["grok-imagine-image-to-video", { durationSeconds: 6 }, "video 6s 480p"],
  ["veo3.1-lite-image-to-video", { resolution: "720p" }, "video 8s 720p"],
  ["veo3.1-lite-image-to-video", { resolution: "1080p" }, "video 8s 1080p"],
  ["veo3.1-lite-image-to-video", { resolution: "4k" }, "video 8s 4k"],
  ["seedance-2.5-image-to-video", { durationSeconds: 5 }, "video 5s 720p"],
  ["seedance-2.5-image-to-video-1080p", { durationSeconds: 5 }, "video 5s 1080p"],
  ["seedance-2.5-image-to-video-4k", { durationSeconds: 5 }, "video 5s 4k"],
];

console.log(`${pad("model", 40)}${pad("settings", 18)}${lpad("cost", 9)}${lpad("credits", 9)}`);
for (const [id, params, label] of LADDER) {
  const usd = resolveDocumentedCostUsd({ providerModelId: id, ...params });
  if (usd === null) {
    console.log(`${pad(id, 40)}${pad(label, 18)}${lpad("n/d", 9)}${lpad("-", 9)}`);
    continue;
  }
  console.log(
    `${pad(id, 40)}${pad(label, 18)}${lpad("$" + usd.toFixed(3), 9)}${lpad(creditsFor(usd), 9)}`,
  );
}

console.log();
console.log("worst documented single call, per model ceiling:");
const worst = listDocumentedModelIds()
  .map((id) => ({ id, usd: getDocumentedCeilingUsd(id), cls: getDocumentedEntry(id).pricingClass }))
  .filter((m) => m.usd !== null && (m.cls === "flat" || m.cls === "bounded"))
  .sort((a, b) => b.usd - a.usd)
  .slice(0, 5);
for (const m of worst) {
  console.log(`  ${pad(m.id, 40)}${lpad("$" + m.usd.toFixed(2), 9)}${lpad(creditsFor(m.usd) + " cr", 12)}`);
}

console.log();
console.log("=".repeat(96));
console.log("PART 3 — AFFORDABILITY: does each plan's allowance buy what it advertises?");
console.log("=".repeat(96));

/*
 * The advertised capability is the plan's own maxResolution / maxDurationSeconds.
 * We price the cheapest documented model that actually delivers that capability,
 * because a plan claiming 4k must be able to afford SOME 4k render to make the
 * claim true.
 */
const CAPABILITY_REPRESENTATIVE = {
  "720p": ["veo3.1-lite-image-to-video", { resolution: "720p" }],
  "1080p": ["veo3.1-lite-image-to-video", { resolution: "1080p" }],
  "4k": ["veo3.1-lite-image-to-video", { resolution: "4k" }],
};

console.log(
  `${pad("plan", 18)}${lpad("credits/mo", 11)}${pad("  advertises", 14)}${lpad("cheapest such render", 21)}${lpad("affordable?", 13)}`,
);

const affordabilityProblems = [];
for (const plan of APPROVED_PLANS) {
  const rep = CAPABILITY_REPRESENTATIVE[plan.maxResolution];
  if (!rep) continue;
  const usd = resolveDocumentedCostUsd({ providerModelId: rep[0], ...rep[1] });
  const credits = creditsFor(usd);
  const monthly = plan.credits;
  const count = Math.floor(monthly / credits);
  const affordable = count >= 1;
  if (!affordable) {
    affordabilityProblems.push({ plan: plan.code, need: credits, have: monthly, res: plan.maxResolution });
  }
  console.log(
    `${pad(plan.code, 18)}${lpad(monthly, 11)}${pad("  " + plan.maxResolution + "/" + plan.maxDurationSeconds + "s", 14)}` +
      `${lpad(credits + " cr ($" + usd.toFixed(2) + ")", 21)}${lpad(affordable ? count + "x" : "ZERO", 13)}`,
  );
}

console.log();
console.log("how many renders each plan's monthly allowance buys:");
const GRID = [
  ["gpt-image-2-text-to-image", { quality: "High", resolution: "2K" }, "image high/2K"],
  ["veo3.1-lite-image-to-video", { resolution: "720p" }, "8s 720p video"],
  ["veo3.1-lite-image-to-video", { resolution: "4k" }, "8s 4k video"],
  ["seedance-2.5-image-to-video-1080p", { durationSeconds: 5 }, "5s 1080p premium"],
];
process.stdout.write(pad("plan", 18));
for (const [, , label] of GRID) process.stdout.write(lpad(label, 19));
process.stdout.write("\n");
for (const plan of APPROVED_PLANS) {
  process.stdout.write(pad(plan.code, 18));
  for (const [id, params] of GRID) {
    const usd = resolveDocumentedCostUsd({ providerModelId: id, ...params });
    const c = creditsFor(usd);
    process.stdout.write(lpad(Math.floor(plan.credits / c) + "x", 19));
  }
  process.stdout.write("\n");
}

console.log();
if (affordabilityProblems.length) {
  console.log("AFFORDABILITY PROBLEMS (plan advertises a capability it cannot afford once):");
  for (const p of affordabilityProblems) {
    console.log(
      `  ${p.plan}: advertises ${p.res} but one such render needs ${p.need} credits and the plan grants ${p.have}`,
    );
  }
} else {
  console.log("Every plan can afford at least one render at its advertised maximum resolution.");
}

console.log();
console.log("=".repeat(96));
console.log("PART 4 — CAPABILITY CAPS ARE NOT ENFORCED");
console.log("=".repeat(96));
console.log(
  "plan.maxResolution and plan.maxDurationSeconds appear only in plan-catalog.js. No code path\n" +
    "reads them, so they are marketing copy rather than limits. This is not a margin leak — the\n" +
    "credit balance is the real backstop and a request the buyer cannot afford is refused at\n" +
    "reservation — but it does mean the advertised tiering is not real in either direction:\n" +
    "  * a cheaper plan is not prevented from requesting a higher resolution it can afford\n" +
    "  * a dearer plan advertises resolutions it may not be able to afford even once",
);

process.exitCode = marginFailures > 0 ? 1 : 0;
