import { motion } from 'framer-motion';

export default function ModeSelector({ activeMode, setActiveMode }) {
  return (
    <div className="flex space-x-2 bg-white/5 backdrop-blur-xl p-1.5 rounded-2xl border border-white/10 w-fit">
      <button
        onClick={() => setActiveMode('product')}
        className={`relative px-6 py-2.5 rounded-xl text-sm font-medium transition-colors ${
          activeMode === 'product' ? 'text-white' : 'text-gray-400 hover:text-white'
        }`}
      >
        {activeMode === 'product' && (
          <motion.div
            layoutId="mode-highlight"
            className="absolute inset-0 bg-gradient-to-r from-blue-600 to-indigo-600 rounded-xl"
            initial={false}
            transition={{ type: 'spring', stiffness: 500, damping: 35 }}
          />
        )}
        <span className="relative z-10 flex items-center space-x-2">
          <span>Create Product Ad</span>
        </span>
      </button>

      <button
        onClick={() => setActiveMode('app')}
        className={`relative px-6 py-2.5 rounded-xl text-sm font-medium transition-colors ${
          activeMode === 'app' ? 'text-white' : 'text-gray-400 hover:text-white'
        }`}
      >
        {activeMode === 'app' && (
          <motion.div
            layoutId="mode-highlight"
            className="absolute inset-0 bg-gradient-to-r from-purple-600 to-pink-600 rounded-xl"
            initial={false}
            transition={{ type: 'spring', stiffness: 500, damping: 35 }}
          />
        )}
        <span className="relative z-10 flex items-center space-x-2">
          <span>Create App Ad</span>
        </span>
      </button>
    </div>
  );
}
