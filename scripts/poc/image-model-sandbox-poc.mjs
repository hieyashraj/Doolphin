#!/usr/bin/env node
/**
 * Sandbox-only provider-contract harness. It intentionally consumes the
 * disabled registry and real adapters, but never changes a model deployment
 * state, R2, credits, or application records.
 *
 * Run explicitly with --sandbox-confirmed. The harness refuses a key that is
 * not also configured as MUAPI_API_KEY_SANDBOX and stops at any positive cost
 * or missing sandbox/mock indication.
 */
import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { createRequire } from "node:module";
import { IMAGE_MODELS } from "../../src/lib/generation-models/imageRegistry.js";
import { calculateRequiredCredits, PRICING_REVISION } from "../../src/lib/entitlements/pricing.js";

const require = createRequire(import.meta.url);
const { loadEnvConfig } = require("@next/env");
loadEnvConfig(process.cwd());

const API_BASE = "https://api.muapi.ai/api/v1";
const REFERENCE_URL = "https://example.com/doolphin-sandbox-reference.png";
const POLL_DELAY_MS = 750;
const POLL_LIMIT = 8;

class PocFailure extends Error {
  constructor(classification, message, evidence = null) {
    super(message);
    this.classification = classification;
    this.evidence = evidence;
  }
}

function assertSandboxCredential(argv) {
  if (!argv.includes("--sandbox-confirmed")) throw new Error("Refusing provider POC without --sandbox-confirmed");
  const canonical = process.env.MUAPI_API_KEY;
  const sandbox = process.env.MUAPI_API_KEY_SANDBOX;
  if (!canonical || !sandbox || canonical !== sandbox) throw new Error("MUAPI_API_KEY must exactly match MUAPI_API_KEY_SANDBOX for a sandbox POC");
  return canonical;
}

function minimalRequest(model) {
  const caps = model.productCapabilities;
  return {
    version: "image-generation.v1",
    modelId: model.id,
    prompt: "Doolphin sandbox contract test: a single blue square on a white background.",
    referenceAssetIds: Array.from({ length: caps.referenceImages.min }, (_, index) => `sandbox_reference_${index + 1}`),
    ...(caps.aspectRatio.visible ? { aspectRatio: caps.aspectRatio.values[0] } : {}),
    ...(caps.outputResolution.visible ? { outputResolution: caps.outputResolution.values[0] } : {}),
    ...(caps.requestedOutputCount.visible ? { requestedOutputCount: caps.requestedOutputCount.values[0] } : {}),
  };
}

