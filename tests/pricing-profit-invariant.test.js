import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  PRICING_REVISION,
  PLANS,
  calculateRequiredCredits,
  netRevenuePerCreditMicroUsd,
  creditsGrantedOverTerm,
  worstCaseContributionMarginBps,
} from "../src/lib/entitlements/pricing.js";
import { APPROVED_PLANS, PURCHASE_PLAN_CODES, PLAN_BY_CODE } from "../src/lib/entitlements/plan-catalog.js";

/**
 * EXECUTABLE PROOF THAT DOOLPHIN CANNOT LOSE MONEY ON A GENERATION.
 *
 * These are not smoke tests. Each one closes a specific way the business could
 * bleed money: a mispriced model, a rounding error, a plan that undercuts the
 * margin floor, or a client that talks the server into a cheaper price.
 *
 * All tests are pure arithmetic / static source assertions. Nothing here makes a
 * network call, so running this suite can never spend provider credits.
 */

const COST_CEILING = PRICING_REVISION.maxFullyLoadedCostPerCreditMicroUsd; // microUSD of cost per 1 credit
const NET_FLOOR = PRICING_REVISION.netRevenuePerCreditFloorMicroUsd;       // microUSD of net revenue per 1 credit
const TARGET_MARGIN_BPS = PRICING_REVISION.targetContributionMarginBps;

// ---------------------------------------------------------------------------
// 1. THE CORE INVARIANT
// ---------------------------------------------------------------------------

test("INVARIANT: net revenue per credit exceeds the cost ceiling by at least the target margin", () => {
  // margin >= 1 - COST_CEILING/NET_FLOOR must be >= targetContributionMarginBps.
  // Equivalently: NET_FLOOR > COST_CEILING / (1 - targetMargin).
  const requiredFloor = (COST_CEILING * 10_000n) / (10_000n - BigInt(TARGET_MARGIN_BPS));
  assert.ok(
    NET_FLOOR > requiredFloor,
    `netRevenuePerCreditFloor (${NET_FLOOR}) must exceed ${requiredFloor} to sustain a ${TARGET_MARGIN_BPS / 100}% margin`
  );

  const worstCaseMarginBps = Number(((NET_FLOOR - COST_CEILING) * 10_000n) / NET_FLOOR);
  assert.ok(
    worstCaseMarginBps >= TARGET_MARGIN_BPS,
    `structural worst-case margin ${worstCaseMarginBps}bps is below target ${TARGET_MARGIN_BPS}bps`
  );
  // Documents the actual guarantee: ~52% worst case, not merely the 30% floor.
  assert.ok(worstCaseMarginBps >= 5000, `expected >=50% structural margin, got ${worstCaseMarginBps}bps`);
});

test("INVARIANT: for ANY provider cost, credits charged always cover cost at target margin", () => {
  // Fuzz across 6 orders of magnitude: from a fraction of a cent to $150 —
  // far beyond the most expensive real generation (30s 4K Seedance ~ $15).
  // This is what makes the guarantee model-agnostic and future-model-proof.
  const costsMicroUsd = [
    1n, 5n, 999n, 1_000n, 4_999n, 5_000n, 5_001n,
    48_380n,        // 1s Seedance 2 Omni
    241_900n,       // 5s Seedance 2 Omni
    514_000n,       // 5s Seedance 2.5 480p
    1_156_000n,     // 5s Seedance 2.5 1080p
    1_200_000n,     // 8s Veo 3.1 Fast 1080p + audio
    2_800_000n,     // 8s Veo 3.1 Fast 4K + audio
    3_200_000n,     // 8s Veo 3.1 Standard 1080p + audio
    4_800_000n,     // 8s Veo 3.1 4K + audio
    15_000_000n,    // 30s Seedance 2.5 4K (worst real case)
    150_000_000n,   // absurd future model, 10x the worst case
  ];

  for (const cost of costsMicroUsd) {
    const { quotedCredits } = calculateRequiredCredits({ total: cost });

    // (a) Credits charged must always be enough to cover the real cost.
    const costAllowance = quotedCredits * COST_CEILING;
    assert.ok(
      costAllowance >= cost,
      `cost ${cost} exceeds allowance ${costAllowance} at ${quotedCredits} credits — LOSS-MAKING`
    );

    // (b) Revenue at the floor must beat cost by the target margin.
    const revenue = quotedCredits * NET_FLOOR;
    const marginBps = Number(((revenue - cost) * 10_000n) / revenue);
    assert.ok(
      marginBps >= TARGET_MARGIN_BPS,
      `cost ${cost} yields margin ${marginBps}bps, below target ${TARGET_MARGIN_BPS}bps`
    );
  }
});

