// Serializable client-safe catalog. Server pricing derives its values from
// this same source; UI must not maintain a competing plan table.
//
// ============================ DESIGN RULE ============================
// EVERY field in this file must be either (a) enforced by code, or (b) a
// factually true statement about the shipped product. A plan field that is
// merely advertised is a promise we break silently, so it does not belong here.
//
// Deliberately REMOVED (2026-08): `seats`, `workspaces`, `maxResolution`,
// `maxDurationSeconds`. All four were advertised on the pricing page and read by
// nothing. There is no invite flow, no member management and no multi-workspace
// UI, so "3 seats, 3 workspaces" was unsellable. Resolution and duration are
// limited by the MODEL a user picks (src/lib/generation/contract.js validates
// against model.resolutions and model.maxDuration), never by their plan — so
// advertising "up to 1080p / 15s" on Starter understated what Starter can
// actually do while pretending to be a restriction. Both are gone rather than
// implemented: the product is stronger if every paying plan can use everything.
//
// CREDIT VALUES: revision 2026-08-credit-rescale-v2. 1 credit represents
// $0.005 of fully-loaded (provider + variable infra) cost allowance. See
// src/lib/entitlements/pricing.js for the profit invariant these must satisfy,
// tests/pricing-profit-invariant.test.js for the executable proof, and
// scripts/analyze-plan-economics.mjs to print margins and videos-per-plan.
//
// `termMonths` × `credits` = the total credits a purchase actually grants, and
// it is the ONLY correct denominator for revenue-per-credit. An annual plan
// charges once but grants `credits` EVERY month for 12 months (see
// materializeAnnualGrantSchedule in src/lib/entitlements/grants.js).
//
// Worst-case margin (customer burns 100% of credits on the most expensive
// generation the cost ceiling permits), after Polar's 5% + $0.50 fee, over the
// FULL billing term. Printed by scripts/analyze-plan-economics.mjs:
//   Explorer 53.0% | Starter 53.8% | Growth 53.1% | Agency 52.8%
//   Starter annual 43.2% | Growth annual 41.7% | Agency annual 41.2%
//
// `videoSlots` is the number of video generations a workspace may have IN FLIGHT
// at once. It is an ENFORCED runtime limit: assertVideoSlotAvailable in
// src/lib/generation/concurrencyLimit.js is called inside the Serializable
// submission transaction in src/app/api/generations/route.js. A slot is occupied
// while a CreationVariant is QUEUED or PROCESSING and is released the moment it
// reaches a terminal status — exactly when the video appears in the library.

/**
 * Credits consumed by one standard video: the flagship registered model
 * (muapi.seedance2.omni-reference-fast) at a 5-second 720p generation.
 *
 * Derivation, all of it verifiable: MuAPI's catalog base for that model is
 * $0.75, the model definition reserves $0.020 of variable infra, and
 * calculateRequiredCredits converts $0.770 at $0.005/credit to 154 credits,
 * rounded up to the nearest 5 = 155.
 *
 * This exists as ONE exported constant because the pricing page previously
 * hardcoded 30 credits per video and the feature bullets independently claimed
 * ~33, so the public "videos per month" figure was over five times too
 * optimistic. Any figure shown to a customer must divide by this constant, and
 * scripts/analyze-plan-economics.mjs fails loudly if it stops matching real cost.
 *
 * It is an ESTIMATE for planning only — longer clips, higher resolutions and
 * multiple outputs cost more. The authoritative number is always the live quote
 * shown on the generate button before anything is charged.
 */
export const STANDARD_VIDEO_CREDITS = 155;

/** How many standard videos a credit allowance buys, floored — never rounded up. */
export function standardVideosFor(credits) {
  return Math.floor(credits / STANDARD_VIDEO_CREDITS);
}

