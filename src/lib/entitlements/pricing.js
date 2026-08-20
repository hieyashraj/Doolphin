import { APPROVED_PLANS } from "./plan-catalog.js";

/**
 * DOOLPHIN COMMERCIAL PRICING ENGINE — revision 2026-08-credit-rescale-v2
 *
 * ============================ THE PROFIT INVARIANT ============================
 * Doolphin must earn a positive, bounded-below margin on EVERY generation,
 * regardless of which model, resolution, duration, or output count the user
 * picks — including models that do not exist yet.
 *
 * That guarantee is structural, not per-model guesswork:
 *
 *   credits_charged = roundUpTo5( ceil( fullyLoadedCost / COST_CEILING ) )
 *
 * so by construction:                fullyLoadedCost <= credits_charged * COST_CEILING
 * and revenue is at least:           credits_charged * NET_REVENUE_FLOOR
 *
 *   margin = 1 - cost/revenue  >=  1 - COST_CEILING / NET_REVENUE_FLOOR
 *
 * With COST_CEILING = 5_000 and NET_REVENUE_FLOOR = 10_500 microUSD:
 *   worst-case margin >= 1 - 5000/10500 = 52.38%
 *
 * The invariant therefore holds for ANY cost value, because cost only ever
 * enters via the ceiling division above. A model 100x more expensive simply
 * consumes 100x more credits at the same margin. This is asserted by executable
 * proof in tests/pricing-profit-invariant.test.js.
 *
 * REQUIRED RELATIONSHIP (enforced by test, must never be violated):
 *   NET_REVENUE_FLOOR > COST_CEILING / (1 - targetContributionMargin)
 *   10_500 > 5_000 / 0.70 = 7_143  ✓
 *
 * ---------------------------- HOW THE FLOOR IS DERIVED ----------------------
 * netRevenuePerCreditFloorMicroUsd is the LOWEST net revenue per credit across
 * every purchasable plan, after Polar's merchant-of-record fee (5% + $0.50, the
 * published free-tier rate as of 2026-05). Computed per plan as:
 *
 *   (price - (price * 5% + $0.50)) / credits
 *
 *   Explorer $2.99 / 200cr    -> $2.34  net -> 11_700 microUSD/credit
 *   Starter  $29   / 2_500cr  -> $27.05 net -> 10_820 microUSD/credit
 *   Growth   $79   / 7_000cr  -> $74.55 net -> 10_650 microUSD/credit
 *   Agency   $179  / 16_000cr -> $169.55 net -> 10_597 microUSD/credit  <-- lowest
 *
 * Floor is set to 10_500 (rounded DOWN below the lowest) so the invariant is
 * conservative for every plan. Adding a plan whose net-revenue-per-credit falls
 * below this floor is a margin regression and is blocked by test.
 *
 * ------------------------- WHY THE UNIT WAS RESCALED -------------------------
 * The prior revision used 21_000 microUSD ($0.021) per credit. The unit value is
 * pure presentation — charging 4.2x more credits for 4.2x cheaper credits is
 * economically identical — but small credit balances ("700 credits") read as
 * stingy next to competitors who denominate in smaller units. Rescaling to
 * $0.005/credit yields "2,500 credits" for the same $29 at the same margin.
 *
 * COST_CEILING covers PROVIDER cost + attributable variable infra (R2 storage,
 * egress, verification). Fixed monthly opex (Vercel/Supabase/Resend, ~$40/mo)
 * is deliberately NOT amortised into this constant: at current volume it is
 * ~$0.0008/credit, i.e. under 16% of the ceiling and ~0.3% of a typical
 * generation's cost, and any estimate of it today rests on unvalidated signup
 * projections. The 52% worst-case margin absorbs it many times over. Revisit
 * once real volume data exists rather than encoding a guess as fact.
 *
 * Marketing/CAC is intentionally excluded: it is a cost per acquired CUSTOMER
 * amortised over lifetime value, not a cost per credit burned. Baking it in
 * would overcharge loyal high-usage users to subsidise acquisition.
 */
export const PRICING_REVISION = Object.freeze({
  id: "2026-08-credit-rescale-v2",
  customerListValuePerCreditMicroUsd: 11_000n,
  netRevenuePerCreditFloorMicroUsd: 10_500n,
  targetContributionMarginBps: 3000,
  maxFullyLoadedCostPerCreditMicroUsd: 5_000n,
  polarTransactionFeeBps: 500,
  polarFixedFeeMicroUsd: 500_000n,
});

