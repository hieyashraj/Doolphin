import test from "node:test";
import assert from "node:assert/strict";
import { 
  APP_NAV_DESTINATIONS, 
  normalizeAppQueryParams, 
  getActiveAppDestination 
} from "../src/lib/app/app-navigation.js";
import { calculateAuthoritativeGenerationQuote } from "../src/lib/generation/modelCostRegistry.js";
import { getGenerationModel } from "../src/lib/generation/modelRegistry.js";

test("navigation normalizer maps legacy/alias tabs and unknown query state safely to Explore", () => {
  assert.deepEqual(normalizeAppQueryParams({ tab: "images" }), { redirect: "/app/images" });
  assert.deepEqual(normalizeAppQueryParams({ tab: "product" }), { tab: "video", studio: "product" });
  assert.deepEqual(normalizeAppQueryParams({ studio: "product" }), { tab: "video", studio: "product" });
  assert.deepEqual(normalizeAppQueryParams({ tab: "app_studio" }), { tab: "video", studio: "app" });
  assert.deepEqual(normalizeAppQueryParams({ tab: "app" }), { tab: "video", studio: "app" });
  assert.deepEqual(normalizeAppQueryParams({ tab: "assets" }), { tab: "assets" });
  assert.deepEqual(normalizeAppQueryParams({ tab: "library" }), { tab: "library" });
  assert.deepEqual(normalizeAppQueryParams({ tab: "avatars" }), { tab: "avatars" });
  assert.deepEqual(normalizeAppQueryParams({ tab: "explore" }), { tab: "explore" });
  assert.deepEqual(normalizeAppQueryParams({ tab: "invalid_random_tab" }), { tab: "explore" });
  assert.deepEqual(normalizeAppQueryParams({ tab: null }), { tab: "explore" });
});

test("all launch destinations exist in APP_NAV_DESTINATIONS", () => {
  const ids = APP_NAV_DESTINATIONS.map((d) => d.id);
  const expected = ["explore", "video", "product", "app_studio", "images", "avatars", "assets", "library"];
  for (const id of expected) {
    assert.equal(ids.includes(id), true, `Destination '${id}' missing from APP_NAV_DESTINATIONS`);
  }
});

test("active destination resolves correctly for My Assets and normalized query states", () => {
  assert.equal(getActiveAppDestination({ pathname: "/app", tab: "assets" }), "assets");
  assert.equal(getActiveAppDestination({ pathname: "/app", tab: "product" }), "product");
  assert.equal(getActiveAppDestination({ pathname: "/app", tab: "app_studio" }), "app_studio");
  assert.equal(getActiveAppDestination({ pathname: "/app", tab: "unknown_tab" }), "explore");
});

test("authoritative video generation quote calculates valid credit cost floor and ceiling rounding", () => {
  const model = getGenerationModel("muapi.seedance2.omni-reference-fast");
  const quote = calculateAuthoritativeGenerationQuote({ settings: { durationSeconds: 5, outputCount: 1 }, assets: [] }, model);
  assert.equal(quote.priced, true);
  assert.equal(quote.totalCredits % 5, 0);
  assert.equal(quote.totalCredits >= 5, true);
});
