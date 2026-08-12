"use client";

import { FiEdit3 } from "react-icons/fi";
import LazyVideo from "@/components/LazyVideo";

export default function PresetHeaderCard({ preset, onChangeClick }) {
  const title = preset?.name || "Video Studio";
  const isVideo = preset?.image && (preset.image.endsWith(".mp4") || preset.image.endsWith(".webm"));

  return (
    <div className="relative w-full h-36 rounded-2xl overflow-hidden bg-white border border-[#111111]/15 shadow-sm group shrink-0">
      {preset?.image ? (
        isVideo ? (
          <LazyVideo
            src={preset.image}
            autoPlay
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
        <div className="w-full h-full bg-[#EFECE1] flex items-center justify-center">
          <span className="text-2xl font-serif font-bold text-[#111111]/30 tracking-wider">
            {title}
          </span>
        </div>
      )}

      {/* Floating Change button at top right */}
      <button
        onClick={onChangeClick}
        type="button"
        className="absolute top-3 right-3 z-20 bg-white/90 hover:bg-white text-[#111111] text-sm font-semibold px-3.5 py-1.5 rounded-full border border-[#111111]/20 flex items-center gap-1.5 shadow-sm transition-all active:scale-95 cursor-pointer"
      >
        <FiEdit3 size={14} className="text-[#111111]" />
        <span>Change</span>
      </button>

      {/* Title directly over bottom-left of image */}
      <div className="absolute bottom-3 left-3.5 z-20">
        <h3 className="text-lg font-serif font-bold text-white tracking-wide drop-shadow-md">
          {title}
        </h3>
      </div>

      {/* Dark gradient overlay for visual contrast */}
      <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent pointer-events-none z-10" />
    </div>
  );
}
