"use client";

import { motion } from "framer-motion";

const ROLE_LABELS = {
  ACTOR_REFERENCE: "Only actor identity",
  PRIMARY_PRODUCT: "Product",
  PRODUCT_PACKAGING: "Product view",
  PRODUCT_USAGE_REFERENCE: "Product usage reference",
  APP_PRIMARY_SCREEN: "Exact app screen",
  APP_SCREEN_RECORDING: "Exact composition B-roll",
  STYLE_REFERENCE: "Style/composition only"
};

export default function PreflightReview({
  quote,
  selectedModel,
  creditCost,
  insufficientCredits = false,
  isSubmitting = false,
  submitError = null,
  onConfirm,
  onCancel
}) {
  const review = quote?.quote;
  if (!review) return null;
  const costs = review.costs || {};

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.96 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.96 }}
      className="fixed inset-0 z-[1000] flex items-center justify-center p-4 bg-black/70 backdrop-blur-md"
    >
      <div className="bg-white border border-[#111111]/20 rounded-3xl w-full max-w-3xl max-h-[90vh] overflow-y-auto shadow-2xl text-[#111111]">
        <div className="p-6 border-b border-[#111111]/10 bg-[#FAF8ED]">
          <h3 className="text-xl font-serif font-bold">Confirm the exact generation plan</h3>
          <p className="text-sm text-[#55534E] mt-1">No paid provider request is made until you approve this immutable snapshot.</p>
        </div>

        <div className="p-6 space-y-6">
          {submitError && <div className="p-3 bg-red-50 border border-red-200 rounded-xl text-sm text-red-700">{submitError}</div>}

          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <ReviewValue label="Model endpoint" value={review.model?.displayName || selectedModel?.name} />
            <ReviewValue label="Delivery" value={(review.delivery || "").replaceAll("_", " ")} />
            <ReviewValue
              label="Duration"
              value={review.settings?.durationMode === "AUTO"
                ? `Auto → ${review.settings?.durationSeconds}s`
                : `${review.settings?.durationSeconds}s (explicit)`}
            />
            <ReviewValue label="Format" value={`${review.settings?.resolution} · ${review.settings?.aspectRatio} · ${review.settings?.outputCount} output${review.settings?.outputCount === 1 ? "" : "s"}`} />
          </div>

          <section>
            <h4 className="text-sm font-bold mb-2">Asset map sent to Seedance</h4>
            <div className="space-y-2">
              {review.roleMap?.map((asset) => (
                <div key={`${asset.tag}-${asset.assetId}`} className="flex items-start gap-3 p-3 rounded-xl border border-[#111111]/10 bg-[#F8F6EE]">
                  <span className="font-mono text-xs font-bold bg-[#E6D9FF] px-2 py-1 rounded-lg">{asset.tag}</span>
                  <div>
                    <p className="text-sm font-semibold">{asset.alias}</p>
                    <p className="text-xs text-[#66635D]">{ROLE_LABELS[asset.role] || asset.role}{asset.groupId ? ` · group: ${asset.groupId}` : ""}</p>
                  </div>
                </div>
              ))}
            </div>
          </section>

          <section>
            <h4 className="text-sm font-bold mb-2">Confirmed compiled plan</h4>
            <pre className="whitespace-pre-wrap text-xs leading-relaxed bg-[#111111] text-white p-4 rounded-2xl max-h-64 overflow-y-auto">{review.scenePlan}</pre>
          </section>

          <section>
            <h4 className="text-sm font-bold mb-2">Credit quote</h4>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <ReviewValue label="Fully-loaded cost" value={costs.fullyLoadedCostMicroUsd ? `$${(Number(costs.fullyLoadedCostMicroUsd) / 1_000_000).toFixed(2)}` : "Server priced"} />
              <ReviewValue label="Raw required credits" value={costs.rawRequiredCredits ? `${costs.rawRequiredCredits} credits` : "—"} />
              <ReviewValue label="Pricing revision" value={costs.pricingRevisionId || "—"} />
              <ReviewValue label="Total reserved" value={`${creditCost || 0} credits`} strong />
            </div>
            <p className="text-xs text-[#66635D] mt-2">This amount is calculated by Doolphin’s server. No provider request or credit reservation has happened yet.</p>
            {insufficientCredits && <p className="text-xs font-semibold text-red-700 mt-2">You do not have enough available credits for this generation.</p>}
          </section>
        </div>

        <div className="p-6 border-t border-[#111111]/10 bg-[#FAF8ED] flex justify-end gap-3">
          <button onClick={onCancel} disabled={isSubmitting} className="px-5 py-2.5 rounded-full text-sm font-semibold border border-[#111111]/20 hover:bg-white disabled:opacity-50">Edit request</button>
          <button onClick={onConfirm} disabled={isSubmitting || insufficientCredits} className="px-5 py-2.5 rounded-full text-sm font-semibold bg-[#E6D9FF] border border-[#111111] hover:bg-[#DBCBFF] disabled:opacity-50">
            {isSubmitting ? "Reserving & submitting…" : `Approve & reserve ${creditCost || 0} credits`}
          </button>
        </div>
      </div>
    </motion.div>
  );
}

function ReviewValue({ label, value, strong = false }) {
  return (
    <div className="bg-white p-3 rounded-xl border border-[#111111]/10">
      <p className="text-[11px] text-[#77746D] mb-1">{label}</p>
      <p className={`text-sm ${strong ? "font-extrabold" : "font-semibold"}`}>{value || "—"}</p>
    </div>
  );
}
