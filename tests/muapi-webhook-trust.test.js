import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { muapiCostMicroUsd } from "../src/lib/generation/muapiResult.js";

test("MuAPI callback bodies are notifications and final status is fetched with server credentials", () => {
  const route = fs.readFileSync(new URL("../src/app/api/webhooks/muapi/route.js", import.meta.url), "utf8");
  assert.match(route, /fetchAuthenticatedMuapiResult\(providerRequestId\)/);
  assert.match(route, /providerPayload\.status/);
  assert.match(route, /signatureStatus: "UNVERIFIED"/);
  assert.doesNotMatch(route, /const providerStatus = String\(payload\.status/);
});

test("recorded actual MuAPI cost is converted to integer micro-USD without repricing a customer", () => {
  assert.equal(muapiCostMicroUsd({ cost: { amount_usd: "3.75" } }), 3_750_000n);
  assert.equal(muapiCostMicroUsd({ cost: { amount_usd: -1 } }), null);
  assert.equal(muapiCostMicroUsd({}), null);
});
