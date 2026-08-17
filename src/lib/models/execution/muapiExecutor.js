import { getMuapiApiKey } from "../../generation/muapiCredentials.js";
import { buildMuapiWebhookUrl } from "../../generation/webhookSecurity.js";
import { ModelPlatformError, ERROR_CODES } from "../errors.js";

const STRICT_TRUSTED_MUAPI_ORIGIN = "https://api.muapi.ai";

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
  if (!preparedPlan || !preparedPlan.providerPayload || !preparedPlan.providerEndpoint) {
    throw new ModelPlatformError(
      ERROR_CODES.INVALID_PREPARED_PLAN,
      "Execution plan is invalid or missing provider payload/endpoint"
    );
  }

  // 1. Endpoint Security Validation & Origin Binding
  const targetUrl = resolveTrustedExecutionUrl(preparedPlan.providerEndpoint);

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

  // 3. Dynamically Rebuild Webhook Callback URL via Server Boundary (Secret-Free Transport)
  const webhookBase = env.DOOLPHIN_WEBHOOK_URL || env.NEXT_PUBLIC_APP_URL || "https://api.doolphin.com";
  let webhookUrl;
  try {
    webhookUrl = buildMuapiWebhookUrl(webhookBase);
  } catch {
    webhookUrl = `${webhookBase}/api/webhooks/muapi`;
  }

  // 4. Construct Submission Body: Merge pure model payload body with dynamic transport callback
  const submissionBody = {
    ...preparedPlan.providerPayload,
    webhook_url: webhookUrl,
  };

  // 5. Dispatch Submission
  try {
    const response = await fetchImpl(targetUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(submissionBody),
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
