import test from "node:test";
import assert from "node:assert/strict";

/**
 * PROOF THAT REAL-TIME PRICING WORKS — with a MOCKED provider.
 *
 * This answers "what's the proof it'll always fetch the right price?" by
 * separating two different claims:
 *
 *   CLAIM 1 (proven here): the MECHANISM is correct. Given whatever cost MuAPI
 *   reports, Doolphin converts it to credits correctly, quotes the exact payload
 *   it will later dispatch, and fails closed if the provider does not answer.
 *
 *   CLAIM 2 (NOT provable by any test): that MuAPI's reported number is itself
 *   correct. That is guaranteed structurally rather than by testing — the price
 *   is never transcribed by a human or hardcoded from a docs page; it is read
 *   from MuAPI at request time for the exact payload being run. Doolphin cannot
 *   be wrong about a price it never authored. If MuAPI changes a price, the next
 *   quote reflects it automatically.
 *
 * Every request here goes to a mock. No network call, no provider spend.
 *
 * NOTE: this suite imports the estimator, which transitively imports `zod`. It
 * self-skips when node_modules is unavailable (e.g. a bare checkout) so it never
 * produces a false failure, and runs normally under `npm test`.
 */

let estimateAuthoritativeModelCost;
let importFailure = null;
try {
  ({ estimateAuthoritativeModelCost } = await import("../src/lib/models/execution/estimateCost.js"));
} catch (error) {
  importFailure = error;
}
const maybeTest = importFailure ? test.skip : test;
if (importFailure) {
  console.log(`[realtime-pricing] skipped: dependencies unavailable (${importFailure.message.split("\n")[0]})`);
}

const SANDBOX_ENV = { DOOLPHIN_ENV: "staging", MUAPI_API_KEY_SANDBOX: "sk_sandbox_test_key" };

/** A model that prices dynamically, i.e. MuAPI is the price authority. */
function dynamicModel() {
  return {
    providerSpec: {
      providerModelId: "veo3.1-fast-image-to-video",
      endpoint: "https://api.muapi.ai/api/v1/veo3.1-fast-image-to-video",
      dynamicPricing: true,
      estimateEndpoint: "https://api.muapi.ai/api/v1/models/veo3.1-fast-image-to-video/estimate-cost",
      // Matches MuAPI's live catalog: $0.60 representative base, dynamic. No
      // `strategy` marker — MuAPI's cost_strategy is an opaque identifier and
      // must never be parsed as a billing basis.
      cost: { amount: 0.6, currency: "USD" },
    },
    productPolicy: { id: "muapi.veo3.1-fast-i2v", displayName: "Veo 3.1 Fast I2V" },
    businessPolicy: { targetContributionMarginBps: 3000, variableInfraCostMicroUsd: 20000n, minimumCredits: 45 },
    toProviderPayload(input) {
      return { prompt: input.prompt, duration: input.duration, aspect_ratio: input.aspectRatio };
    },
  };
}

/**
 * A genuinely fixed-price model, per MuAPI's live catalog:
 * seedance-2.1-image-to-video is dynamic_pricing=false at exactly $0.40, with
 * estimate_endpoint null. This is the ONLY shape that may be billed without
 * calling the provider.
 */
function fixedPriceModel() {
  return {
    providerSpec: {
      providerModelId: "seedance-2.1-image-to-video",
      endpoint: "https://api.muapi.ai/api/v1/seedance-2.1-image-to-video",
      dynamicPricing: false,
      estimateEndpoint: null,
      cost: { amount: 0.4, currency: "USD" },
    },
    productPolicy: { id: "muapi.seedance-2.1-i2v", displayName: "Seedance 2.1 I2V" },
    businessPolicy: { targetContributionMarginBps: 3000, variableInfraCostMicroUsd: 20000n, minimumCredits: 45 },
    toProviderPayload(input) {
      return { prompt: input.prompt, duration: input.duration };
    },
  };
}

function mockEstimateResponder(bodyObject, { status = 200 } = {}) {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, options });
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => bodyObject,
    };
  };
  return { fetchImpl, calls };
}

const baseInput = { prompt: "A creator holding the product", duration: 8, aspectRatio: "9:16" };

