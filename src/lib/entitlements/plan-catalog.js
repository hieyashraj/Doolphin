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
export const APPROVED_PLANS = Object.freeze([
  { code: "EXPLORER", name: "Explorer", price: "$2.99", priceMicroUsd: 2_990_000, credits: 200, interval: "ONE_TIME", cadence: "One-time", termMonths: 1, seats: 1, workspaces: 1, maxResolution: "720p", maxDurationSeconds: 5 },
  { code: "STARTER_MONTHLY", name: "Starter", price: "$29/month", priceMicroUsd: 29_000_000, credits: 2500, interval: "MONTHLY", cadence: "Monthly", termMonths: 1, seats: 1, workspaces: 1, maxResolution: "1080p", maxDurationSeconds: 15 },
  { code: "STARTER_ANNUAL", name: "Starter", price: "$278.40/year", priceMicroUsd: 278_400_000, credits: 2500, interval: "ANNUAL", cadence: "2,500 credits granted monthly", termMonths: 12, seats: 1, workspaces: 1, maxResolution: "1080p", maxDurationSeconds: 15 },
  { code: "GROWTH_MONTHLY", name: "Growth", price: "$79/month", priceMicroUsd: 79_000_000, credits: 7000, interval: "MONTHLY", cadence: "Monthly", termMonths: 1, seats: 3, workspaces: 3, maxResolution: "4k", maxDurationSeconds: 30 },
  { code: "GROWTH_ANNUAL", name: "Growth", price: "$758.40/year", priceMicroUsd: 758_400_000, credits: 7000, interval: "ANNUAL", cadence: "7,000 credits granted monthly", termMonths: 12, seats: 3, workspaces: 3, maxResolution: "4k", maxDurationSeconds: 30 },
  { code: "AGENCY_MONTHLY", name: "Agency", price: "$179/month", priceMicroUsd: 179_000_000, credits: 16000, interval: "MONTHLY", cadence: "Monthly", termMonths: 1, seats: 10, workspaces: 10, maxResolution: "4k", maxDurationSeconds: 30 },
  { code: "AGENCY_ANNUAL", name: "Agency", price: "$1,718.40/year", priceMicroUsd: 1_718_400_000, credits: 16000, interval: "ANNUAL", cadence: "16,000 credits granted monthly", termMonths: 12, seats: 10, workspaces: 10, maxResolution: "4k", maxDurationSeconds: 30 },
]);

export const PLAN_BY_CODE = Object.freeze(Object.fromEntries(APPROVED_PLANS.map((plan) => [plan.code, plan])));
export const PURCHASE_PLAN_CODES = Object.freeze(["EXPLORER", "STARTER_MONTHLY", "GROWTH_MONTHLY", "AGENCY_MONTHLY"]);
