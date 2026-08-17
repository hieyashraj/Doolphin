import { calculateAuthoritativeGenerationQuote } from "../../generation/modelCostRegistry.js";
import { ModelPlatformError, ERROR_CODES } from "../errors.js";

/**
 * Pure production helper for legacy generation quote validation (Phase 4D Closure).
 * Validates legacy generation requests against authoritative model pricing and routing snapshots.
 * Returns authoritative quote and credit details, or throws ModelPlatformError with code 'QUOTE_STALE'.
 */
export function validateLegacyGenerationQuoteForDispatch({
  quote,
  request,
  model,
  routingSnapshot,
}) {
  const authoritativeQuote = calculateAuthoritativeGenerationQuote(request, model);
  if (!authoritativeQuote || !authoritativeQuote.priced) {
    throw new ModelPlatformError(
      authoritativeQuote?.code || ERROR_CODES.PRICING_UNAVAILABLE,
      "This generation configuration is temporarily unavailable because its approved cost is not configured."
    );
  }

  let quoteCostSnapshot = null;
  try {
    quoteCostSnapshot = routingSnapshot?.quoteCostSnapshot || null;
  } catch {
    quoteCostSnapshot = null;
  }

  if (
    !quoteCostSnapshot ||
    quoteCostSnapshot.registryRevision !== authoritativeQuote.registryRevision ||
    quoteCostSnapshot.totalCredits !== authoritativeQuote.totalCredits ||
    quoteCostSnapshot.fullyLoadedCostMicroUsd !== authoritativeQuote.fullyLoadedCostMicroUsd ||
    quoteCostSnapshot.pricingRevisionId !== authoritativeQuote.pricingRevisionId ||
    quote.pricingRevision !== authoritativeQuote.pricingRevisionId ||
    quote.internalCreditsToReserve !== authoritativeQuote.totalCredits
  ) {
    throw new ModelPlatformError(
      "QUOTE_STALE",
      "This quote is no longer current. Review the generation price again before submitting."
    );
  }

  return {
    authoritativeQuote,
    totalCreditsToReserve: authoritativeQuote.totalCredits,
    registryRevisionId: model.capabilityRevision || authoritativeQuote.registryRevision,
    pricingRevisionId: model.pricingRevision || authoritativeQuote.pricingRevisionId,
  };
}
