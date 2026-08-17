import { getMuapiApiKey } from "../../generation/muapiCredentials.js";
import { buildMuapiWebhookUrl } from "../../generation/webhookSecurity.js";
import { ModelPlatformError, ERROR_CODES } from "../errors.js";

const STRICT_TRUSTED_MUAPI_ORIGIN = "https://api.muapi.ai";

/**
 * Strict Decimal-String MicroUSD Financial Parser (Phase 4D.2).
 * Converts USD amounts to BigInt microUSD using pure string decimal arithmetic without floating-point calculations.
 * Enforces conservative ceiling rounding (+1 microUSD) for fractional values beyond 6 decimal places.
 * Fails closed on invalid or negative inputs.
 */
export function parseUsdToMicroUsdConservatively(val) {
  if (val === null || val === undefined) {
    throw new ModelPlatformError(ERROR_CODES.INVALID_PREPARED_PLAN, "USD value is required for microUSD conversion");
  }

  if (typeof val === "bigint") {
    if (val < 0n) throw new ModelPlatformError(ERROR_CODES.INVALID_PREPARED_PLAN, "Negative USD value is invalid");
    return val;
  }

  if (typeof val === "object") {
    val = val.amount_usd ?? val.amount ?? val.value;
    if (val === null || val === undefined) {
      throw new ModelPlatformError(ERROR_CODES.INVALID_PREPARED_PLAN, "USD value property is missing from object");
    }
  }

  const str = String(val).trim();
  if (!str || str.startsWith("-")) {
    throw new ModelPlatformError(ERROR_CODES.INVALID_PREPARED_PLAN, `Invalid or negative USD value: '${val}'`);
  }

  const parts = str.split(".");
  if (parts.length > 2) {
    throw new ModelPlatformError(ERROR_CODES.INVALID_PREPARED_PLAN, `Invalid USD decimal format: '${val}'`);
  }

  const wholeStr = parts[0] || "0";
  if (!/^\d+$/.test(wholeStr)) {
    throw new ModelPlatformError(ERROR_CODES.INVALID_PREPARED_PLAN, `Invalid whole dollar portion: '${wholeStr}'`);
  }

  const wholeMicroUsd = BigInt(wholeStr) * 1_000_000n;

  if (parts.length === 1 || !parts[1]) {
    return wholeMicroUsd;
  }

  const fracStr = parts[1];
  if (!/^\d+$/.test(fracStr)) {
    throw new ModelPlatformError(ERROR_CODES.INVALID_PREPARED_PLAN, `Invalid fractional dollar portion: '${fracStr}'`);
  }

  const first6 = fracStr.slice(0, 6).padEnd(6, "0");
  const fracMicroUsd = BigInt(first6);

  const remainder = fracStr.slice(6);
  const hasRemainderNonZero = Boolean(remainder && /[1-9]/.test(remainder));

  return wholeMicroUsd + fracMicroUsd + (hasRemainderNonZero ? 1n : 0n);
}

export function validateProviderEndpointOrigin(endpointInput) {
  if (!endpointInput || typeof endpointInput !== "string") return false;

  if (endpointInput.startsWith("//") || endpointInput.includes("..")) return false;

  let fullUrl = endpointInput;
  if (endpointInput.startsWith("/")) {
    fullUrl = `${STRICT_TRUSTED_MUAPI_ORIGIN}${endpointInput}`;
  }

  try {
    const parsed = new URL(fullUrl);
    if (parsed.origin !== STRICT_TRUSTED_MUAPI_ORIGIN) return false;
    if (parsed.protocol !== "https:") return false;
    if (!parsed.pathname.startsWith("/api/v1/")) return false;
    return true;
  } catch {
    return false;
  }
}

export function resolveTrustedExecutionUrl(endpointInput) {
  if (!validateProviderEndpointOrigin(endpointInput)) {
    throw new ModelPlatformError(
      ERROR_CODES.UNTRUSTED_ENDPOINT_REJECTED,
      `Endpoint '${endpointInput}' fails strict origin security checks (Must be HTTPS on https://api.muapi.ai/api/v1/...)`
    );
  }

  if (endpointInput.startsWith("/")) {
    return `${STRICT_TRUSTED_MUAPI_ORIGIN}${endpointInput}`;
  }
  return endpointInput;
}

export async function executeMuapiGenerationPlan({
  preparedPlan,
  fetchImpl = fetch,
  env = process.env,
} = {}) {
  if (!preparedPlan || !preparedPlan.providerPayloadJson || !preparedPlan.providerEndpoint) {
    throw new ModelPlatformError(
      ERROR_CODES.INVALID_PREPARED_PLAN,
      "Execution plan is invalid or missing provider payload JSON/endpoint"
    );
  }

  // 1. Endpoint Security Validation & Origin Binding
  const baseUrl = resolveTrustedExecutionUrl(preparedPlan.providerEndpoint);

  // 2. Resolve Credentials via Server Boundary
  let apiKey;
  try {
    apiKey = getMuapiApiKey(env);
  } catch (error) {
    throw new ModelPlatformError(
      ERROR_CODES.PROVIDER_AUTH_UNAVAILABLE,
      `Provider credential resolution failed: ${error.message}`
    );
  }

  // 3. Dynamically Rebuild Webhook Callback URL via Server Boundary
  const webhookBase = env.DOOLPHIN_WEBHOOK_URL || env.NEXT_PUBLIC_APP_URL || "https://api.doolphin.com";
  let webhookUrl;
  try {
    webhookUrl = buildMuapiWebhookUrl(webhookBase);
  } catch {
    webhookUrl = `${webhookBase}/api/webhooks/muapi`;
  }

  // 4. Attach Webhook URL strictly at Transport Layer via `webhook` Query Parameter
  const requestUrl = new URL(baseUrl);
  requestUrl.searchParams.set("webhook", webhookUrl);

  // 5. Dispatch Submission with EXACT Prepared providerPayloadJson as Body and x-api-key Auth Header
  try {
    const response = await fetchImpl(requestUrl.toString(), {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: preparedPlan.providerPayloadJson,
      redirect: "error",
    });

    const responseBody = await response.json().catch(() => ({}));

    if (!response.ok) {
      throw new ModelPlatformError(
        ERROR_CODES.PROVIDER_REQUEST_FAILED,
        `MU API generation endpoint returned HTTP ${response.status}: ${responseBody.error || responseBody.message || "Unknown error"}`,
        { status: response.status, body: responseBody }
      );
    }

    return {
      success: true,
      rawResponse: responseBody,
      dispatchedPlan: {
        canonicalModelId: preparedPlan.canonicalModelId,
        providerModelId: preparedPlan.providerModelId,
        providerPayloadHash: preparedPlan.providerPayloadHash,
        providerSpecHash: preparedPlan.providerSpecHash,
        quotedCredits: preparedPlan.pricing.quotedCredits,
        providerCostMicroUsd: preparedPlan.pricing.providerCostMicroUsd,
      },
    };
  } catch (error) {
    if (error instanceof ModelPlatformError) throw error;
    throw new ModelPlatformError(
      ERROR_CODES.PROVIDER_REQUEST_FAILED,
      `Network error executing MU API generation plan: ${error.message}`
    );
  }
}
