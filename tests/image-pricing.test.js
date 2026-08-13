import test from "node:test";
import assert from "node:assert/strict";
import { getImageModel } from "../src/lib/generation-models/imageRegistry.js";
import { calculateImageQuote } from "../src/lib/generation-models/imagePricing.js";

test("image quotes include the approved one-cent delivery reserve and round upward to five credits", () => {
  const model = getImageModel("muapi.nano-banana-2-lite-t2i");
  const quote = calculateImageQuote(model, { aspectRatio: "1:1" });
  assert.equal(quote.estimatedProviderCostMicroUsd, "30000");
  assert.equal(quote.internalCostReserveMicroUsd, "10000");
  assert.equal(quote.fullyLoadedCostMicroUsd, "40000");
  assert.equal(quote.totalCredits, 5);
});

test("Nano Banana Pro 4K is conservatively quoted at ten credits", () => {
  const quote = calculateImageQuote(getImageModel("muapi.nano-banana-pro-t2i"), { outputResolution: "4K" });
  assert.equal(quote.estimatedProviderCostMicroUsd, "180000");
  assert.equal(quote.totalCredits, 10);
});

test("Seedream v4 keeps one atomic charge while delivery reserve tracks requested outputs", () => {
  const model = getImageModel("muapi.seedream-v4-t2i");
  const quote = calculateImageQuote(model, { requestedOutputCount: 4 });
  assert.equal(quote.estimatedProviderCostMicroUsd, "40000");
  assert.equal(quote.internalCostReserveMicroUsd, "40000");
  assert.equal(quote.expectedOutputCount, 4);
  assert.equal(quote.totalCredits, 5);
});
