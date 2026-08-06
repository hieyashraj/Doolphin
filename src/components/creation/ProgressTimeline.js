import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { FiDownload, FiPlay, FiRefreshCw, FiAlertCircle, FiCheckCircle } from 'react-icons/fi';

export default function ProgressTimeline({ generationId, onBack }) {
  const [creation, setCreation] = useState(null);
  const [pollError, setPollError] = useState(null);
  const [elapsed, setElapsed] = useState(0);
  const maxWaitWindow = '10m';

  const [stages, setStages] = useState([
    { id: 'asset_processing', name: 'Asset Processing', status: 'pending', typicalTime: '30s' },
    { id: 'audio_generation', name: 'Audio Generation', status: 'pending', typicalTime: '15s' },
    { id: 'video_synthesis', name: 'Video Synthesis', status: 'pending', typicalTime: '2m' },
    { id: 'compositing', name: 'Compositing & Export', status: 'pending', typicalTime: '45s' }
  ]);

  // Elapsed timer
  useEffect(() => {
    const timer = setInterval(() => setElapsed(prev => prev + 1), 1000);
    return () => clearInterval(timer);
  }, []);

  // Poll backend creation status
  useEffect(() => {
    if (!generationId) return;

    let isSubscribed = true;
    let timeoutId = null;

    const pollStatus = async () => {
      try {
        const res = await fetch(`/api/creations/${generationId}`);
        if (!res.ok) {
          const errData = await res.json().catch(() => ({}));
          throw new Error(errData.error || `HTTP ${res.status}`);
        }
        const data = await res.json();
        if (!isSubscribed) return;

        setCreation(data);
        setPollError(null);

        // Map status to timeline stages (case-insensitive)
        const status = (data.status || '').toLowerCase();
        if (status === 'completed') {
          setStages(prev => prev.map(s => ({ ...s, status: 'completed' })));
        } else if (status === 'failed') {
          setStages(prev => {
            const activeIdx = prev.findIndex(s => s.status === 'active' || s.status === 'pending');
            return prev.map((s, i) => {
              if (i < activeIdx) return { ...s, status: 'completed' };
              if (i === activeIdx) return { ...s, status: 'failed' };
              return { ...s, status: 'pending' };
            });
          });
        } else if (status === 'queued' || status === 'preparing') {
          setStages([
            { id: 'asset_processing', name: 'Asset Processing', status: 'active', typicalTime: '30s' },
            { id: 'audio_generation', name: 'Audio Generation', status: 'pending', typicalTime: '15s' },
            { id: 'video_synthesis', name: 'Video Synthesis', status: 'pending', typicalTime: '2m' },
            { id: 'compositing', name: 'Compositing & Export', status: 'pending', typicalTime: '45s' }
          ]);
        } else if (status === 'processing' || status === 'generating' || status === 'in_progress') {
          setStages([
            { id: 'asset_processing', name: 'Asset Processing', status: 'completed', typicalTime: '30s' },
            { id: 'audio_generation', name: 'Audio Generation', status: 'completed', typicalTime: '15s' },
            { id: 'video_synthesis', name: 'Video Synthesis', status: 'active', typicalTime: '2m' },
            { id: 'compositing', name: 'Compositing & Export', status: 'pending', typicalTime: '45s' }
          ]);
        }

        // Continue polling if not terminal
        if (status !== 'completed' && status !== 'failed' && isSubscribed) {
          timeoutId = setTimeout(pollStatus, 3000);
        }
      } catch (err) {
        if (isSubscribed) {
          setPollError(err.message);
          // Retry on error
          timeoutId = setTimeout(pollStatus, 3000);
        }
      }
    };

    // Immediate initial check
    pollStatus();

    return () => {
      isSubscribed = false;
      if (timeoutId) clearTimeout(timeoutId);
    };
  }, [generationId]);

  const activeIndex = stages.findIndex(s => s.status === 'active');
  const isCompleted = (creation?.status || '').toLowerCase() === 'completed';
  const isFailed = (creation?.status || '').toLowerCase() === 'failed';

  const formatTime = (seconds) => {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}:${s.toString().padStart(2, '0')}`;
  };

  return (
    <div className="bg-[#0d0d12] border border-white/10 rounded-3xl p-6 md:p-8 backdrop-blur-xl max-w-3xl mx-auto mt-4 shadow-2xl">
      {/* Header */}
      <div className="flex justify-between items-end mb-8 border-b border-white/10 pb-6">
        <div>
          <h3 className="text-xl md:text-2xl font-bold text-white mb-1">
            {isCompleted ? 'Video Generated Successfully!' : isFailed ? 'Generation Failed' : 'Generating Video...'}
          </h3>
          <p className="text-sm text-gray-400">
            {isCompleted
              ? 'Your high quality AI video is ready'
              : isFailed
              ? 'An error occurred during pipeline execution'
              : activeIndex >= 0
              ? `Stage ${activeIndex + 1} of ${stages.length}`
              : 'Processing in pipeline...'}
          </p>
        </div>
        <div className="text-right">
          <div className="text-2xl font-mono text-blue-400 font-light">{formatTime(elapsed)}</div>
          <div className="text-xs text-gray-500">Max wait: {maxWaitWindow}</div>
        </div>
      </div>

      {/* COMPLETED RESULT VIDEO PLAYER VIEW */}
      {isCompleted && creation?.url ? (
        <div className="space-y-6">
          <div className="relative aspect-[9/16] max-w-sm mx-auto rounded-2xl overflow-hidden border border-white/20 shadow-2xl bg-black group">
            <video
              src={creation.url}
              controls
              autoPlay
              muted
              loop
              playsInline
              className="w-full h-full object-cover"
            />
          </div>

          <div className="bg-white/5 border border-white/10 rounded-2xl p-4 space-y-2">
            <div className="flex justify-between text-xs text-gray-400">
              <span>Model Used: <strong className="text-white">{creation.modelId || 'Seedance 2.0'}</strong></span>
              <span>Resolution: <strong className="text-white">{creation.resolution || '720p'}</strong></span>
            </div>
            {creation.prompt && (
              <p className="text-xs text-gray-300 italic bg-black/40 p-2.5 rounded-xl border border-white/5">
                "{creation.prompt}"
              </p>
            )}
          </div>

          <div className="flex justify-center gap-3 pt-2">
            <a
              href={creation.url}
              download={`ai_video_${creation.id}.mp4`}
              target="_blank"
              rel="noopener noreferrer"
              className="px-6 py-3 bg-blue-600 hover:bg-blue-500 text-white font-semibold text-sm rounded-xl flex items-center gap-2 shadow-lg shadow-blue-600/30 transition-all cursor-pointer"
            >
              <FiDownload size={16} />
              <span>Download Video</span>
            </a>
            {onBack && (
              <button
                onClick={onBack}
                className="px-6 py-3 bg-white/10 hover:bg-white/20 text-gray-200 font-semibold text-sm rounded-xl flex items-center gap-2 transition-all cursor-pointer"
              >
                <FiRefreshCw size={16} />
                <span>Create Another</span>
              </button>
            )}
          </div>
        </div>
      ) : isFailed ? (
        /* FAILED ERROR VIEW */
        <div className="bg-red-500/10 border border-red-500/20 rounded-2xl p-6 text-center space-y-4 my-6">
          <div className="w-12 h-12 rounded-full bg-red-500/20 text-red-400 flex items-center justify-center mx-auto">
            <FiAlertCircle size={24} />
          </div>
          <div>
            <h4 className="text-base font-bold text-red-200 mb-1">
              {creation?.errorCode || 'Generation Failed'}
            </h4>
            <p className="text-xs text-red-300/80 max-w-md mx-auto">
              {creation?.error || pollError || 'The video provider returned an error while processing.'}
            </p>
          </div>
          {onBack && (
            <button
              onClick={onBack}
              className="px-5 py-2.5 bg-red-600/30 hover:bg-red-600/40 text-red-200 text-xs font-semibold rounded-xl border border-red-500/30 transition-all cursor-pointer"
            >
              Return to Video Studio
            </button>
          )}
        </div>
      ) : (
        /* IN-PROGRESS TIMELINE STAGES VIEW */
        <div className="space-y-6 my-4">
          {pollError && (
            <div className="p-3 bg-amber-500/10 border border-amber-500/20 rounded-xl text-xs text-amber-300 flex items-center gap-2 mb-4">
              <FiAlertCircle size={14} className="shrink-0" />
              <span>Connection status: {pollError}. Retrying...</span>
            </div>
          )}

          {stages.map((stage, idx) => (
            <div key={stage.id} className="relative">
              {idx !== stages.length - 1 && (
                <div className="absolute left-[15px] top-[30px] bottom-[-24px] w-0.5 bg-white/5" />
              )}
              {idx !== stages.length - 1 && stage.status === 'completed' && (
                <div className="absolute left-[15px] top-[30px] bottom-[-24px] w-0.5 bg-blue-500" />
              )}
              
              <div className="flex items-start space-x-4">
                <div className={`relative z-10 w-[30px] h-[30px] rounded-full flex items-center justify-center flex-shrink-0 transition-colors ${
                  stage.status === 'completed' ? 'bg-blue-500 text-white' :
                  stage.status === 'active' ? 'bg-blue-500/20 border-2 border-blue-500 text-blue-400' :
                  stage.status === 'failed' ? 'bg-red-500/20 border-2 border-red-500 text-red-400' :
                  'bg-white/10 text-gray-500'
                }`}>
                  {stage.status === 'completed' ? (
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                  ) : stage.status === 'active' ? (
                    <div className="w-2 h-2 bg-blue-500 rounded-full animate-pulse" />
                  ) : (
                    <span className="text-xs">{idx + 1}</span>
                  )}
                </div>
                
                <div className="flex-1 pt-1">
                  <div className="flex justify-between items-center">
                    <span className={`text-sm font-medium ${
                      stage.status === 'completed' ? 'text-gray-200' :
                      stage.status === 'active' ? 'text-blue-400 font-semibold' :
                      'text-gray-500'
                    }`}>
                      {stage.name}
                    </span>
                    <span className="text-xs text-gray-500">Typical: {stage.typicalTime}</span>
                  </div>
                  {stage.status === 'active' && (
                    <motion.div 
                      initial={{ opacity: 0, height: 0 }} 
                      animate={{ opacity: 1, height: 'auto' }}
                      className="mt-2 text-xs text-blue-400/80 flex items-center gap-1.5"
                    >
                      <span className="w-1.5 h-1.5 rounded-full bg-blue-400 animate-ping" />
                      <span>Processing in pipeline...</span>
                    </motion.div>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

