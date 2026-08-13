import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const source = fs.readFileSync(new URL("../scripts/poc/image-model-sandbox-poc.mjs", import.meta.url), "utf8");

test("image POC harness is registry-driven and sandbox fail-closed", () => {
  assert.match(source, /IMAGE_MODELS/);
  assert.match(source, /MUAPI_API_KEY must exactly match MUAPI_API_KEY_SANDBOX/);
  assert.match(source, /--sandbox-confirmed/);
  assert.match(source, /positive submit cost indicates non-sandbox\/billable execution/);
  assert.match(source, /sandbox\/mock indicator/);
  assert.match(source, /cost === 0/);
  assert.match(source, /POC_FAIL_PROVIDER_CONTRACT/);
  assert.match(source, /classification === "POC_BLOCKED_SANDBOX"/);
  assert.match(source, /model\.adapter\.buildProviderPayload/);
  assert.match(source, /model\.adapter\.parseAuthenticatedResult/);
  assert.match(source, /providerEndpointUrl\(endpoint\.endpoint\)/);
  assert.match(source, /const direct = Number\(payload\?\.cost\)/);
  assert.match(source, /--model/);
  assert.doesNotMatch(source, /R2StorageService|prisma\.|CreditEscrowService/);
});