// ---------------------------------------------------------------------------
// CLAIM 1a: whatever the provider reports is what drives the charge
// ---------------------------------------------------------------------------

maybeTest("real-time: the credit charge is derived from the provider's reported cost", async () => {
  // Screenshot case: $0.15/sec, 8s -> MuAPI reports $1.20
  const { fetchImpl } = mockEstimateResponder({ cost: 1.2 });
  const quote = await estimateAuthoritativeModelCost({
    modelDefinition: dynamicModel(),
    normalizedInput: baseInput,
    fetchImpl,
    env: SANDBOX_ENV,
  });

  assert.equal(quote.priced, true, `expected a priced quote, got: ${quote.reason || "no reason"}`);
  assert.equal(quote.isDynamic, true, "must be flagged as dynamically priced");
  // $1.20 provider + $0.02 infra = $1.22 -> ceil(1_220_000/25_000)=49 -> round to 50
  assert.equal(quote.quotedCredits, 50, "credits must follow the provider-reported cost");
});

maybeTest("real-time: a DIFFERENT provider price yields a proportionally different charge", async () => {
  // Same model, same request shape, but provider reports a higher price (e.g. a
  // longer duration or a mid-flight MuAPI price change). Doolphin must follow it,
  // with no code change and no redeploy.
  const { fetchImpl } = mockEstimateResponder({ cost: 2.0 });
  const quote = await estimateAuthoritativeModelCost({
    modelDefinition: dynamicModel(),
    normalizedInput: baseInput,
    fetchImpl,
    env: SANDBOX_ENV,
  });
  assert.equal(quote.priced, true, `expected a priced quote, got: ${quote.reason || "no reason"}`);
  // $2.00 + $0.02 = $2.02 -> ceil(2_020_000/25_000)=81 -> round to 85
  assert.equal(quote.quotedCredits, 85);
});

maybeTest("real-time: an implausibly high provider price is refused, not passed to the customer", async () => {
  // veo3.1-fast-image-to-video is $0.60 in MuAPI's catalog. A quote of $4.80 is
  // 8x that — far outside the drift band — which is the signature of a units bug
  // rather than a real price. Charging a customer ~195 credits on the strength of
  // an unvalidated number is exactly what the guard exists to prevent.
  const { fetchImpl } = mockEstimateResponder({ cost: 4.8 });
  const quote = await estimateAuthoritativeModelCost({
    modelDefinition: dynamicModel(),
    normalizedInput: baseInput,
    fetchImpl,
    env: SANDBOX_ENV,
  });
  assert.equal(quote.priced, false, "an 8x outlier must not be billed");
  assert.equal(quote.code, "PROVIDER_COST_DRIFT_HIGH");
});

maybeTest("real-time: alternate provider field names for cost are all honoured", async () => {
  for (const body of [{ cost: 0.75 }, { estimated_cost: 0.75 }, { amount: 0.75 }, { amount_usd: 0.75 }]) {
    const { fetchImpl } = mockEstimateResponder(body);
    const quote = await estimateAuthoritativeModelCost({
      modelDefinition: dynamicModel(),
      normalizedInput: baseInput,
      fetchImpl,
      env: SANDBOX_ENV,
    });
    assert.equal(quote.priced, true, `field shape ${JSON.stringify(body)} must be understood`);
    // $0.75 + $0.02 = $0.77 -> ceil(770_000/25_000)=31 -> 35
    assert.equal(quote.quotedCredits, 35, `field shape ${JSON.stringify(body)} produced wrong credits`);
  }
});

// ---------------------------------------------------------------------------
// CLAIM 1b: we quote the EXACT payload we will run (no quote/run divergence)
// ---------------------------------------------------------------------------

maybeTest("real-time: the estimate is requested for the exact payload that will be dispatched", async () => {
  const { fetchImpl, calls } = mockEstimateResponder({ cost: 1.2 });
  const model = dynamicModel();
  await estimateAuthoritativeModelCost({
    modelDefinition: model,
    normalizedInput: baseInput,
    fetchImpl,
    env: SANDBOX_ENV,
  });

  assert.equal(calls.length, 1, "exactly one estimate call");
  assert.equal(calls[0].url, model.providerSpec.estimateEndpoint, "must hit the model's declared estimate endpoint");
  assert.equal(calls[0].options.method, "POST");

  // The body priced must equal the body the model would actually send. If these
  // ever diverge, a user could be quoted for one render and charged for another.
  const pricedBody = JSON.parse(calls[0].options.body);
  const dispatchBody = model.toProviderPayload(baseInput);
  assert.deepEqual(pricedBody, dispatchBody, "priced payload must equal dispatch payload");
  assert.equal(pricedBody.duration, 8, "duration must be carried into the priced payload");
});

