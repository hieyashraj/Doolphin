import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';

export default function ProgressTimeline({ generationId }) {
  const [stages, setStages] = useState([
    { id: 'asset_processing', name: 'Asset Processing', status: 'pending', typicalTime: '30s' },
    { id: 'audio_generation', name: 'Audio Generation', status: 'pending', typicalTime: '15s' },
    { id: 'video_synthesis', name: 'Video Synthesis', status: 'pending', typicalTime: '2m' },
    { id: 'compositing', name: 'Compositing & Export', status: 'pending', typicalTime: '45s' }
  ]);
  const [elapsed, setElapsed] = useState(0);
  const maxWaitWindow = '10m';

  useEffect(() => {
    // Timer
    const timer = setInterval(() => setElapsed(prev => prev + 1), 1000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    // Simulate SSE event stream `/api/generations/[id]/events`
    const sequence = async () => {
      const updateStage = (index, status) => {
        setStages(prev => prev.map((s, i) => i === index ? { ...s, status } : s));
      };

      updateStage(0, 'active');
      await new Promise(r => setTimeout(r, 2000));
      updateStage(0, 'completed');
      updateStage(1, 'active');
      await new Promise(r => setTimeout(r, 1500));
      updateStage(1, 'completed');
      updateStage(2, 'active');
      await new Promise(r => setTimeout(r, 4000));
      updateStage(2, 'completed');
      updateStage(3, 'active');
      await new Promise(r => setTimeout(r, 2000));
      updateStage(3, 'completed');
    };
    
    sequence();
  }, [generationId]);

  const activeIndex = stages.findIndex(s => s.status === 'active');
  const formatTime = (seconds) => {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}:${s.toString().padStart(2, '0')}`;
  };

  return (
    <div className="bg-white/5 border border-white/10 rounded-3xl p-8 backdrop-blur-xl max-w-2xl mx-auto mt-8">
      <div className="flex justify-between items-end mb-8">
        <div>
          <h3 className="text-xl font-bold text-white mb-1">Generating Ad...</h3>
          <p className="text-sm text-gray-400">
            {activeIndex >= 0 ? `Stage ${activeIndex + 1} of ${stages.length}` : 'Completed'}
          </p>
        </div>
        <div className="text-right">
          <div className="text-2xl font-mono text-blue-400 font-light">{formatTime(elapsed)}</div>
          <div className="text-xs text-gray-500">Max wait: {maxWaitWindow}</div>
        </div>
      </div>

      <div className="space-y-6">
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
                    stage.status === 'active' ? 'text-blue-400' :
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
                    className="mt-2 text-xs text-gray-400"
                  >
                    Processing in progress...
                  </motion.div>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
