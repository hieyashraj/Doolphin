"use client";

import { FiEdit3 } from "react-icons/fi";

export default function PresetHeaderCard({ preset, onChangeClick }) {
  const title = preset?.name?.toUpperCase() || "VIDEO STUDIO";
  const isVideo = preset?.image && (preset.image.endsWith(".mp4") || preset.image.endsWith(".webm"));

  return (
    <div className="relative w-full h-32 rounded-2xl overflow-hidden bg-[#18181b] border border-white/10 shadow-lg group shrink-0">
      {preset?.image ? (
        isVideo ? (
          <video
            src={preset.image}
            autoPlay
            loop
            muted
            playsInline
            className="w-full h-full object-cover opacity-90 group-hover:scale-105 transition-transform duration-300 pointer-events-none"
          />
        ) : (
          <img
            src={preset.image}
            alt={preset.name}
            className="w-full h-full object-cover opacity-90 group-hover:scale-105 transition-transform duration-300"
            onError={(e) => {
              e.currentTarget.style.display = "none";
            }}
          />
        )
      ) : (
        <div className="w-full h-full bg-gradient-to-r from-purple-900/40 via-blue-900/40 to-slate-900/60 flex items-center justify-center">
          <span className="text-2xl font-extrabold text-white/30 tracking-wider">
            {title}
          </span>
        </div>
      )}

      {/* Floating Change button at top right */}
      <button
        onClick={onChangeClick}
        type="button"
        className="absolute top-2.5 right-2.5 z-20 bg-black/50 hover:bg-black/80 backdrop-blur-md text-white text-xs font-semibold px-3 py-1 rounded-full border border-white/20 flex items-center gap-1.5 shadow-md transition-all active:scale-95 cursor-pointer hover:border-white/40"
      >
        <FiEdit3 size={12} className="text-white" />
        <span>Change</span>
      </button>

      {/* Title directly over bottom-left of image */}
      <div className="absolute bottom-3 left-3 z-20">
        <h3 className="text-sm font-extrabold text-white tracking-wider uppercase drop-shadow-md">
          {title}
        </h3>
      </div>

      {/* Dark gradient overlay for visual contrast */}
      <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-black/30 pointer-events-none z-10" />
    </div>
  );
}