maybeTest("real-time: a caller-supplied prepared payload is priced verbatim", async () => {
  // prepareExecutionPlan hashes and freezes one canonical payload, then passes
  // that exact JSON string here. It must be priced byte-for-byte, not rebuilt.
  const frozenJson = JSON.stringify({ prompt: "frozen", duration: 5, aspect_ratio: "16:9" });
  const { fetchImpl, calls } = mockEstimateResponder({ cost: 0.75 });
  await estimateAuthoritativeModelCost({
    modelDefinition: dynamicModel(),
    normalizedInput: baseInput,
    alreadyPreparedPayloadJson: frozenJson,
    fetchImpl,
    env: SANDBOX_ENV,
  });
  assert.equal(calls[0].options.body, frozenJson, "the frozen canonical payload must be priced verbatim");
});

// ---------------------------------------------------------------------------
// CLAIM 1c: if the provider does not give a usable price, NOTHING is sold
// ---------------------------------------------------------------------------

maybeTest("FAIL CLOSED: provider HTTP error never yields a free or guessed generation", async () => {
  for (const status of [400, 401, 404, 429, 500, 503]) {
    const { fetchImpl } = mockEstimateResponder({ error: "nope" }, { status });
    const quote = await estimateAuthoritativeModelCost({
      modelDefinition: dynamicModel(),
      normalizedInput: baseInput,
      fetchImpl,
      env: SANDBOX_ENV,
    });
    assert.equal(quote.priced, false, `HTTP ${status} must not produce a price`);
    assert.ok(quote.reason.includes(String(status)), `reason should name the status (${status})`);
  }
});

maybeTest("FAIL CLOSED: a response with no cost field is refused", async () => {
  const { fetchImpl } = mockEstimateResponder({ status: "ok", currency: "USD" });
  const quote = await estimateAuthoritativeModelCost({
    modelDefinition: dynamicModel(),
    normalizedInput: baseInput,
    fetchImpl,
    env: SANDBOX_ENV,
  });
  assert.equal(quote.priced, false);
  assert.match(quote.reason, /missing cost property/);
});

maybeTest("FAIL CLOSED: a network failure or timeout is refused, not treated as zero", async () => {
  const throwing = async () => { throw new Error("socket hang up"); };
  const netQuote = await estimateAuthoritativeModelCost({
    modelDefinition: dynamicModel(), normalizedInput: baseInput, fetchImpl: throwing, env: SANDBOX_ENV,
  });
  assert.equal(netQuote.priced, false);

  const aborting = async () => { const e = new Error("aborted"); e.name = "AbortError"; throw e; };
  const toQuote = await estimateAuthoritativeModelCost({
    modelDefinition: dynamicModel(), normalizedInput: baseInput, fetchImpl: aborting, env: SANDBOX_ENV, timeoutMs: 10,
  });
  assert.equal(toQuote.priced, false);
  assert.match(toQuote.reason, /timed out/);
});

maybeTest("FAIL CLOSED: dynamic model without an estimate endpoint cannot be sold", async () => {
  const model = dynamicModel();
  model.providerSpec.estimateEndpoint = null;
  const quote = await estimateAuthoritativeModelCost({
    modelDefinition: model, normalizedInput: baseInput, fetchImpl: async () => { throw new Error("must not be called"); }, env: SANDBOX_ENV,
  });
  assert.equal(quote.priced, false);
  assert.match(quote.reason, /no estimateEndpoint is configured/);
});

// ---------------------------------------------------------------------------
// CLAIM 1d: the fixed-price path bills MuAPI's exact price, and only that
//
// MuAPI's contract: dynamic_pricing=false means `cost` IS the exact price per
// call and estimate_endpoint is null. There are no per-second rates to
// reconstruct — where price varies with duration or resolution, MuAPI marks the
// model dynamic and resolves it server-side.
// ---------------------------------------------------------------------------

