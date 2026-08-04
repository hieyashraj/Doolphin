import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';

export default function PreflightReview({ onConfirm, onCancel }) {
  const [quote, setQuote] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Simulate /api/preflight
    const fetchQuote = async () => {
      setLoading(true);
      await new Promise(r => setTimeout(r, 1200));
      setQuote({
        model: 'Doolphin Pro V1',
        capabilities: ['Lipsync', 'Motion Control', 'Background Replacement'],
        costRange: '$2.50 - $4.00',
        creditsToReserve: 40,
        stages: ['Asset Processing', 'Audio Generation', 'Video Synthesis', 'Compositing'],
        typicalProcessing: '2-4 minutes',
        maxWaitTime: '10 minutes'
      });
      setLoading(false);
    };
    fetchQuote();
  }, []);

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

        <div className="p-6">
          {loading ? (
            <div className="flex flex-col items-center justify-center py-12">
              <div className="w-10 h-10 border-4 border-blue-500 border-t-transparent rounded-full animate-spin mb-4"></div>
              <p className="text-gray-400 text-sm">Calculating quote...</p>
            </div>
          ) : (
            <div className="space-y-6">
              <div className="grid grid-cols-2 gap-4">
                <div className="bg-black/40 p-4 rounded-2xl border border-white/5">
                  <p className="text-xs text-gray-500 mb-1">Selected Model</p>
                  <p className="text-sm font-medium text-white">{quote?.model}</p>
                </div>
                <div className="bg-black/40 p-4 rounded-2xl border border-white/5">
                  <p className="text-xs text-gray-500 mb-1">Credits to Reserve</p>
                  <p className="text-sm font-medium text-white">{quote?.creditsToReserve} Credits</p>
                </div>
                <div className="bg-black/40 p-4 rounded-2xl border border-white/5">
                  <p className="text-xs text-gray-500 mb-1">Est. External Cost</p>
                  <p className="text-sm font-medium text-white">{quote?.costRange}</p>
                </div>
                <div className="bg-black/40 p-4 rounded-2xl border border-white/5">
                  <p className="text-xs text-gray-500 mb-1">Typical Processing</p>
                  <p className="text-sm font-medium text-white">{quote?.typicalProcessing}</p>
                  <p className="text-xs text-gray-600 mt-0.5">Max wait: {quote?.maxWaitTime}</p>
                </div>
              </div>

              <div>
                <p className="text-xs text-gray-500 mb-2">Enabled Capabilities</p>
                <div className="flex flex-wrap gap-2">
                  {quote?.capabilities.map(cap => (
                    <span key={cap} className="px-2.5 py-1 rounded-lg bg-blue-500/10 text-blue-400 text-xs font-medium border border-blue-500/20">
                      {cap}
                    </span>
                  ))}
                </div>
              </div>

              <div>
                <p className="text-xs text-gray-500 mb-2">Expected Pipeline Pipeline</p>
                <div className="space-y-2">
                  {quote?.stages.map((stage, idx) => (
                    <div key={stage} className="flex items-center text-sm text-gray-300">
                      <span className="w-5 h-5 rounded-full bg-white/10 flex items-center justify-center text-[10px] mr-3">{idx + 1}</span>
                      {stage}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>

        <div className="p-6 border-t border-white/10 bg-black/40 flex justify-end space-x-3">
          <button
            onClick={onCancel}
            className="px-5 py-2.5 rounded-xl text-sm font-medium text-gray-300 hover:text-white hover:bg-white/5 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            disabled={loading}
            className="px-5 py-2.5 rounded-xl text-sm font-medium text-white bg-blue-600 hover:bg-blue-500 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Confirm & Generate
          </button>
        </div>
      </div>
    </motion.div>
  );
}
