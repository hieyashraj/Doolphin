import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("root package remains CommonJS while explicit ESM boundaries preserve scripts and tests", async () => {
  const root = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
  const scripts = JSON.parse(await readFile(new URL("../scripts/package.json", import.meta.url), "utf8"));
  const tests = JSON.parse(await readFile(new URL("./package.json", import.meta.url), "utf8"));

  assert.equal(root.type, undefined);
  assert.equal(scripts.type, "module");
  assert.equal(tests.type, "module");
});
