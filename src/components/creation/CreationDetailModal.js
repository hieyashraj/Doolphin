"use client";

import { useState } from "react";
import { FiX, FiDownload, FiRefreshCw, FiFilm, FiCpu, FiClock, FiMaximize2, FiVolume2, FiFileText } from "react-icons/fi";

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

  // Combine avatar, product, and reference images
  const rawImages = [];
  if (creation.avatarImageUrl) rawImages.push(creation.avatarImageUrl);
  if (creation.productImageUrl) rawImages.push(creation.productImageUrl);
  if (Array.isArray(inputImages)) {
    inputImages.forEach(img => {
      if (img && !rawImages.includes(img)) rawImages.push(img);
    });
  }

  // Helper to resolve sanitized/relative image tokens into displayable image sources
  const resolveImageSource = (imgStr, index) => {
    if (!imgStr || typeof imgStr !== "string") return "/avatars/Choi E1.png";
    const trimmed = imgStr.trim();
    if (trimmed.startsWith("data:image/") || trimmed.startsWith("http://") || trimmed.startsWith("https://") || trimmed.startsWith("/")) {
      return trimmed;
    }
    // Fallback for sanitized "[Data URI Image]"
    return index === 0 ? "/avatars/Choi E1.png" : "/avatars/Dianna E1.png";
  };

  const modeName = creation.generationType === "APP_STUDIO" || creation.presetId === "app" 
    ? "App Studio" 
    : creation.generationType === "PRODUCT_STUDIO" || creation.presetId === "product"
    ? "Product Studio" 
    : "Video Studio";

  const formattedDate = creation.createdAt 
    ? new Date(creation.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
    : "Recently";

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 md:p-6 bg-[#111111]/50 backdrop-blur-md animate-fadeIn">
      {/* Click outside to close */}
      <div className="absolute inset-0" onClick={onClose} />

      {/* Side-by-Side Modal Box (Wispr Flow Design) */}
      <div className="relative w-full max-w-5xl h-[88vh] max-h-[750px] bg-[#FAF8ED] border-2 border-[#111111] rounded-3xl overflow-hidden shadow-2xl flex flex-col md:flex-row z-10 text-[#111111]">
        
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
                className="w-10 h-10 rounded-full bg-white border border-[#111111] text-[#111111] flex items-center justify-center transition-all shadow-md cursor-pointer hover:bg-[#F2EFE5]"
                title="Download MP4 Video"
              >
                <FiDownload size={18} />
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
            <div className="flex flex-col items-center justify-center p-8 text-center text-white/80 space-y-3">
              <FiFilm size={48} className="opacity-60 animate-pulse" />
              <p className="text-sm font-medium">Video preview loading or processing...</p>
            </div>
          )}
        </div>

        {/* RIGHT SIDEBAR: INPUTS & METADATA INSPECTOR */}
        <aside className="w-full md:w-88 shrink-0 bg-white border-t md:border-t-0 md:border-l border-[#111111]/20 flex flex-col h-full overflow-hidden select-none">
          {/* Header Bar */}
          <div className="p-4 md:p-5 border-b border-[#111111]/15 flex items-center justify-between">
            <h3 className="text-base font-serif font-bold text-[#111111]">Creation Details</h3>
            <button
              onClick={onClose}
              className="p-2 rounded-full text-[#111111] bg-[#F2EFE5] hover:bg-[#EAE6D8] border border-[#111111]/20 transition-colors cursor-pointer"
            >
              <FiX size={18} />
            </button>
          </div>

          {/* Scrollable Inspector Body */}
          <div className="flex-1 overflow-y-auto p-5 space-y-5 scrollbar-subtle">
            
            {/* Inputs Thumbnails Grid */}
            <div className="space-y-2.5">
              <h4 className="text-xs font-bold uppercase tracking-wider text-[#77746D]">Inputs ({rawImages.length})</h4>
              {rawImages.length > 0 ? (
                <div className="grid grid-cols-2 gap-2.5">
                  {rawImages.map((imgUrl, i) => (
                    <div key={i} className="relative aspect-square rounded-xl overflow-hidden border border-[#111111]/20 bg-[#F2EFE5] group">
                      <img
                        src={resolveImageSource(imgUrl, i)}
                        alt={`Input reference ${i + 1}`}
                        className="w-full h-full object-cover transition-transform group-hover:scale-105"
                      />
                      <span className="absolute bottom-1.5 right-1.5 bg-[#111111] text-white px-2 py-0.5 rounded-md text-[10px] font-semibold border border-[#111111]">
                        {i === 0 ? "Avatar" : i === 1 ? "Product/App" : `Ref ${i + 1}`}
                      </span>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="p-3.5 bg-[#F2EFE5] border border-[#111111]/15 rounded-xl text-center text-xs text-[#77746D] font-medium italic">
                  No reference image assets attached
                </div>
              )}
            </div>

            {/* Spoken Script Section */}
            {(creation.spokenScript || creation.prompt) && (
              <div className="space-y-2">
                <h4 className="text-xs font-bold uppercase tracking-wider text-[#77746D]">Spoken Script</h4>
                <div className="p-3.5 bg-[#FAF8ED] border border-[#111111]/15 rounded-xl text-xs text-[#111111] font-medium leading-relaxed italic max-h-32 overflow-y-auto scrollbar-subtle">
                  "{creation.spokenScript || creation.prompt}"
                </div>
              </div>
            )}

            {/* Additional Instructions Section */}
            {(creation.additionalInstructions || creation.sceneMotion) && (
              <div className="space-y-2">
                <h4 className="text-xs font-bold uppercase tracking-wider text-[#77746D]">Additional Instructions</h4>
                <div className="p-3.5 bg-[#FAF8ED] border border-[#111111]/15 rounded-xl text-xs text-[#111111] font-medium leading-relaxed max-h-32 overflow-y-auto scrollbar-subtle">
                  {creation.additionalInstructions || creation.sceneMotion}
                </div>
              </div>
            )}

            {/* More Information Table */}
            <div className="space-y-2.5">
              <h4 className="text-xs font-bold uppercase tracking-wider text-[#77746D]">More Information</h4>
              <div className="bg-[#FAF8ED] border border-[#111111]/15 rounded-xl p-3.5 space-y-2.5 text-xs font-medium">
                <div className="flex justify-between items-center py-1 border-b border-[#111111]/10">
                  <span className="text-[#55534E]">Studio Mode</span>
                  <span className="font-bold text-[#111111]">{modeName}</span>
                </div>
                <div className="flex justify-between items-center py-1 border-b border-[#111111]/10">
                  <span className="text-[#55534E]">Duration</span>
                  <span className="font-bold text-[#111111]">{creation.duration ? `${creation.duration}s` : "12s"}</span>
                </div>
                <div className="flex justify-between items-center py-1 border-b border-[#111111]/10">
                  <span className="text-[#55534E]">Resolution</span>
                  <span className="font-bold text-[#111111]">{creation.resolution || "720p"}</span>
                </div>
                <div className="flex justify-between items-center py-1 border-b border-[#111111]/10">
                  <span className="text-[#55534E]">Aspect Ratio</span>
                  <span className="font-bold text-[#111111]">{creation.aspectRatio || "9:16"}</span>
                </div>
                <div className="flex justify-between items-center py-1">
                  <span className="text-[#55534E]">Created</span>
                  <span className="font-bold text-[#111111]">{formattedDate}</span>
                </div>
              </div>
            </div>

          </div>

          {/* Bottom Action Footer: Recreate Button */}
          <div className="p-4 md:p-5 border-t border-[#111111]/15 bg-[#FAF8ED]">
            <button
              onClick={() => {
                if (onRecreate) onRecreate(creation);
                onClose();
              }}
              className="w-full bg-[#E6D9FF] hover:bg-[#DBCBFF] text-[#111111] border border-[#111111] font-semibold text-sm py-3 px-4 rounded-full flex items-center justify-center gap-2 shadow-sm transition-all active:scale-[0.98] cursor-pointer"
            >
              <FiRefreshCw size={16} />
              <span>Recreate Parameters</span>
            </button>
          </div>
        </aside>

      </div>
    </div>
  );
}