test("INVARIANT: rounding can only ever favour Doolphin, never the customer", () => {
  // Ceiling division + round-up-to-5 must never charge less than raw cost.
  for (let micro = 1n; micro <= 60_000n; micro += 137n) {
    const { rawCredits, quotedCredits } = calculateRequiredCredits({ total: micro });
    assert.ok(quotedCredits >= rawCredits, `quoted ${quotedCredits} < raw ${rawCredits} at cost ${micro}`);
    assert.ok(quotedCredits * COST_CEILING >= micro, `under-charged at cost ${micro}`);
    assert.equal(quotedCredits % 5n, 0n, `quoted credits ${quotedCredits} not a multiple of 5`);
  }
});

test("INVARIANT: zero cost never yields negative or fractional credits", () => {
  const zero = calculateRequiredCredits({ total: 0n });
  assert.equal(zero.quotedCredits, 0n);
  assert.equal(zero.rawCredits, 0n);
  // Negative cost must not produce a negative charge that could credit a user.
  const negative = calculateRequiredCredits({ total: -5_000n });
  assert.ok(negative.quotedCredits <= 0n, "negative cost must never mint positive credits");
});

// ---------------------------------------------------------------------------
// 2. EVERY PLAN MUST INDEPENDENTLY CLEAR THE FLOOR
// ---------------------------------------------------------------------------

test("every plan declares how many times a single charge grants its credit allowance", () => {
  // Without termMonths, revenue per credit is not computable, and the previous
  // version of these tests silently divided an ANNUAL price by ONE month's
  // allowance — overstating annual revenue per credit by 12x and passing on a
  // number that did not exist. Requiring the field makes that failure loud.
  for (const plan of APPROVED_PLANS) {
    assert.ok(
      Number.isInteger(plan.termMonths) && plan.termMonths >= 1,
      `plan ${plan.code} must declare termMonths`
    );
    const expected = plan.interval === "ANNUAL" ? 12 : 1;
    assert.equal(plan.termMonths, expected, `plan ${plan.code}: ${plan.interval} implies ${expected} grant period(s)`);
    assert.equal(
      creditsGrantedOverTerm(plan),
      BigInt(plan.credits) * BigInt(plan.termMonths),
      `plan ${plan.code}: term credits must be allowance x periods`
    );
  }
});

test("HARD INVARIANT: every plan stays profitable at the target margin even if 100% of credits are burned at the cost ceiling", () => {
  // This is the invariant that actually matters: whatever model the customer
  // picks, and however completely they drain the plan, the plan still earns.
  // Measured over the FULL billing term, so annual prepayment cannot flatter it.
  for (const plan of APPROVED_PLANS) {
    const netPerCredit = netRevenuePerCreditMicroUsd(plan);
    const termCredits = creditsGrantedOverTerm(plan);

    assert.ok(
      netPerCredit > COST_CEILING,
      `plan ${plan.code}: nets ${netPerCredit} microUSD/credit against a ${COST_CEILING} ceiling — LOSS-MAKING`
    );

    const marginBps = worstCaseContributionMarginBps(plan);
    assert.ok(
      marginBps >= TARGET_MARGIN_BPS,
      `plan ${plan.code} worst-case margin ${marginBps}bps below target ${TARGET_MARGIN_BPS}bps ` +
        `(${termCredits} credits over ${plan.termMonths} month(s))`
    );
  }
});