/**
 * Model families a plan may NOT use.
 *
 * Every paid plan gets every model. The one exception is the $2.99 Explorer
 * trial, which is excluded from the Seedance 2.5 family: its cheapest tier costs
 * more than half the trial's entire credit allowance, so offering it would let a
 * trial burn out in a single click and produce a worse first experience than the
 * model it replaces. Enforced server-side in src/lib/entitlements/modelAccess.js.
 */
export const RESTRICTED_MODEL_FAMILIES = Object.freeze({
  EXPLORER: Object.freeze(["seedance-2.5"]),
  STARTER_MONTHLY: Object.freeze([]),
  STARTER_ANNUAL: Object.freeze([]),
  GROWTH_MONTHLY: Object.freeze([]),
  GROWTH_ANNUAL: Object.freeze([]),
  AGENCY_MONTHLY: Object.freeze([]),
  AGENCY_ANNUAL: Object.freeze([]),
});

export const APPROVED_PLANS = Object.freeze([
  // Explorer's allowance is capped by Polar's FIXED $0.50 fee, not by generosity.
  // On a $2.99 charge the 5% + $0.50 fee takes ~22%, leaving $2.34 net, so the
  // most credits that still clear the $0.0105 revenue floor is 222. 220 is the
  // round number under that. Raising it to 320 (a nicer "2 videos" story) was
  // tried and rejected: it netted $0.0073/credit, breaching the floor and cutting
  // worst-case margin to 31%. The floor is not negotiable for a nicer headline.
  { code: "EXPLORER", name: "Explorer", price: "$2.99", priceMicroUsd: 2_990_000, credits: 220, interval: "ONE_TIME", cadence: "One-time", termMonths: 1, videoSlots: 1 },
  { code: "STARTER_MONTHLY", name: "Starter", price: "$29/month", priceMicroUsd: 29_000_000, credits: 2500, interval: "MONTHLY", cadence: "Monthly", termMonths: 1, videoSlots: 1 },
  { code: "STARTER_ANNUAL", name: "Starter", price: "$278.40/year", priceMicroUsd: 278_400_000, credits: 2500, interval: "ANNUAL", cadence: "2,500 credits granted monthly", termMonths: 12, videoSlots: 1 },
  { code: "GROWTH_MONTHLY", name: "Growth", price: "$79/month", priceMicroUsd: 79_000_000, credits: 7000, interval: "MONTHLY", cadence: "Monthly", termMonths: 1, videoSlots: 4 },
  { code: "GROWTH_ANNUAL", name: "Growth", price: "$758.40/year", priceMicroUsd: 758_400_000, credits: 7000, interval: "ANNUAL", cadence: "7,000 credits granted monthly", termMonths: 12, videoSlots: 4 },
  { code: "AGENCY_MONTHLY", name: "Agency", price: "$179/month", priceMicroUsd: 179_000_000, credits: 16000, interval: "MONTHLY", cadence: "Monthly", termMonths: 1, videoSlots: 4 },
  { code: "AGENCY_ANNUAL", name: "Agency", price: "$1,718.40/year", priceMicroUsd: 1_718_400_000, credits: 16000, interval: "ANNUAL", cadence: "16,000 credits granted monthly", termMonths: 12, videoSlots: 4 },
]);

export const PLAN_BY_CODE = Object.freeze(Object.fromEntries(APPROVED_PLANS.map((plan) => [plan.code, plan])));

/**
 * The annual discount, stated once. Annual prices above are monthly × 12 × 0.8.
 *
 * 20% was chosen over 10% and 30% after running all three through
 * scripts/analyze-plan-economics.mjs: 10% is too weak to change behaviour, 30%
 * drops worst-case annual margin to ~33% while only saving the customer a
 * further $2.90/month on Starter, and 20% is what the category (Kling, Speel,
 * Higgsfield) has trained buyers to expect. Annual worst-case margin stays above
 * 41% on every tier.
 */
export const ANNUAL_DISCOUNT_PERCENT = 20;

/**
 * Every code a checkout session may be opened for. EXPLORER is included because
 * it is genuinely purchasable — it is simply not advertised publicly (see
 * PUBLIC_PLAN_CODES) and carries its own once-per-identity eligibility rule.
 */
