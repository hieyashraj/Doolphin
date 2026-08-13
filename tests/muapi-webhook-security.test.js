import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const source = fs.readFileSync(new URL("../src/lib/generation/webhookSecurity.js", import.meta.url), "utf8");

test("MuAPI callback filtering uses its explicit Doolphin-owned secret only", () => {
  assert.match(source, /process\.env\.MUAPI_WEBHOOK_SECRET/);
  assert.doesNotMatch(source, /NEXTAUTH_SECRET/);
  assert.match(source, /not a provider signature/);
});
