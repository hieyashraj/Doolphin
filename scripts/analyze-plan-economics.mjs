#!/usr/bin/env node

/**
 * PLAN ECONOMICS ANALYSIS
 *
 * Answers, from code rather than from a spreadsheet:
 *   - how many videos each plan actually buys,
 *   - what the worst-case margin is per plan,
 *   - whether a 10% / 20% / 30% annual discount is still profitable.
 *
 * It imports the PRODUCTION pricing functions so this analysis can never
 * disagree with what the application actually charges. If someone changes the
 * credit conversion, this output changes with it.
 *
 * Run: node scripts/analyze-plan-economics.mjs
 */

import {
  PRICING_REVISION,
  netRevenuePerCreditMicroUsd,
  worstCaseContributionMarginBps,
  calculateRequiredCredits,
} from "../src/lib/entitlements/pricing.js";
import { APPROVED_PLANS, STANDARD_VIDEO_CREDITS } from "../src/lib/entitlements/plan-catalog.js";

const CEILING = PRICING_REVISION.maxFullyLoadedCostPerCreditMicroUsd;
const usd = (micro) => `$${(Number(micro) / 1e6).toFixed(2)}`;

/**
 * The models that are genuinely registered and sellable today, with their
 * provider base cost from muapi-live-catalog.json plus the variable infra
 * reserve declared in each model definition's businessPolicy.
 */
const SELLABLE = [
  { label: "Seedance 2 Omni Fast — 5s 720p video", provider: 750_000n, infra: 20_000n },
  { label: "Seedance 2.5 Spicy Extend — 480p video", provider: 935_000n, infra: 10_000n },
  { label: "Grok Imagine 2 Edit — single image", provider: 50_000n, infra: 5_000n },
];

console.log("=== 1. REAL CREDIT COST PER GENERATION (production conversion) ===");
let standardVideoCredits = null;
for (const model of SELLABLE) {
  const quote = calculateRequiredCredits({ provider: model.provider, infra: model.infra });
  const loaded = usd(model.provider + model.infra);
  console.log(`${model.label.padEnd(42)} ${loaded.padEnd(8)} loaded -> ${quote.quotedCredits} credits`);
  if (standardVideoCredits === null) standardVideoCredits = Number(quote.quotedCredits);
}
console.log(`\nStandard video costs ${standardVideoCredits} credits.`);
console.log(`plan-catalog STANDARD_VIDEO_CREDITS = ${STANDARD_VIDEO_CREDITS}`);
if (Number(STANDARD_VIDEO_CREDITS) !== standardVideoCredits) {
  console.log("!! MISMATCH: the published videos-per-plan figure would be dishonest.");
} else {
  console.log("OK: the published videos-per-plan figure matches real cost.");
}

console.log("\n=== 2. PLANS AS CONFIGURED ===");
console.log("plan             price          credits  videos  $/video  net-per-credit  worst-margin");
for (const plan of APPROVED_PLANS) {
  const net = netRevenuePerCreditMicroUsd(plan);
  const margin = worstCaseContributionMarginBps(plan) / 100;
  const termCredits = plan.credits * plan.termMonths;
  const videos = Math.floor(termCredits / standardVideoCredits);
  const priceUsd = Number(plan.priceMicroUsd) / 1e6;
  const perVideo = videos > 0 ? `$${(priceUsd / videos).toFixed(2)}` : "n/a";
  console.log(
    `${plan.code.padEnd(16)} ${plan.price.padEnd(14)} ${String(termCredits).padEnd(8)} ${String(videos).padEnd(7)} ${perVideo.padEnd(8)} ${String(Number(net)).padEnd(15)} ${margin.toFixed(1)}%`
  );
}

console.log("\n=== 3. ANNUAL DISCOUNT SCENARIOS ===");
console.log("Worst case = the customer burns 100% of their credits every month for");
console.log("twelve months on the most expensive generation the ceiling permits.\n");

const MONTHLY = APPROVED_PLANS.filter((plan) => plan.interval === "MONTHLY");
for (const discount of [10, 20, 30]) {
  console.log(`--- ${discount}% off annual ---`);
  console.log("plan     annual price  eff. $/mo  credits/term  net-per-credit  worst-margin  net revenue  worst cost  worst profit");
  for (const monthly of MONTHLY) {
    const monthlyUsd = Number(monthly.priceMicroUsd) / 1e6;
    const annualUsd = monthlyUsd * 12 * (1 - discount / 100);
    const priceMicroUsd = BigInt(Math.round(annualUsd * 1e6));
    const candidate = { code: `${monthly.name.toUpperCase()}_ANNUAL`, priceMicroUsd, credits: monthly.credits, termMonths: 12 };

    const net = netRevenuePerCreditMicroUsd(candidate);
    const margin = worstCaseContributionMarginBps(candidate) / 100;
    const termCredits = monthly.credits * 12;
    const fee = (priceMicroUsd * BigInt(PRICING_REVISION.polarTransactionFeeBps)) / 10_000n + PRICING_REVISION.polarFixedFeeMicroUsd;
    const netRevenue = priceMicroUsd - fee;
    const worstCost = BigInt(termCredits) * CEILING;

    console.log(
      `${monthly.name.padEnd(8)} $${annualUsd.toFixed(2).padEnd(12)} $${(annualUsd / 12).toFixed(2).padEnd(9)} ${String(termCredits).padEnd(13)} ${String(Number(net)).padEnd(15)} ${(margin.toFixed(1) + "%").padEnd(13)} ${usd(netRevenue).padEnd(12)} ${usd(worstCost).padEnd(11)} ${usd(netRevenue - worstCost)}`
    );
  }
  console.log("");
}

console.log("=== 4. INVARIANT ===");
console.log(`cost ceiling      = ${CEILING} microUSD per credit`);
console.log(`revenue floor     = ${PRICING_REVISION.netRevenuePerCreditFloorMicroUsd} microUSD per credit`);
console.log("Every plan above must show a positive worst-case margin, or it is not sellable.");
