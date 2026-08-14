import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const preflightSource = fs.readFileSync(new URL("../src/app/api/images/preflight/route.js", import.meta.url), "utf8");
const generationsSource = fs.readFileSync(new URL("../src/app/api/images/generations/route.js", import.meta.url), "utf8");

test("preflight route does not import or call R2 Storage signing or resolveCuratedSignedUrls", () => {
  assert.doesNotMatch(preflightSource, /resolveCuratedSignedUrls/);
  assert.doesNotMatch(preflightSource, /generateSignedUrl/);
  assert.doesNotMatch(preflightSource, /R2StorageService/);
  assert.match(preflightSource, /validateExploreImageIds/);
});

test("generations submission route invokes resolveCuratedSignedUrls and generateSignedUrl JIT at provider submission boundary", () => {
  assert.match(generationsSource, /resolveCuratedSignedUrls/);
  assert.match(generationsSource, /R2StorageService\.generateSignedUrl/);
  assert.match(generationsSource, /CreditEscrowService\.reserveCredits/);
});
