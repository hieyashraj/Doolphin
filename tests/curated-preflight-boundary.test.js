import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const preflightSource = fs.readFileSync(new URL("../src/app/api/images/preflight/route.js", import.meta.url), "utf8");
const generationsSource = fs.readFileSync(new URL("../src/app/api/images/generations/route.js", import.meta.url), "utf8");

test("preflight resolves owned and curated references for authoritative estimate payloads", () => {
  assert.match(preflightSource, /resolveCuratedSignedUrls\(exploreReqIds\)/);
  assert.match(preflightSource, /R2StorageService\.generateSignedUrl/);
  assert.match(preflightSource, /R2StorageService\.isConfigured\(\)/);
  assert.match(preflightSource, /hasOnlySignedHttpsUrls\(\[\.\.\.referenceUrls, \.\.\.exploreSignedUrls\]\)/);
  assert.match(preflightSource, /buildEstimatePayload\(model,\s*\{[\s\S]*referenceUrls,[\s\S]*exploreUrls:\s*exploreSignedUrls/);
});

test("preflight snapshots only a fingerprint of redacted signed reference URLs", () => {
  assert.match(preflightSource, /payloadFingerprint\(redactSignedUrls\(estimatePayload\)\)/);
  assert.match(preflightSource, /\[SIGNED_REFERENCE\]/);
  assert.doesNotMatch(preflightSource, /requestSnapshot:\s*JSON\.stringify\(estimatePayload\)/);
  assert.doesNotMatch(preflightSource, /routingSnapshot:\s*JSON\.stringify\(estimatePayload\)/);
});

test("generations submission route signs both reference classes at provider submission", () => {
  assert.match(generationsSource, /resolveCuratedSignedUrls\(exploreReqIds\)/);
  assert.match(generationsSource, /R2StorageService\.generateSignedUrl/);
  assert.match(generationsSource, /R2StorageService\.isConfigured\(\)/);
  assert.match(generationsSource, /IMAGE_REFERENCE_SIGNING_FAILED/);
  assert.match(generationsSource, /CreditEscrowService\.reserveCredits/);
});