test("recurring-cadence plans clear the per-credit revenue floor; annual is knowingly thinner", () => {
  // The $10,500/credit floor is the pricing target for a plan billed at its
  // headline rate. Annual plans deliberately sit BELOW it: a 20% prepayment
  // discount necessarily buys credits more cheaply. That is a priced business
  // decision, not a regression — but it must be stated explicitly rather than
  // hidden behind a denominator error, and it is still bounded by the hard
  // margin invariant above.
  for (const plan of APPROVED_PLANS) {
    const perCredit = netRevenuePerCreditMicroUsd(plan);

    if (plan.interval === "ANNUAL") {
      assert.ok(
        perCredit < NET_FLOOR,
        `plan ${plan.code} nets ${perCredit}/credit — if annual now clears the floor, the discount or the floor changed; re-derive both`
      );
      // Bound how thin the discount may make it. Beyond ~20% below the floor the
      // annual discount would be eating into the margin rather than the markup.
      assert.ok(
        perCredit >= (NET_FLOOR * 80n) / 100n,
        `plan ${plan.code} nets ${perCredit}/credit, more than 20% below the ${NET_FLOOR} floor — annual discount is too deep`
      );
    } else {
      assert.ok(
        perCredit >= NET_FLOOR,
        `plan ${plan.code} nets ${perCredit} microUSD/credit, BELOW floor ${NET_FLOOR} — margin regression`
      );
    }
  }
});

test("annual is never cheaper per credit than paying monthly would be irrational to sell", () => {
  // Sanity-check the discount direction and size: annual must be cheaper per
  // credit than monthly (otherwise nobody buys it) but not by so much that it
  // undercuts the business (guarded above).
  for (const [monthlyCode, annualCode] of [
    ["STARTER_MONTHLY", "STARTER_ANNUAL"],
    ["GROWTH_MONTHLY", "GROWTH_ANNUAL"],
    ["AGENCY_MONTHLY", "AGENCY_ANNUAL"],
  ]) {
    const monthly = netRevenuePerCreditMicroUsd(PLAN_BY_CODE[monthlyCode]);
    const annual = netRevenuePerCreditMicroUsd(PLAN_BY_CODE[annualCode]);
    assert.ok(annual < monthly, `${annualCode} must net less per credit than ${monthlyCode}`);
    const discountBps = Number(((monthly - annual) * 10_000n) / monthly);
    assert.ok(
      discountBps > 1000 && discountBps < 3000,
      `${annualCode} effective per-credit discount is ${discountBps}bps; expected a ~20% annual discount`
    );
  }
});

test("payment processing fees never exceed plan price (no negative-revenue plan)", () => {
  for (const plan of APPROVED_PLANS) {
    // netRevenuePerCreditMicroUsd throws if fees swallow the price; assert it doesn't.
    assert.doesNotThrow(() => netRevenuePerCreditMicroUsd(plan), `plan ${plan.code} price does not cover Polar fees`);
  }

  // A price so low that Polar's fixed $0.50 fee exceeds it entirely must throw.
  assert.throws(
    () => netRevenuePerCreditMicroUsd({ code: "HYPOTHETICAL_40_CENTS", priceMicroUsd: 400_000, credits: 10, termMonths: 1 }),
    /does not cover payment processing/,
    "a sub-$0.53 plan must be rejected outright: Polar's fixed fee exceeds the price"
  );

  // The subtler and more dangerous trap: a competitor-style "$1 for 90 credits"
  // offer. Polar's fee does NOT exceed $1 (fee = $0.55, net = $0.45), so it
  // looks viable — but $0.45 across 90 credits is exactly $0.005/credit, which
  // equals the cost ceiling and therefore yields ZERO margin. It must fail the
  // floor check. This is why Explorer is priced at $2.99/200cr, not $1/90cr.
  const dollarPlanPerCredit = netRevenuePerCreditMicroUsd({ code: "HYPOTHETICAL_1_DOLLAR", priceMicroUsd: 1_000_000, credits: 90, termMonths: 1 });
  assert.ok(
    dollarPlanPerCredit < NET_FLOOR,
    "a $1/90-credit plan must fall below the margin floor and never be shipped"
  );
  assert.ok(
    dollarPlanPerCredit <= COST_CEILING,
    `a $1/90-credit plan nets ${dollarPlanPerCredit} microUSD/credit against a ${COST_CEILING} cost ceiling — zero or negative margin`
  );
});