maybeTest("fixed price: MuAPI's exact per-call cost is billed, with no network call", async () => {
  const model = fixedPriceModel();

  // Duration must NOT change the charge: for a fixed-price model the catalog
  // price is already the total. Multiplying it would overcharge the customer.
  for (const duration of [4, 8, 10]) {
    const quote = await estimateAuthoritativeModelCost({
      modelDefinition: model,
      normalizedInput: { ...baseInput, duration },
      fetchImpl: async () => { throw new Error("fixed pricing must not call the network"); },
      env: SANDBOX_ENV,
    });
    assert.equal(quote.priced, true, `expected a price, got: ${quote.reason || "no reason"}`);
    assert.equal(quote.isDynamic, false);
    assert.ok(
      Math.abs(quote.providerCostUsd - 0.4) < 1e-9,
      `must bill MuAPI's exact $0.40, got $${quote.providerCostUsd}`
    );
    // $0.40 + $0.02 infra = $0.42 -> ceil(420_000/25_000)=17 -> round to 20
    assert.equal(quote.quotedCredits, 20, `duration ${duration}s must not change a fixed price`);
    assert.equal(quote.billedDurationSeconds, null, "a fixed price has no duration basis");
  }
});

maybeTest("fixed price: the billed figure is cross-checked against MuAPI's catalog", async () => {
  const quote = await estimateAuthoritativeModelCost({
    modelDefinition: fixedPriceModel(),
    normalizedInput: baseInput,
    fetchImpl: async () => { throw new Error("must not be called"); },
    env: SANDBOX_ENV,
  });
  assert.equal(quote.catalogCrossChecked, true, "the fixed path must prove it verified the price");
  assert.equal(quote.catalogCostUsd, 0.4);
});

maybeTest("FAIL CLOSED: a dynamically priced model can never be flat-billed", async () => {
  // The highest-severity pricing bug: declaring a dynamic model as fixed means
  // Doolphin bills a constant for a model MuAPI varies per request, with no
  // provider call to correct it. veo3.1-fast-image-to-video is dynamic in the
  // catalog, so forcing it down the fixed path must be refused.
  const model = dynamicModel();
  model.providerSpec.dynamicPricing = false;

  const quote = await estimateAuthoritativeModelCost({
    modelDefinition: model,
    normalizedInput: baseInput,
    fetchImpl: async () => { throw new Error("must not be called"); },
    env: SANDBOX_ENV,
  });
  assert.equal(quote.priced, false, "flat-billing a dynamic model must be refused");
  assert.match(quote.reason, /dynamic_pricing=true/);
  assert.match(quote.reason, /Refusing to flat-bill a dynamically priced model/);
});

maybeTest("FAIL CLOSED: a hand-typed fixed cost that disagrees with MuAPI is refused", async () => {
  // The transcription-error class: someone types $0.35 for a model MuAPI prices
  // at exactly $0.40, and we silently absorb $0.05 on every single generation.
  const model = fixedPriceModel();
  model.providerSpec.cost = { amount: 0.35, currency: "USD" };

  const quote = await estimateAuthoritativeModelCost({
    modelDefinition: model,
    normalizedInput: baseInput,
    fetchImpl: async () => { throw new Error("must not be called"); },
    env: SANDBOX_ENV,
  });
  assert.equal(quote.priced, false);
  assert.match(quote.reason, /catalog states the exact fixed price is \$0\.4000/);
});

maybeTest("FAIL CLOSED: a leftover per-unit rate marker is refused, never multiplied", async () => {
  // MuAPI publishes no per-second rates, so such a marker can only be a
  // mis-authored leftover. Honouring it would multiply an already-total price;
  // ignoring it would risk billing a per-unit rate as a total. Refuse both.
  const model = fixedPriceModel();
  model.providerSpec.cost = { amount: 0.4, currency: "USD", strategy: "per_second" };

  const quote = await estimateAuthoritativeModelCost({
    modelDefinition: model,
    normalizedInput: baseInput,
    fetchImpl: async () => { throw new Error("must not be called"); },
    env: SANDBOX_ENV,
  });
  assert.equal(quote.priced, false);
  assert.match(quote.reason, /duration-scaling billing basis/);
});
