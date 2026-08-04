"use client";

import { FiEdit3 } from "react-icons/fi";

export default function PresetHeaderCard({ preset, onChangeClick }) {
  const title = preset?.name?.toUpperCase() || "VIDEO MAKER";
  const subtitle = preset?.subtitle || preset?.model || "Seedance 2.0";

  return (
    <div className="relative w-full rounded-2xl overflow-hidden bg-[#18181b] border border-white/10 shadow-lg group">
      {/* Thumbnail image with dark gradient overlay */}
      <div className="h-28 w-full relative overflow-hidden bg-black/60">
        {preset?.image ? (
          <img
            src={preset.image}
            alt={preset.name}
            className="w-full h-full object-cover opacity-80 group-hover:scale-105 transition-transform duration-300"
          />
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
          className="absolute top-2.5 right-2.5 bg-black/60 hover:bg-black/80 backdrop-blur-md text-white/90 text-xs font-semibold px-2.5 py-1 rounded-full border border-white/20 flex items-center gap-1.5 shadow-md transition-all active:scale-95 cursor-pointer"
        >
          <FiEdit3 size={12} className="text-white/80" />
          <span>Change</span>
        </button>

        {/* Gradient overlay at bottom */}
        <div className="absolute inset-0 bg-gradient-to-t from-[#141416] via-transparent to-black/20" />
      </div>

      {/* Preset Title & Subtitle */}
      <div className="p-3 bg-[#141416]">
        <h3 className="text-xs font-extrabold text-white tracking-wide uppercase">
          {title}
        </h3>
        <p className="text-[11px] text-gray-400 font-medium mt-0.5">
          {subtitle}
        </p>
      </div>
    </div>
  );
}