test("annual plans grant the same monthly credit allowance as their monthly counterpart", () => {
  const pairs = [["STARTER_MONTHLY", "STARTER_ANNUAL"], ["GROWTH_MONTHLY", "GROWTH_ANNUAL"], ["AGENCY_MONTHLY", "AGENCY_ANNUAL"]];
  for (const [monthly, annual] of pairs) {
    assert.equal(
      PLAN_BY_CODE[annual].credits,
      PLAN_BY_CODE[monthly].credits,
      `${annual} credits must match ${monthly} (granted monthly over the term)`
    );
  }
});

test("plan catalog and pricing engine agree, and all purchasable codes exist", () => {
  for (const code of PURCHASE_PLAN_CODES) {
    assert.ok(PLAN_BY_CODE[code], `purchasable plan ${code} missing from catalog`);
    assert.ok(PLANS[code], `purchasable plan ${code} missing from pricing engine`);
    assert.equal(PLANS[code].credits, PLAN_BY_CODE[code].credits, `${code} credit mismatch between engine and catalog`);
    assert.equal(String(PLANS[code].priceMicroUsd), String(PLAN_BY_CODE[code].priceMicroUsd), `${code} price mismatch`);
  }
});

test("credit values reflect the rescaled unit (regression guard against silent reversion)", () => {
  assert.equal(COST_CEILING, 5_000n, "cost ceiling must be $0.005/credit for revision 2026-08-credit-rescale-v2");
  assert.equal(PRICING_REVISION.id, "2026-08-credit-rescale-v2");
  // Explorer is 220, not 200: raised to the largest allowance that still clears
  // the revenue floor once Polar's fixed $0.50 fee is taken off a $2.99 charge.
  // 320 was tried and reverted — it netted 7314 microUSD/credit against the
  // 10500 floor. The floor test above is what proves this number is safe.
  assert.equal(PLAN_BY_CODE.EXPLORER.credits, 220);
  assert.equal(PLAN_BY_CODE.STARTER_MONTHLY.credits, 2500);
  assert.equal(PLAN_BY_CODE.GROWTH_MONTHLY.credits, 7000);
  assert.equal(PLAN_BY_CODE.AGENCY_MONTHLY.credits, 16000);
});

// ---------------------------------------------------------------------------
// 3. ANTI-EXPLOIT: the client must never be able to lower its own price
// ---------------------------------------------------------------------------

test("EXPLOIT GUARD: generation submission derives price from the server-stored quote, never the request body", () => {
  const source = fs.readFileSync(new URL("../src/app/api/generations/route.js", import.meta.url), "utf8");
  // Only quoteId + idempotencyKey may be read from the client.
  assert.match(source, /body\?\.quoteId/, "must read quoteId from body");
  assert.match(source, /body\?\.idempotencyKey/, "must read idempotencyKey from body");
  // Price-bearing fields must never be sourced from the request body.
  for (const forbidden of ["body.credits", "body.price", "body.totalCredits", "body.cost", "body.quotedCredits"]) {
    assert.ok(!source.includes(forbidden), `price must not come from client: found '${forbidden}'`);
  }
  // Credits reserved must come from the validated prepared plan.
  assert.match(source, /totalCreditsToReserve = validatedPlan\.workflowPricing\.quotedCredits/);
});

