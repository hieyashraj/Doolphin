import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';

export default function PreflightReview({ 
  selectedModel, 
  creditCost = 30, 
  isSubmitting = false, 
  submitError = null,
  onConfirm, 
  onCancel 
}) {
  const modelName = selectedModel?.name || 'Seedance 2.0';
  const modelId = selectedModel?.id || 'seedance-2';

  const capabilities = ['Lipsync', 'Motion Control', 'Background Replacement'];
  const stages = ['Asset Processing', 'Audio Generation', 'Video Synthesis', 'Compositing & Export'];

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.95 }}
      className="fixed inset-0 z-[1000] flex items-center justify-center p-4 bg-black/80 backdrop-blur-xl"
    >
      <div className="bg-[#0d0d12] border border-white/10 rounded-3xl w-full max-w-lg overflow-hidden shadow-2xl">
        <div className="p-6 border-b border-white/10 bg-white/5">
          <h3 className="text-xl font-semibold text-white">Preflight Review</h3>
          <p className="text-sm text-gray-400 mt-1">Review your generation quote before proceeding.</p>
        </div>

        <div className="p-6 space-y-6">
          {submitError && (
            <div className="p-3 bg-red-500/10 border border-red-500/20 rounded-xl text-xs text-red-300">
              {submitError}
            </div>
          )}

          <div className="grid grid-cols-2 gap-4">
            <div className="bg-black/40 p-4 rounded-2xl border border-white/5">
              <p className="text-xs text-gray-500 mb-1">Selected Model</p>
              <p className="text-sm font-medium text-white">{modelName}</p>
            </div>
            <div className="bg-black/40 p-4 rounded-2xl border border-white/5">
              <p className="text-xs text-gray-500 mb-1">Credits to Reserve</p>
              <p className="text-sm font-medium text-white">{creditCost} Credits</p>
            </div>
            <div className="bg-black/40 p-4 rounded-2xl border border-white/5">
              <p className="text-xs text-gray-500 mb-1">Est. External Cost</p>
              <p className="text-sm font-medium text-white">$0.20 - $0.50</p>
            </div>
            <div className="bg-black/40 p-4 rounded-2xl border border-white/5">
              <p className="text-xs text-gray-500 mb-1">Typical Processing</p>
              <p className="text-sm font-medium text-white">2-4 minutes</p>
              <p className="text-xs text-gray-600 mt-0.5">Max wait: 10 minutes</p>
            </div>
          </div>

          <div>
            <p className="text-xs text-gray-500 mb-2">Enabled Capabilities</p>
            <div className="flex flex-wrap gap-2">
              {capabilities.map(cap => (
                <span key={cap} className="px-2.5 py-1 rounded-lg bg-blue-500/10 text-blue-400 text-xs font-medium border border-blue-500/20">
                  {cap}
                </span>
              ))}
            </div>
          </div>

          <div>
            <p className="text-xs text-gray-500 mb-2">Expected Pipeline Stages</p>
            <div className="space-y-2">
              {stages.map((stage, idx) => (
                <div key={stage} className="flex items-center text-sm text-gray-300">
                  <span className="w-5 h-5 rounded-full bg-white/10 flex items-center justify-center text-[10px] mr-3">{idx + 1}</span>
                  {stage}
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="p-6 border-t border-white/10 bg-black/40 flex justify-end space-x-3">
          <button
            onClick={onCancel}
            disabled={isSubmitting}
            className="px-5 py-2.5 rounded-xl text-sm font-medium text-gray-300 hover:text-white hover:bg-white/5 transition-colors disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            disabled={isSubmitting}
            className="px-5 py-2.5 rounded-xl text-sm font-medium text-white bg-blue-600 hover:bg-blue-500 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
          >
            {isSubmitting ? (
              <>
                <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                <span>Submitting Job...</span>
              </>
            ) : (
              <span>Confirm & Generate</span>
            )}
          </button>
        </div>
      </div>
    </motion.div>
  );
}