function endpointName(endpoint) {
  return endpoint?.replace(/^\/api\/v1\//, "") || null;
}

function providerEndpointUrl(endpoint) {
  return `${API_BASE}/${endpointName(endpoint)}`;
}

function headers(key) { return { "x-api-key": key, "content-type": "application/json" }; }

function headerCost(response) {
  const amount = response.headers.get("x-muapi-cost-usd");
  return amount === null ? null : Number(amount);
}

function costNumber(payload, response) {
  const direct = Number(payload?.cost);
  if (Number.isFinite(direct)) return direct;
  const body = Number(payload?.cost?.amount_usd);
  return Number.isFinite(body) ? body : headerCost(response);
}

function sandboxSignal(payload, response) {
  const serialized = JSON.stringify(payload || {}).toLowerCase();
  const cost = costNumber(payload, response);
  // MuAPI's documented Sandbox/Test keys return mock outputs without spending.
  // The approved evidence rule accepts that verified-key + zero-cost contract
  // even when the response has no separate sandbox header or field.
  return payload?.sandbox === true || payload?.mock === true || response.headers.get("x-muapi-sandbox") === "true" || /sandbox|mock/.test(serialized) || cost === 0;
}

function sanitizePayload(payload) {
  return {
    fields: Object.keys(payload || {}).sort(),
    fixedDefaults: Object.fromEntries(Object.entries(payload || {}).filter(([key]) => !["prompt", "images_list", "webhook_url"].includes(key))),
    referenceCount: Array.isArray(payload?.images_list) ? payload.images_list.length : 0,
  };
}

function sanitizeResponse(payload, response) {
  return {
    status: response.status,
    fields: Object.keys(payload || {}).sort(),
    cost: payload?.cost || null,
    sandboxSignal: sandboxSignal(payload, response),
    headerCostUsd: headerCost(response),
  };
}

async function request(key, url, options = {}) {
  const response = await fetch(url, { ...options, headers: { ...headers(key), ...(options.headers || {}) }, signal: AbortSignal.timeout(20_000) });
  const payload = await response.json().catch(() => ({}));
  return { response, payload };
}

async function resolveEndpoint(model, key) {
  const candidates = model.endpoint ? [model.endpoint] : model.endpointCandidates || [];
  for (const candidate of candidates) {
    const name = endpointName(candidate);
    const { response, payload } = await request(key, `${API_BASE}/models/${encodeURIComponent(name)}`);
    if (response.ok) return { endpoint: candidate, modelName: payload?.name || name, metadata: sanitizeResponse(payload, response) };
  }
  throw new Error(`No canonical endpoint metadata accepted for ${model.id}`);
}

function economics(providerUsd) {
  if (!(typeof providerUsd === "number") || providerUsd < 0) return { status: "ECONOMICS_PENDING", reason: "No exact provider estimate supplied" };
  const providerMicroUsd = BigInt(Math.ceil(providerUsd * 1_000_000));
  const quote = calculateRequiredCredits({ providerGeneration: providerMicroUsd });
  const conservativeNet = quote.quotedCredits * PRICING_REVISION.netRevenuePerCreditFloorMicroUsd;
  return {
    status: "ECONOMICS_PENDING",
    providerEstimateMicroUsd: providerMicroUsd.toString(),
    directlyAttributableInternalCosts: "UNMEASURED",
    fullyLoadedCost: "UNRESOLVED",
    preliminaryCredits: quote.quotedCredits.toString(),
    conservativeNetCreditValueMicroUsd: conservativeNet.toString(),
    contributionMargin: "UNRESOLVED_PENDING_INTERNAL_COSTS",
  };
}

async function runModel(model, key) {
  const requestInput = minimalRequest(model);
  const validation = model.adapter.validateNormalizedRequest(model, requestInput);
  if (!validation.valid) throw new Error(`${model.id}: ${validation.errors[0]?.code || "invalid normalized request"}`);
  const referenceUrls = requestInput.referenceAssetIds.map(() => REFERENCE_URL);
  const endpoint = await resolveEndpoint(model, key);
  const providerPayload = model.adapter.buildProviderPayload(model, { request: requestInput, referenceUrls });
  const estimateName = model.estimateCostModelId || endpoint.modelName;
  const estimate = await request(key, `${API_BASE}/models/${encodeURIComponent(estimateName)}/estimate-cost`, { method: "POST", body: JSON.stringify(model.adapter.buildEstimatePayload(model, { request: requestInput, referenceUrls })) });
  const estimateEvidence = sanitizeResponse(estimate.payload, estimate.response);
  const estimatedUsd = costNumber(estimate.payload, estimate.response);
  if (!estimate.response.ok) throw new PocFailure("POC_FAIL_PROVIDER_CONTRACT", `${model.id}: estimate rejected (${estimate.response.status})`, { estimate: estimateEvidence });
  if (estimatedUsd !== null && estimatedUsd > 0) throw new PocFailure("POC_BLOCKED_SANDBOX", `${model.id}: positive estimate cost indicates non-sandbox/billable execution`, { estimate: estimateEvidence });

  const submit = await request(key, providerEndpointUrl(endpoint.endpoint), { method: "POST", body: JSON.stringify(providerPayload) });
  const submitEvidence = sanitizeResponse(submit.payload, submit.response);
  const submitUsd = costNumber(submit.payload, submit.response);
  if (!submit.response.ok) throw new PocFailure("POC_FAIL_PROVIDER_CONTRACT", `${model.id}: submit rejected (${submit.response.status})`, { endpoint: endpoint.endpoint, submit: submitEvidence });
  if (submitUsd !== null && submitUsd > 0) throw new PocFailure("POC_BLOCKED_SANDBOX", `${model.id}: positive submit cost indicates non-sandbox/billable execution`, { endpoint: endpoint.endpoint, submit: submitEvidence });
  if (!sandboxSignal(submit.payload, submit.response)) throw new PocFailure("POC_BLOCKED_SANDBOX", `${model.id}: submit has no explicit sandbox/mock indicator`, { endpoint: endpoint.endpoint, submit: submitEvidence });
  const parsedSubmission = model.adapter.parseSubmission(submit.payload);

  let result = null;
  let resultEvidence = null;
  let parsedResult = null;
  for (let attempt = 0; attempt < POLL_LIMIT; attempt += 1) {
    const poll = await request(key, `${API_BASE}/predictions/${encodeURIComponent(parsedSubmission.providerRequestId)}/result`);
    if (!poll.response.ok) throw new PocFailure("POC_FAIL_PROVIDER_CONTRACT", `${model.id}: result poll rejected (${poll.response.status})`, { endpoint: endpoint.endpoint, result: sanitizeResponse(poll.payload, poll.response) });
    const pollUsd = costNumber(poll.payload, poll.response);
    if (pollUsd !== null && pollUsd > 0) throw new PocFailure("POC_BLOCKED_SANDBOX", `${model.id}: positive result cost indicates non-sandbox/billable execution`, { endpoint: endpoint.endpoint, result: sanitizeResponse(poll.payload, poll.response) });
    if (!sandboxSignal(poll.payload, poll.response)) throw new PocFailure("POC_BLOCKED_SANDBOX", `${model.id}: result has no explicit sandbox/mock indicator`, { endpoint: endpoint.endpoint, result: sanitizeResponse(poll.payload, poll.response) });
    parsedResult = model.adapter.parseAuthenticatedResult(poll.payload);
    resultEvidence = sanitizeResponse(poll.payload, poll.response);
    result = poll.payload;
    if (parsedResult.terminal) break;
    await new Promise((resolve) => setTimeout(resolve, POLL_DELAY_MS));
  }
  if (!parsedResult?.terminal) throw new PocFailure("POC_BLOCKED_SANDBOX", `${model.id}: sandbox result did not reach terminal state`, { endpoint: endpoint.endpoint, result: resultEvidence });
  const actualUsd = typeof parsedResult.actualCost === "number" ? parsedResult.actualCost : Number(parsedResult.actualCost);
  return {
    classification: "POC_PASS_ECONOMICS_PENDING",
    modelId: model.id,
    displayName: model.displayName,
    endpoint: endpoint.endpoint,
    estimateModelId: estimateName,
    normalizedRequest: { ...requestInput, prompt: "[REDACTED]" },
    acceptedPayload: sanitizePayload(providerPayload),
    metadata: endpoint.metadata,
    estimate: estimateEvidence,
    submit: submitEvidence,
    result: { ...resultEvidence, parsed: { terminal: parsedResult.terminal, succeeded: parsedResult.succeeded, outputCount: parsedResult.outputUrls?.length || 0, outputHosts: parsedResult.outputUrls?.map((url) => new URL(url).host) || [], actualCost: parsedResult.actualCost ?? null } },
    estimatedProviderCostUsd: estimatedUsd,
    actualProviderCostUsd: Number.isFinite(actualUsd) ? actualUsd : null,
    estimateActualVarianceUsd: Number.isFinite(actualUsd) && estimatedUsd !== null ? actualUsd - estimatedUsd : null,
    economics: economics(estimatedUsd),
  };
}

const key = assertSandboxCredential(process.argv.slice(2));
const requestedModelId = process.argv.includes("--model") ? process.argv[process.argv.indexOf("--model") + 1] : null;
const models = requestedModelId ? IMAGE_MODELS.filter((model) => model.id === requestedModelId) : IMAGE_MODELS;
if (requestedModelId && models.length !== 1) throw new Error(`Unknown image registry model '${requestedModelId}'`);
const evidence = { checkedAt: new Date().toISOString(), mode: "SANDBOX_MOCK", models: [] };
for (const model of models) {
  try { evidence.models.push(await runModel(model, key)); }
  catch (error) {
    const classification = error instanceof PocFailure ? error.classification : "POC_FAIL_PROVIDER_CONTRACT";
    evidence.models.push({ modelId: model.id, displayName: model.displayName, classification, error: error.message, ...(error.evidence || {}) });
    if (classification === "POC_BLOCKED_SANDBOX") {
      await fs.writeFile(path.join("/private/tmp", "doolphin-image-poc-evidence.json"), JSON.stringify(evidence, null, 2));
      throw error;
    }
  }
}
await fs.writeFile(path.join("/private/tmp", "doolphin-image-poc-evidence.json"), JSON.stringify(evidence, null, 2));
console.log(JSON.stringify({ evidencePath: "/private/tmp/doolphin-image-poc-evidence.json", models: evidence.models.map(({ modelId, classification }) => ({ modelId, classification })) }, null, 2));