test("EXPLOIT GUARD: a tampered provider payload cannot be dispatched (hash binding)", () => {
  const source = fs.readFileSync(new URL("../src/lib/models/execution/validateDispatch.js", import.meta.url), "utf8");
  assert.match(source, /createHash\("sha256"\)\.update\(preparedPlan\.providerPayloadJson\)/);
  assert.match(source, /HASH_TAMPERED/);
  // Credit amount on the quote must equal the prepared plan's quoted credits.
  assert.match(source, /quote\.internalCreditsToReserve !== preparedPlan\.workflowPricing\.quotedCredits/);
  assert.match(source, /CREDIT_MISMATCH/);
  // Output count must match what was priced, so a user cannot get N outputs for 1.
  assert.match(source, /request\.settings\.outputCount !== preparedPlan\.workflowPricing\.outputCount/);
  assert.match(source, /OUTPUT_COUNT_MISMATCH/);
});

test("EXPLOIT GUARD: a quote can only be consumed once, under a race-safe claim", () => {
  const source = fs.readFileSync(new URL("../src/app/api/generations/route.js", import.meta.url), "utf8");
  // Single-writer claim: updateMany filtered on consumedAt: null.
  assert.match(source, /preflightQuote\.updateMany\(\{ where: \{ id: quote\.id, consumedAt: null/);
  assert.match(source, /quoteClaim\.count !== 1/);
  // Idempotency short-circuit prevents double-charging on retry/double-click.
  assert.match(source, /workspaceId_idempotencyKey/);
  // The financial transaction must be Serializable.
  assert.match(source, /isolationLevel: "Serializable"/);
});

test("EXPLOIT GUARD: output count is bounded, so one quote cannot fan out unboundedly", () => {
  const contract = fs.readFileSync(new URL("../src/lib/generation/contract.js", import.meta.url), "utf8");
  assert.match(contract, /outputCount: z\.number\(\)\.int\(\)\.min\(1\)\.max\(2\)/);
});

test("EXPLOIT GUARD: unpriced models fail closed instead of generating for free", () => {
  const registry = fs.readFileSync(new URL("../src/lib/generation/modelCostRegistry.js", import.meta.url), "utf8");
  assert.match(registry, /GENERATION_CONFIGURATION_UNPRICED/);
  assert.match(registry, /priced: false/);
  // Margin guardrail: a model that would breach the target margin is refused.
  assert.match(registry, /contributionMarginBps < PRICING_REVISION\.targetContributionMarginBps/);
});

// ---------------------------------------------------------------------------
// 4. ANTI-WASTE: money must not be spent on inputs the provider cannot read
// ---------------------------------------------------------------------------

test("WASTE GUARD: preflight blocks unreachable assets before creating a billable quote", () => {
  const source = fs.readFileSync(new URL("../src/app/api/preflight/route.js", import.meta.url), "utf8");
  const gate = source.indexOf("assertProviderAssetsAreFetchable");
  const quoteCreate = source.indexOf("prisma.preflightQuote.create");
  assert.ok(gate > 0, "preflight must call the asset reachability gate");
  assert.ok(quoteCreate > gate, "reachability gate must run BEFORE the billable quote is created");
});

test("WASTE GUARD: localhost/private origins can never be handed to the provider", () => {
  const origin = fs.readFileSync(new URL("../src/lib/models/bridges/applicationOrigin.js", import.meta.url), "utf8");
  // The removed rule must not come back.
  assert.ok(!/hostname === "localhost"/.test(origin), "applicationOrigin must not re-admit localhost as an asset origin");
  assert.ok(!/isNonProduction && requestOrigin/.test(origin), "non-production must not get a weaker asset-origin rule on a paid path");
});

test("WASTE GUARD: resolution mismatch fails closed rather than silently downgrading a paid render", () => {
  const def = fs.readFileSync(new URL("../src/lib/models/definitions/seedance-2-omni-reference-fast.js", import.meta.url), "utf8");
  assert.match(def, /only produces 720p/);
  assert.match(def, /nativeResolution: "720p"/);
});