export const PLAN_CODES = Object.freeze({ EXPLORER: "EXPLORER", STARTER_MONTHLY: "STARTER_MONTHLY", STARTER_ANNUAL: "STARTER_ANNUAL", GROWTH_MONTHLY: "GROWTH_MONTHLY", GROWTH_ANNUAL: "GROWTH_ANNUAL", AGENCY_MONTHLY: "AGENCY_MONTHLY", AGENCY_ANNUAL: "AGENCY_ANNUAL" });
export const PLANS = Object.freeze(Object.fromEntries(APPROVED_PLANS.map((plan) => [plan.code, { ...plan, priceMicroUsd: BigInt(plan.priceMicroUsd) }])));

/**
 * The single authoritative cost -> credits conversion. Every studio, model and
 * pipeline MUST price through this function so the profit invariant above
 * cannot be bypassed.
 *
 * Rounding is always UP (ceiling division, then up to the nearest 5 credits) so
 * rounding error can only ever favour Doolphin, never create a loss-making
 * generation.
 */
export function calculateRequiredCredits(costs) {
  const fullyLoadedCost = Object.values(costs).reduce((sum, value) => sum + BigInt(value || 0), 0n);
  const rawCredits = (fullyLoadedCost + PRICING_REVISION.maxFullyLoadedCostPerCreditMicroUsd - 1n) / PRICING_REVISION.maxFullyLoadedCostPerCreditMicroUsd;
  const quotedCredits = ((rawCredits + 4n) / 5n) * 5n;
  return { fullyLoadedCostMicroUsd: fullyLoadedCost, rawCredits, quotedCredits, pricingRevisionId: PRICING_REVISION.id, marginAssumptionBps: PRICING_REVISION.targetContributionMarginBps };
}

/**
 * Net revenue per credit for a specific plan, after Polar's fee. Exposed so the
 * proof tests can verify every plan independently clears the floor.
 */
/**
 * Total credits a single purchase of this plan actually grants.
 *
 * An annual plan is charged ONCE but grants `credits` every month for the whole
 * term (materializeAnnualGrantSchedule creates 12 periods of `credits` each), so
 * the term total is `credits * termMonths`. Using a single month's allowance as
 * the denominator for an annual price overstates revenue per credit by 12x.
 *
 * `termMonths` is required rather than defaulted: silently assuming 1 is exactly
 * the mistake this function exists to prevent.
 */
export function creditsGrantedOverTerm(plan) {
  const credits = BigInt(plan.credits);
  if (credits <= 0n) throw new Error(`Plan '${plan.code}' has non-positive credits`);

  const termMonths = BigInt(plan.termMonths ?? 0);
  if (termMonths <= 0n) {
    throw new Error(
      `Plan '${plan.code}' does not declare termMonths. Revenue per credit cannot be computed without knowing how many times the credit allowance is granted for a single charge.`
    );
  }
  return credits * termMonths;
}

/**
 * Net revenue per credit, after payment processing, across the whole billing
 * term. This is the figure that must clear the cost ceiling with margin.
 */
export function netRevenuePerCreditMicroUsd(plan) {
  const priceMicroUsd = BigInt(plan.priceMicroUsd);
  const credits = creditsGrantedOverTerm(plan);
  const processingFee = (priceMicroUsd * BigInt(PRICING_REVISION.polarTransactionFeeBps)) / 10_000n + PRICING_REVISION.polarFixedFeeMicroUsd;
  if (processingFee >= priceMicroUsd) throw new Error(`Plan '${plan.code}' price does not cover payment processing fees`);
  return (priceMicroUsd - processingFee) / credits;
}

/**
 * Worst-case contribution margin in basis points: the user burns 100% of the
 * credits their plan grants, entirely on generations that cost the maximum the
 * cost ceiling allows.
 *
 * This is the HARD business invariant. Unlike the per-credit revenue floor
 * (which monthly plans clear comfortably and annual plans intentionally do not,
 * because annual trades per-credit revenue for prepayment), this must hold for
 * every purchasable plan without exception.
 */
export function worstCaseContributionMarginBps(plan) {
  const netPerCredit = netRevenuePerCreditMicroUsd(plan);
  const ceiling = PRICING_REVISION.maxFullyLoadedCostPerCreditMicroUsd;
  if (netPerCredit <= ceiling) return 0;
  return Number(((netPerCredit - ceiling) * 10_000n) / netPerCredit);
}
