import test from "node:test";
import assert from "node:assert/strict";

import {
  CATALOGUE_REVISION,
  getCatalogueModel,
  listCatalogueGroupedByFamily,
  listCatalogueModels,
  listFeaturedModels,
} from "../src/lib/models/videoModelCatalogue.js";
import { getDocumentedCeilingUsd, getModelAvailability } from "../src/lib/models/documentedCostSurface.js";

/**
 * MODEL CATALOGUE — EXECUTED PROOF
 *
 * The catalogue is what the selector renders, so its guarantees are product
 * guarantees: it must never offer a model that cannot actually be generated, and
 * the cost it advertises must be one billing cannot exceed.
 *
 * Imports only dependency-free modules, so this runs on a bare checkout.
 */

test("the catalogue covers every documented model and is revisioned", () => {
  assert.equal(listCatalogueModels().length, 71);
  assert.match(CATALOGUE_REVISION, /documented-cost-ceilings/);
});

test("a model is only selectable when an adapter actually exists for it", () => {
  // The critical guarantee. Pricing being solved does not make a model
  // dispatchable: without a request adapter the generic fallback sends only
  // `{ prompt }`, which is malformed for anything taking an image, duration or
  // resolution. Offering such a model would fail at the provider after the user
  // had chosen it and waited.
  const selectable = listCatalogueModels().filter((m) => m.selectable);

  for (const model of selectable) {
    assert.equal(model.integrated, true, `${model.providerModelId} must have an adapter`);
    assert.equal(model.comingSoon, false);
    assert.equal(model.pendingIntegration, false);
    assert.equal(
      getModelAvailability(model.providerModelId),
      "AVAILABLE",
      `${model.providerModelId} must also be priceable`,
    );
  }

  // Every selectable model must correspond to a real definition file.
  assert.deepEqual(
    selectable.map((m) => m.providerModelId),
    ["seedance-2-omni-reference-no-video-fast"],
  );
});

test("models that cannot be used are still listed, with the reason stated", () => {
  // Hiding them would make the catalogue look thin and prompt "where is Seedance
  // 2.5?"; showing them as clickable and failing is worse. They are listed,
  // disabled, and explained.
  const unusable = listCatalogueModels().filter((m) => !m.selectable);
  assert.ok(unusable.length > 0);

  for (const model of unusable) {
    const reason = model.comingSoonLabel || model.pendingIntegrationLabel;
    assert.ok(reason, `${model.providerModelId} must explain why it is unavailable`);
  }
});

test("the two kinds of pending work are distinguished", () => {
  const pending = listCatalogueModels().filter((m) => m.pendingIntegration);

  // Ours to write: the document publishes a curl example, so the request keys
  // are known.
  const ready = pending.filter((m) => m.payloadContractVerified);
  assert.ok(ready.length > 0);
  for (const model of ready) {
    assert.equal(model.pendingIntegrationLabel, "Integration in progress");
  }

  // Blocked on the provider: the schema tables give human labels, not wire keys,
  // and guessing them produces malformed requests.
  const blocked = pending.filter((m) => !m.payloadContractVerified);
  assert.ok(blocked.length > 0);
  for (const model of blocked) {
    assert.equal(model.pendingIntegrationLabel, "Awaiting provider schema");
  }

  assert.equal(ready.length + blocked.length, pending.length);
});

test("only usable models are featured", () => {
  // Featuring a model that cannot be generated with is the most damaging place to
  // put it: it is the first thing a new user tries.
  for (const model of listFeaturedModels()) {
    assert.equal(model.selectable, true, `${model.providerModelId} must not be featured`);
  }
});

test("the advertised credit cost is a ceiling billing cannot exceed", () => {
  // Shown as "up to N". If it were the DEFAULT cost, a user picking settings that
  // cost six times more would experience a bait-and-switch. Deriving it from the
  // same ceiling the billing guard uses means preflight can only quote the same
  // or less.
  for (const model of listCatalogueModels()) {
    if (model.maxCredits === null) continue;
    const ceilingUsd = getDocumentedCeilingUsd(model.providerModelId);
    if (ceilingUsd === null) continue;
    // credits x $0.005/credit must cover the documented ceiling.
    assert.ok(
      model.maxCredits * 5_000 >= Math.ceil(ceilingUsd * 1_000_000),
      `${model.providerModelId} advertises ${model.maxCredits} credits, which does not cover its $${ceilingUsd} ceiling`,
    );
  }
});

test("Seedance 2.5 carries the NEW tag and nothing else does", () => {
  for (const model of listCatalogueModels()) {
    const expected = model.providerModelId.startsWith("seedance-2.5");
    assert.equal(model.isNew, expected, `${model.providerModelId} NEW tag`);
  }
  assert.equal(listCatalogueModels().filter((m) => m.isNew).length, 20);
});

test("input-capped models advertise the cap on the row", () => {
  // The cap constrains what the user may upload, so it belongs on the row rather
  // than being discovered at submit time.
  const capped = listCatalogueModels().filter((m) => m.inputVideoCapSeconds !== null);
  assert.ok(capped.length > 0);
  for (const model of capped) {
    assert.equal(model.inputVideoCapSeconds, 15);
  }
});

test("grouping is stable and every model lands in exactly one family", () => {
  const groups = listCatalogueGroupedByFamily();
  const flat = groups.flatMap((group) => group.models);
  assert.equal(flat.length, listCatalogueModels().length);

  const ids = new Set(flat.map((m) => m.providerModelId));
  assert.equal(ids.size, flat.length, "a model appears in more than one group");

  for (const group of groups) {
    assert.ok(group.familyLabel, `family ${group.family} needs a human label`);
    // A family is flagged NEW when any member is, so the header tag matches.
    assert.equal(group.isNew, group.models.some((m) => m.isNew));
  }
});

test("badges carry a kind so the UI picks icons without parsing labels", () => {
  const VALID = new Set(["resolution", "duration", "capability"]);
  for (const model of listCatalogueModels()) {
    for (const badge of model.badges) {
      assert.ok(VALID.has(badge.kind), `${model.providerModelId} badge kind '${badge.kind}'`);
      assert.ok(badge.label, "badge needs a label");
    }
  }
});

test("resolution badges are consistently cased", () => {
  // The document writes 4k, 4K, 2K and 1K inconsistently; a badge reading
  // "720p-4k" beside one reading "4K" looks like a defect.
  for (const model of listCatalogueModels()) {
    for (const badge of model.badges.filter((b) => b.kind === "resolution")) {
      assert.ok(
        !/\d[kK]/.test(badge.label) || /\d K|\dK/.test(badge.label.replace(/k/g, "K")),
        `${model.providerModelId} badge '${badge.label}'`,
      );
      assert.ok(!badge.label.includes("4k"), `${model.providerModelId} should render 4K not 4k`);
    }
  }
});

test("a specific model resolves with the shape the selector expects", () => {
  const model = getCatalogueModel("seedance-2-omni-reference-no-video-fast");
  assert.equal(model.selectable, true);
  assert.equal(model.title, "Omni Reference Fast");
  assert.equal(model.mode, "IMAGE_TO_VIDEO");
  assert.equal(model.familyLabel, "Seedance 2");
  assert.equal(typeof model.maxCredits, "number");
  assert.ok(model.badges.some((b) => b.kind === "duration" && b.label === "4s-15s"));

  assert.equal(getCatalogueModel("not-a-model"), null);
});
