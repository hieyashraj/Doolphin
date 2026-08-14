import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { getMuapiApiKey } from "../src/lib/generation/muapiCredentials.js";

test("resolves MUAPI_API_KEY_SANDBOX when DOOLPHIN_ENV=staging", () => {
  const mockEnv = {
    DOOLPHIN_ENV: "staging",
    VERCEL_ENV: "preview",
    MUAPI_API_KEY_SANDBOX: "sb_key_1234567890",
    MUAPI_API_KEY: "prod_live_key_99999"
  };
  const resolved = getMuapiApiKey(mockEnv);
  assert.equal(resolved, "sb_key_1234567890");
});

test("fails closed with SANDBOX_CREDENTIAL_UNAVAILABLE when DOOLPHIN_ENV=staging and sandbox key is missing", () => {
  const mockEnv = {
    DOOLPHIN_ENV: "staging",
    VERCEL_ENV: "preview",
    MUAPI_API_KEY_SANDBOX: "",
    MUAPI_API_KEY: "prod_live_key_99999"
  };
  assert.throws(
    () => getMuapiApiKey(mockEnv),
    (err) => err.code === "SANDBOX_CREDENTIAL_UNAVAILABLE"
  );
});

test("rejects contradictory environment signals (staging + production)", () => {
  const mockEnv = {
    DOOLPHIN_ENV: "staging",
    VERCEL_ENV: "production",
    MUAPI_API_KEY_SANDBOX: "sb_key_1234567890",
    MUAPI_API_KEY: "prod_live_key_99999"
  };
  assert.throws(
    () => getMuapiApiKey(mockEnv),
    (err) => err.code === "CONTRADICTORY_ENVIRONMENT_SIGNALS"
  );
});

test("rejects contradictory environment signals (production DOOLPHIN_ENV + preview VERCEL_ENV)", () => {
  const mockEnv = {
    DOOLPHIN_ENV: "production",
    VERCEL_ENV: "preview",
    MUAPI_API_KEY: "prod_live_key_99999"
  };
  assert.throws(
    () => getMuapiApiKey(mockEnv),
    (err) => err.code === "CONTRADICTORY_ENVIRONMENT_SIGNALS"
  );
});

test("never falls back to MUAPI_API_KEY when DOOLPHIN_ENV=staging", () => {
  const mockEnv = {
    DOOLPHIN_ENV: "staging",
    VERCEL_ENV: "preview",
    MUAPI_API_KEY: "prod_live_key_99999"
  };
  assert.throws(
    () => getMuapiApiKey(mockEnv),
    (err) => err.code === "SANDBOX_CREDENTIAL_UNAVAILABLE"
  );
});

test("resolves MUAPI_API_KEY in production environment", () => {
  const mockEnv = {
    DOOLPHIN_ENV: "production",
    VERCEL_ENV: "production",
    MUAPI_API_KEY: "prod_live_key_99999",
    MUAPI_API_KEY_SANDBOX: "sb_key_1234567890"
  };
  const resolved = getMuapiApiKey(mockEnv);
  assert.equal(resolved, "prod_live_key_99999");
});

test("fails closed in local dev when MUAPI_API_KEY_SANDBOX is unconfigured", () => {
  const mockEnv = {
    NODE_ENV: "development",
    MUAPI_API_KEY: "prod_live_key_99999"
  };
  assert.throws(
    () => getMuapiApiKey(mockEnv),
    (err) => err.code === "SANDBOX_CREDENTIAL_UNAVAILABLE"
  );
});

test("never prints or leaks credential secret strings in error messages", () => {
  const mockEnv = {
    DOOLPHIN_ENV: "staging",
    VERCEL_ENV: "preview",
    MUAPI_API_KEY: "secret_prod_value_must_not_leak"
  };
  try {
    getMuapiApiKey(mockEnv);
    assert.fail("Should have thrown");
  } catch (error) {
    assert.equal(error.message.includes("secret_prod_value_must_not_leak"), false);
  }
});

test("generation submit route, result fetcher, and estimate service use centralized getMuapiApiKey", () => {
  const genRoute = fs.readFileSync(new URL("../src/app/api/images/generations/route.js", import.meta.url), "utf8");
  const resultFetcher = fs.readFileSync(new URL("../src/lib/generation/muapiResult.js", import.meta.url), "utf8");
  const estimateService = fs.readFileSync(new URL("../src/lib/generation-models/imageEstimate.js", import.meta.url), "utf8");
  const runnerScript = fs.readFileSync(new URL("../scripts/test-sandbox-flows.mjs", import.meta.url), "utf8");

  assert.match(genRoute, /getMuapiApiKey\(\)/);
  assert.match(resultFetcher, /getMuapiApiKey\(\)/);
  assert.match(estimateService, /getMuapiApiKey\(\)/);
  assert.match(runnerScript, /DOOLPHIN_ENV === "staging"/);
  assert.match(runnerScript, /MUAPI_API_KEY_SANDBOX/);
  assert.match(runnerScript, /SANDBOX_CREDENTIAL_UNAVAILABLE/);
});
