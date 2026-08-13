// This is internal durable generation-engine metadata. It is intentionally
// not derived from a client request, quote, provider payload, or callback.
export const HARDENED_RECONCILIATION_ENGINE_REVISION = "generation-recovery.v1";

export function isReconciliationEligibleVariant(variant) {
  return variant?.reconciliationEngineRevision === HARDENED_RECONCILIATION_ENGINE_REVISION;
}

export function reconciliationEligibleVariantWhere() {
  return { reconciliationEngineRevision: HARDENED_RECONCILIATION_ENGINE_REVISION };
}