export const PURCHASE_PLAN_CODES = Object.freeze(["EXPLORER", "STARTER_MONTHLY", "GROWTH_MONTHLY", "AGENCY_MONTHLY"]);

/**
 * The plans shown on the public pricing grid.
 *
 * EXPLORER is deliberately absent. It is a $2.99 one-time trial offered only to
 * a signed-in, email-verified account that has never activated before, surfaced
 * as a quiet "not ready to commit?" link rather than a headline SKU. Putting it
 * in the grid next to $29/month anchors the whole page against itself, and it
 * cannot be honoured for an anonymous visitor anyway (the entitlement is bound
 * to a user identity). Explorer eligibility is authoritative server-side in
 * src/app/api/checkout/polar/route.js — this constant only controls display.
 */
export const PUBLIC_PLAN_CODES = Object.freeze(["STARTER_MONTHLY", "GROWTH_MONTHLY", "AGENCY_MONTHLY"]);

/** The one-time trial SKU. Not a subscription; grants credits exactly once. */
export const TRIAL_PLAN_CODE = "EXPLORER";

/** Tier name highlighted as the default recommendation on the pricing grid. */
export const RECOMMENDED_PLAN_CODE = "GROWTH_MONTHLY";

/**
 * Marketing feature bullets, keyed by tier name.
 *
 * Every claim here must be true of the shipped product AND enforced or
 * unconditional. Since seats, workspaces and per-plan quality caps were removed,
 * the honest differentiators are exactly three: how many credits you get, how
 * many videos generate at once, and (for the trial only) the Seedance 2.5
 * exclusion. Everything else is deliberately identical across plans, and saying
 * so plainly is a stronger offer than inventing a ladder.
 *
 * `inherits` renders as "Everything in <tier>, plus:" so each column stays short
 * and the upgrade delta is legible at a glance.
 */
export const PLAN_FEATURES = Object.freeze({
  Explorer: Object.freeze({
    inherits: null,
    items: Object.freeze([
      { label: "220 credits", detail: "one standard video plus a few images" },
      { label: "1 video generating at a time" },
      { label: "Every studio", detail: "Video, Product, App and Image" },
      { label: "Full commercial rights to everything you make" },
      { label: "One-time payment", detail: "no subscription, no auto-renew" },
      { label: "Seedance 2.5 not included", detail: "available on every paid plan" },
    ]),
  }),
  Starter: Object.freeze({
    inherits: null,
    items: Object.freeze([
      { label: "2,500 credits a month", detail: "about 16 standard videos" },
      { label: "Every AI model", detail: "including Seedance 2.5 — nothing held back" },
      { label: "Any resolution and clip length the model supports", detail: "no plan-level cap" },
      { label: "All four studios", detail: "Video, Product, App and Image" },
      { label: "1 video generating at a time" },
      { label: "Presets library and reusable asset library" },
      { label: "Rollover credits", detail: "unused credits never expire while active" },
      { label: "Full commercial rights to everything you make" },
    ]),
  }),
  Growth: Object.freeze({
    inherits: "Starter",
    items: Object.freeze([
      { label: "7,000 credits a month", detail: "about 45 standard videos" },
      { label: "4 videos generating at once", detail: "4x the throughput" },
    ]),
  }),
  Agency: Object.freeze({
    inherits: "Growth",
    items: Object.freeze([
      { label: "16,000 credits a month", detail: "about 103 standard videos" },
      { label: "Priority support" },
    ]),
  }),
});

/** Short positioning line under each tier's name on the pricing grid. */
export const PLAN_TAGLINES = Object.freeze({
  Explorer: "See what Doolphin makes before committing to anything.",
  Starter: "For solo founders and creators shipping their first ad creative.",
  Growth: "For brands and small teams producing creative at real volume.",
  Agency: "For agencies and content teams shipping ads every single day.",
});
