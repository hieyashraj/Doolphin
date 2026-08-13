// MuAPI webhooks are treated only as delivery notifications.  The documented
// result API is the authority for terminal status, result URLs, and actual
// cost because a callback body alone has no documented provider signature.
export async function fetchAuthenticatedMuapiResult(providerRequestId, fetchImpl = fetch) {
  const apiKey = process.env.MUAPI_API_KEY;
  if (!apiKey || apiKey.includes("placeholder")) {
    const error = new Error("MuAPI result authentication is not configured");
    error.code = "MUAPI_RESULT_AUTH_UNAVAILABLE";
    throw error;
  }
  const response = await fetchImpl(`https://api.muapi.ai/api/v1/predictions/${encodeURIComponent(providerRequestId)}/result`, {
    headers: { "x-api-key": apiKey },
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) {
    const error = new Error(`MuAPI result lookup failed (${response.status})`);
    error.code = "MUAPI_RESULT_LOOKUP_FAILED";
    throw error;
  }
  const result = await response.json();
  const returnedId = result.request_id || result.id;
  if (returnedId && returnedId !== providerRequestId) {
    const error = new Error("MuAPI result response request id did not match the provider job");
    error.code = "MUAPI_RESULT_ID_MISMATCH";
    throw error;
  }
  return result;
}

export function muapiCostMicroUsd(payload) {
  const amount = payload?.cost?.amount_usd;
  if (typeof amount !== "number" && typeof amount !== "string") return null;
  const parsed = Number(amount);
  if (!Number.isFinite(parsed) || parsed < 0) return null;
  return BigInt(Math.round(parsed * 1_000_000));
}
