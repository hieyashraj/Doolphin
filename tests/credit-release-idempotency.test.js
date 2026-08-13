import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

test("reservation releases use a stable ledger idempotency key", () => {
  const source = fs.readFileSync(new URL("../src/lib/billing/CreditEscrowService.js", import.meta.url), "utf8");

  assert.match(source, /idempotencyKey: `tx_release_\$\{reservation\.id\}`/);
  assert.doesNotMatch(source, /idempotencyKey: `tx_release_\$\{reservation\.id\}_\$\{Date\.now\(\)\}`/);
});
