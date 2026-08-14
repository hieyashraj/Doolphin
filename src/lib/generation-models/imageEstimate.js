import { calculateImageQuote } from "./imagePricing";
import { getMuapiApiKey } from "../generation/muapiCredentials";

function toMicroUsd(value) {
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount < 0) return null;
  return BigInt(Math.round(amount * 1_000_000));
}

// Every sellable quote gets the provider's current estimate for the exact,
// fully explicit adapter payload. A malformed/missing estimate is unavailable.
export async function estimateImageQuote({ model, request, payload }) {
  let key;
  try {
    key = getMuapiApiKey();
  } catch {
    return { priced: false, code: "IMAGE_ESTIMATE_UNAVAILABLE", reason: "A sandbox provider credential is required." };
  }
  const response = await fetch(`https://api.muapi.ai/api/v1/models/${encodeURIComponent(model.estimateCostModelId)}/estimate-cost`, { method: "POST", headers: { "content-type": "application/json", "x-api-key": key }, body: JSON.stringify(payload), signal: AbortSignal.timeout(15_000) });
  const result = await response.json().catch(() => null);
  const cost = toMicroUsd(result?.cost?.amount_usd ?? result?.cost);
  if (!response.ok || cost === null) return { priced: false, code: "IMAGE_ESTIMATE_UNAVAILABLE", reason: "MuAPI did not return an authoritative estimate for this configuration." };
  return { ...calculateImageQuote(model, request, cost), estimate: { model: result.model || model.estimateCostModelId, strategy: result.cost_strategy || null, providerCostMicroUsd: cost.toString() } };
}
