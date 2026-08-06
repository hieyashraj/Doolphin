"use client";

import { useState } from "react";
import { FiX, FiDownload, FiRefreshCw, FiFilm, FiCpu, FiClock, FiMaximize2, FiVolume2 } from "react-icons/fi";

export default function CreationDetailModal({ creation, onClose, onRecreate }) {
  if (!creation) return null;

  // Parse input images from JSON if stringified
  let inputImages = [];
  try {
    if (creation.inputImages) {
      inputImages = typeof creation.inputImages === "string" ? JSON.parse(creation.inputImages) : creation.inputImages;
    }
  } catch (e) {
    inputImages = [];
  }

  // Combine avatar and product images if saved separately
  const allImages = [];
  if (creation.avatarImageUrl) allImages.push(creation.avatarImageUrl);
  if (creation.productImageUrl) allImages.push(creation.productImageUrl);
  if (Array.isArray(inputImages)) {
    inputImages.forEach(img => {
      if (img && !allImages.includes(img)) allImages.push(img);
    });
  }

  const modeName = creation.generationType === "APP_STUDIO" || creation.presetId === "app" 
    ? "App Studio" 
    : creation.generationType === "PRODUCT_STUDIO" || creation.presetId === "product"
    ? "Product Studio" 
    : "Video Studio";

  const formattedDate = creation.createdAt 
    ? new Date(creation.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
    : "Recently";

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 md:p-6 bg-black/85 backdrop-blur-xl animate-fadeIn">
      {/* Click outside to close */}
      <div className="absolute inset-0" onClick={onClose} />

      {/* Side-by-Side Modal Box (Reference Image Exact Match) */}
      <div className="relative w-full max-w-5xl h-[88vh] max-h-[750px] bg-[#0c0c10] border border-white/10 rounded-2xl overflow-hidden shadow-2xl flex flex-col md:flex-row z-10">
        
        {/* LEFT SECTION: HD VIDEO PLAYER & CONTROLS */}
        <div className="flex-1 bg-black flex flex-col items-center justify-center relative group min-h-[300px] md:min-h-0">
          {/* Top Floating Actions */}
          <div className="absolute top-4 right-4 z-20 flex items-center gap-2">
            {creation.url && (
              <a
                href={creation.url}
                download={`doolphin_video_${creation.id || "export"}.mp4`}
                target="_blank"
                rel="noreferrer"
                className="w-9 h-9 rounded-full bg-black/60 hover:bg-black/90 border border-white/20 text-white flex items-center justify-center transition-all shadow-lg cursor-pointer"
                title="Download MP4 Video"
              >
                <FiDownload size={16} />
              </a>
            )}
          </div>

          {/* Video Player */}
          {creation.url ? (
            <video
              src={creation.url}
              controls
              autoPlay
              loop
              playsInline
              className="w-full h-full max-h-[88vh] object-contain"
            />
          ) : (
            <div className="flex flex-col items-center justify-center p-8 text-center text-slate-500 space-y-3">
              <FiFilm size={48} className="opacity-40 animate-pulse" />
              <p className="text-sm font-medium">Video preview loading or processing...</p>
            </div>
          )}
        </div>

        {/* RIGHT SIDEBAR: INPUTS & METADATA INSPECTOR */}
        <aside className="w-full md:w-80 shrink-0 bg-[#121217] border-t md:border-t-0 md:border-l border-white/10 flex flex-col h-full overflow-hidden select-none">
          {/* Header Bar */}
          <div className="p-4 border-b border-white/10 flex items-center justify-between">
            <h3 className="text-xs font-bold tracking-wider text-slate-300 uppercase">Creation Details</h3>
            <button
              onClick={onClose}
              className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-white/10 transition-colors cursor-pointer"
            >
              <FiX size={18} />
            </button>
          </div>

          {/* Scrollable Inspector Body */}
          <div className="flex-1 overflow-y-auto p-4 space-y-5 scrollbar-subtle">
            
            {/* Inputs Thumbnails Grid */}
            <div className="space-y-2.5">
              <h4 className="text-xs font-semibold text-slate-300">Inputs ({allImages.length})</h4>
              {allImages.length > 0 ? (
                <div className="grid grid-cols-2 gap-2">
                  {allImages.map((imgUrl, i) => (
                    <div key={i} className="relative aspect-square rounded-xl overflow-hidden border border-white/15 bg-black/60 group">
                      <img
                        src={imgUrl}
                        alt={`Input reference ${i + 1}`}
                        className="w-full h-full object-cover transition-transform group-hover:scale-105"
                      />
                      <span className="absolute bottom-1 right-1 bg-black/75 px-1.5 py-0.5 rounded text-[9px] font-mono text-white/80 border border-white/10">
                        {i === 0 ? "Avatar" : i === 1 ? "Product/App" : `Ref ${i + 1}`}
                      </span>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="p-3 bg-white/[0.03] border border-white/5 rounded-xl text-center text-[11px] text-slate-500 italic">
                  No reference image assets attached
                </div>
              )}
            </div>

            {/* More Information Table */}
            <div className="space-y-2.5">
              <h4 className="text-xs font-semibold text-slate-300">More Information</h4>
              <div className="bg-white/[0.03] border border-white/10 rounded-xl p-3 space-y-2 text-xs">
                <div className="flex justify-between items-center py-1 border-b border-white/5">
                  <span className="text-slate-400">Mode</span>
                  <span className="font-semibold text-white">{modeName}</span>
                </div>
                <div className="flex justify-between items-center py-1 border-b border-white/5">
                  <span className="text-slate-400">AI model</span>
                  <span className="font-semibold text-white">{creation.modelId || "Seedance 2.0"}</span>
                </div>
                <div className="flex justify-between items-center py-1 border-b border-white/5">
                  <span className="text-slate-400">Duration</span>
                  <span className="font-semibold text-white">{creation.duration ? `${creation.duration}s` : "12s"}</span>
                </div>
                <div className="flex justify-between items-center py-1 border-b border-white/5">
                  <span className="text-slate-400">Resolution</span>
                  <span className="font-semibold text-white">{creation.resolution || "720p"}</span>
                </div>
                <div className="flex justify-between items-center py-1 border-b border-white/5">
                  <span className="text-slate-400">Aspect Ratio</span>
                  <span className="font-semibold text-white">{creation.aspectRatio || "9:16"}</span>
                </div>
                <div className="flex justify-between items-center py-1 border-b border-white/5">
                  <span className="text-slate-400">Audio</span>
                  <span className="font-semibold text-emerald-400">Yes (Synthesized Voice)</span>
                </div>
                <div className="flex justify-between items-center py-1">
                  <span className="text-slate-400">Created</span>
                  <span className="font-semibold text-white">{formattedDate}</span>
                </div>
              </div>
            </div>

            {/* Prompt & Script Disclosure */}
            {(creation.spokenScript || creation.prompt || creation.compiledPrompt) && (
              <div className="space-y-2">
                <h4 className="text-xs font-semibold text-slate-300">Script / Prompt</h4>
                <div className="p-3 bg-black/50 border border-white/10 rounded-xl text-xs text-slate-300 leading-relaxed italic max-h-36 overflow-y-auto scrollbar-subtle">
                  "{creation.spokenScript || creation.prompt || creation.compiledPrompt}"
                </div>
              </div>
            )}
          </div>

          {/* Bottom Action Footer: Recreate Button */}
          <div className="p-4 border-t border-white/10 bg-[#0d0d12]">
            <button
              onClick={() => {
                if (onRecreate) onRecreate(creation);
                onClose();
              }}
              className="w-full bg-[#2563eb] hover:bg-[#1d4ed8] text-white font-bold text-sm py-3 px-4 rounded-xl flex items-center justify-center gap-2 shadow-lg shadow-blue-600/30 transition-all active:scale-[0.98] cursor-pointer"
            >
              <FiRefreshCw size={16} />
              <span>Recreate</span>
            </button>
          </div>
        </aside>
      </div>
    </div>
  );
}
