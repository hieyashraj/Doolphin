// Serializable client-safe catalog. Server pricing derives its values from
// this same source; UI must not maintain a competing plan table.
//
// CREDIT VALUES: revision 2026-08-credit-rescale-v2. 1 credit represents
// $0.005 of fully-loaded (provider + variable infra) cost allowance. Credit
// counts were rescaled 4.2x from the prior $0.021/credit revision — identical
// economics, materially better perceived value. See src/lib/entitlements/pricing.js
// for the profit invariant these numbers must satisfy, and
// tests/pricing-profit-invariant.test.js for the executable proof.
//
// Worst-case margin (user burns 100% of credits on the most expensive model
// available to them), after Polar's 5% + $0.50 merchant-of-record fee, computed
// over the FULL BILLING TERM:
//   Explorer 57.3% | Starter 53.8% | Growth 53.1% | Agency 52.8%
//   Starter annual 43.2% | Growth annual 41.7% | Agency annual 41.2%
//
// `termMonths` × `credits` = the total credits a purchase actually grants, and
// it is the ONLY correct denominator for revenue-per-credit.
//
// This field exists because its absence produced a silently wrong proof. An
// annual plan charges once (e.g. $278.40) but grants `credits` EVERY month for
// 12 months (see materializeAnnualGrantSchedule in src/lib/entitlements/grants.js,
// which creates 12 periods of `credits` each). Dividing the annual price by a
// single month's allowance overstated annual revenue per credit by 12x, so the
// margin tests were passing on a number that did not exist. Annual plans are
// genuinely thinner than monthly — that is the 20% prepayment discount working
// as intended — and they must be measured, not flattered.
//
// `maxResolution` / `maxDurationSeconds` are capability ceilings, not just
// marketing tiers. A single 30s 4K generation can cost ~$15 of provider spend
// (~3,000 credits), which exceeds an entire Starter allowance — gating the
// expensive capabilities by tier prevents users hitting an impossible wall and
// creates a coherent upgrade path.
//
// `videoSlots` is the number of video generations a workspace may have IN FLIGHT
// at once. It is an ENFORCED runtime limit, not marketing copy: see
// assertVideoSlotAvailable in src/lib/generation/concurrencyLimit.js, which is
// called inside the Serializable submission transaction in
// src/app/api/generations/route.js. Entry tiers get a single slot so a queue of
// cheap parallel jobs cannot monopolise provider throughput; paid team tiers get
// 4 so a small team can actually work in parallel.
//
// A slot is occupied while a CreationVariant is QUEUED or PROCESSING and is
// released the moment it reaches a terminal status — which is exactly when the
// video becomes playable in the library.
export const APPROVED_PLANS = Object.freeze([
  { code: "EXPLORER", name: "Explorer", price: "$2.99", priceMicroUsd: 2_990_000, credits: 200, interval: "ONE_TIME", cadence: "One-time", termMonths: 1, seats: 1, workspaces: 1, maxResolution: "720p", maxDurationSeconds: 5, videoSlots: 1 },
  { code: "STARTER_MONTHLY", name: "Starter", price: "$29/month", priceMicroUsd: 29_000_000, credits: 2500, interval: "MONTHLY", cadence: "Monthly", termMonths: 1, seats: 1, workspaces: 1, maxResolution: "1080p", maxDurationSeconds: 15, videoSlots: 1 },
  { code: "STARTER_ANNUAL", name: "Starter", price: "$278.40/year", priceMicroUsd: 278_400_000, credits: 2500, interval: "ANNUAL", cadence: "2,500 credits granted monthly", termMonths: 12, seats: 1, workspaces: 1, maxResolution: "1080p", maxDurationSeconds: 15, videoSlots: 1 },
  { code: "GROWTH_MONTHLY", name: "Growth", price: "$79/month", priceMicroUsd: 79_000_000, credits: 7000, interval: "MONTHLY", cadence: "Monthly", termMonths: 1, seats: 3, workspaces: 3, maxResolution: "4k", maxDurationSeconds: 30, videoSlots: 4 },
  { code: "GROWTH_ANNUAL", name: "Growth", price: "$758.40/year", priceMicroUsd: 758_400_000, credits: 7000, interval: "ANNUAL", cadence: "7,000 credits granted monthly", termMonths: 12, seats: 3, workspaces: 3, maxResolution: "4k", maxDurationSeconds: 30, videoSlots: 4 },
  { code: "AGENCY_MONTHLY", name: "Agency", price: "$179/month", priceMicroUsd: 179_000_000, credits: 16000, interval: "MONTHLY", cadence: "Monthly", termMonths: 1, seats: 10, workspaces: 10, maxResolution: "4k", maxDurationSeconds: 30, videoSlots: 4 },
  { code: "AGENCY_ANNUAL", name: "Agency", price: "$1,718.40/year", priceMicroUsd: 1_718_400_000, credits: 16000, interval: "ANNUAL", cadence: "16,000 credits granted monthly", termMonths: 12, seats: 10, workspaces: 10, maxResolution: "4k", maxDurationSeconds: 30, videoSlots: 4 },
]);

export const PLAN_BY_CODE = Object.freeze(Object.fromEntries(APPROVED_PLANS.map((plan) => [plan.code, plan])));

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
 * Every claim here must be true of the shipped product. Bullets are phrased
 * against plan-level facts (credits, slots, seats, workspaces, capability
 * ceilings, rollover) plus studios that actually exist — Video, Product, App and
 * Image. Deliberately NOT claimed: specific third-party model names beyond what
 * is wired up in the model registry, since the advertised bench changes and a
 * pricing page is the worst place to be wrong about it.
 *
 * `inherits` renders as "Everything in <tier>, plus:" so each column stays
 * short and the upgrade delta is legible at a glance.
 */
export const PLAN_FEATURES = Object.freeze({
  Explorer: Object.freeze({
    inherits: null,
    items: Object.freeze([
      { label: "200 credits", detail: "roughly 6 Video Studio generations" },
      { label: "1 video at a time" },
      { label: "Every studio", detail: "Video, Product, App and Image" },
      { label: "Full commercial rights to everything you make" },
      { label: "One-time payment", detail: "no subscription, no auto-renew" },
    ]),
  }),
  Starter: Object.freeze({
    inherits: null,
    items: Object.freeze([
      { label: "Every AI model", detail: "no model is held back on any plan" },
      { label: "All four studios", detail: "Video, Product, App and Image" },
      { label: "1 video generating at a time" },
      { label: "Up to 1080p", detail: "clips up to 15s" },
      { label: "Presets library and reusable asset library" },
      { label: "Rollover credits", detail: "unused credits never expire while active" },
      { label: "1 seat, 1 workspace" },
    ]),
  }),
  Growth: Object.freeze({
    inherits: "Starter",
    items: Object.freeze([
      { label: "4 videos generating at once", detail: "4x the throughput" },
      { label: "Up to 4K", detail: "clips up to 30s" },
      { label: "3 seats, 3 workspaces" },
      { label: "Shared team library across every workspace" },
    ]),
  }),
  Agency: Object.freeze({
    inherits: "Growth",
    items: Object.freeze([
      { label: "16,000 credits a month", detail: "over 2x Growth" },
      { label: "10 seats, 10 workspaces" },
      { label: "Client-ready workspace separation", detail: "one workspace per brand" },
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
