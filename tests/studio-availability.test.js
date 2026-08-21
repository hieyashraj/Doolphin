import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { IMAGE_MODELS, listImageModels, getImageModel } from "../src/lib/generation-models/imageRegistry.js";
import { canGenerate, deploymentState } from "../src/lib/generation-models/types.js";
import { calculateImageQuote } from "../src/lib/generation-models/imagePricing.js";

const read = (p) => fs.readFileSync(new URL(`../${p}`, import.meta.url), "utf8");

// The live deployment's environment shape: Vercel sets VERCEL_ENV=production and
// there is no DOOLPHIN_ENV. This is the exact env in which every image model was
// unavailable and the Image Studio dropdown rendered "No model available".
const LIVE_PRODUCTION = { VERCEL_ENV: "production" };

test("image studio: models are AVAILABLE on the live production deployment", () => {
  const available = listImageModels(LIVE_PRODUCTION).filter((m) => m.available);
  assert.ok(
    available.length >= 11,
    `expected >=11 selectable image models in production, got ${available.length} — the model picker would show "No model available"`
  );
});

test("image studio: every selectable model can actually be priced (no dead Generate button)", () => {
  // A model that cannot be quoted would render a permanently disabled Generate
  // button, which is indistinguishable from a broken app. Offering it is a bug.
  for (const listed of listImageModels(LIVE_PRODUCTION).filter((m) => m.available)) {
    const model = getImageModel(listed.id);
    const caps = model.productCapabilities;
    const request = {
      aspectRatio: caps.aspectRatio?.values?.[0] || "1:1",
      outputResolution: caps.outputResolution?.values?.[0],
      requestedOutputCount: caps.requestedOutputCount?.values?.[0] || 1,
    };
    // Supply an authoritative provider cost, exactly as the live preflight does
    // via MuAPI estimate-cost, so this asserts the pricing path not the network.
    const quote = calculateImageQuote(model, request, 50_000n);
    assert.equal(quote.priced, true, `${listed.id} must be priceable, got ${quote.code}`);
    assert.ok(quote.totalCredits > 0, `${listed.id} must quote a positive credit cost`);
  }
});

test("image studio: unpriced models stay hidden rather than showing a dead option", () => {
  const hidden = listImageModels(LIVE_PRODUCTION).filter((m) => !m.available).map((m) => m.id);
  assert.ok(hidden.includes("muapi.seedream-5-pro-t2i"), "seedream-5-pro has no verified pricing basis and must stay hidden");
  assert.ok(hidden.includes("muapi.grok-imagine-image-2"), "grok-imagine-image-2 has no verified pricing basis and must stay hidden");
});

test("image studio: selectable models expose the controls the composer renders", () => {
  // Aspect ratio / resolution / reference / batch controls are driven entirely by
  // productCapabilities. If these are empty the composer shows no options at all.
  const available = listImageModels(LIVE_PRODUCTION).filter((m) => m.available);
  const withAspect = available.filter((m) => (m.productCapabilities.aspectRatio?.values?.length || 0) > 0);
  const withReferences = available.filter((m) => (m.productCapabilities.referenceImages?.max || 0) > 0);
  const withBatch = available.filter((m) => (m.productCapabilities.requestedOutputCount?.values?.length || 0) > 1);

  assert.ok(withAspect.length >= 9, `expected most models to offer aspect ratios, got ${withAspect.length}`);
  assert.ok(withReferences.length >= 1, "at least one image-to-image model must accept reference images");
  assert.ok(withBatch.length >= 1, "at least one model must offer a batch size greater than 1");
});

test("deployment gating: enablement stays explicit per model, never environment-wide", () => {
  // Guard against 'fixing' availability by making canGenerate always true.
  const unknown = { id: "x", deployments: { staging: "DISABLED_PENDING_STAGING_POC", production: "DISABLED" } };
  assert.equal(canGenerate(unknown, LIVE_PRODUCTION), false, "a DISABLED model must never be generatable");
  assert.equal(deploymentState(unknown, LIVE_PRODUCTION), "DISABLED");
  for (const model of IMAGE_MODELS) {
    assert.ok(["ENABLED", "DISABLED"].includes(model.deployments.production), `${model.id} has an invalid production state`);
  }
});

// --- Resilience: the app must never render a dead framework error screen ------

test("resilience: error boundaries exist for the app, the root, and 404", () => {
  // The product previously had NO error boundary, so one component fault replaced
  // the whole app with the framework's bare "This page couldn't load" screen.
  for (const file of ["src/app/(app)/error.js", "src/app/global-error.js", "src/app/not-found.js"]) {
    assert.ok(read(file).length > 0, `${file} must exist`);
  }
  const appError = read("src/app/(app)/error.js");
  assert.match(appError, /"use client"/, "an error boundary must be a client component");
  assert.match(appError, /reset\(\)/, "must offer a retry that re-renders");
  assert.match(appError, /digest/, "must surface the digest so the real fault is traceable");

  const globalError = read("src/app/global-error.js");
  assert.match(globalError, /<html/, "global-error must render its own html/body");
});

// --- Copy hygiene ------------------------------------------------------------

test("copy: decorative eyebrow/tail labels are removed from the product chrome", () => {
  const banned = [
    ["src/components/Navbar.js", /AI UGC Studio/],
    ["src/components/AppShell.js", /Doolphin Studio/],
    ["src/app/(app)/app/page.js", /CREATION MODES|Featured Studio Modes/],
    ["src/components/image-studio/ImageStudio.js", /IMAGE STUDIO/],
    ["src/components/image-studio/ExploreGallery.js", /CURATED/],
  ];
  for (const [file, pattern] of banned) {
    assert.doesNotMatch(read(file), pattern, `${file} still contains a decorative tail label`);
  }
});

test("copy: internal vendor and database detail is not shown to users", () => {
  const navbar = read("src/components/Navbar.js");
  assert.doesNotMatch(navbar, /protected by Supabase authentication/, "must not describe our auth vendor to users");
  assert.doesNotMatch(navbar, /encrypted database policies/, "must not describe internal DB policy to users");
});

test("copy: raw pixel dimensions are not shown on explore reference images", () => {
  const gallery = read("src/components/image-studio/ExploreGallery.js");
  assert.doesNotMatch(gallery, /\{item\.width\} × \{item\.height\}/, "raw dimensions are meaningless to a user picking a reference");
});

test("ui: the selected asset filter stays readable (not a solid black block)", () => {
  const assets = read("src/components/MyAssetsView.js");
  assert.doesNotMatch(assets, /bg-\[#111111\] text-white border-\[#111111\]/, "selected filter must not be solid ink on white text");
  assert.match(assets, /bg-\[#E6D9FF\] text-\[#111111\]/, "selected filter should use the brand lavender with ink text");
});
