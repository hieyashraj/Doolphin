"use client";

import { useMemo, useState } from "react";
import { FiCheck, FiPlus, FiSearch, FiInfo } from "react-icons/fi";
import { EXPLORE_IMAGES } from "@/lib/explore-images-data";

export default function ExploreGallery({
  selectedModel,
  selectedExploreIds = [],
  selectedAssetIds = [],
  onToggleExploreReference,
  onApplyPrompt
}) {
  const [search, setSearch] = useState("");

  const caps = selectedModel?.productCapabilities?.referenceImages;
  const supportsReferences = Boolean(caps?.visible);
  const maxReferences = caps?.max || 0;
  const totalAttached = selectedExploreIds.length + selectedAssetIds.length;
  const atLimit = supportsReferences && totalAttached >= maxReferences;

  const filteredImages = useMemo(() => {
    if (!search.trim()) return EXPLORE_IMAGES;
    const query = search.toLowerCase().trim();
    return EXPLORE_IMAGES.filter(
      (item) => item.title.toLowerCase().includes(query) || item.filename.toLowerCase().includes(query)
    );
  }, [search]);

  return (
    <div className="flex h-full w-full flex-col overflow-hidden bg-[#FAF8ED] p-4 sm:p-6">
      {/* Header & Filter Bar */}
      <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="font-serif text-2xl font-bold text-[#111111]">Explore Images</h2>
            <span className="rounded-full border border-[#111111]/15 bg-white px-2.5 py-0.5 text-xs font-semibold text-[#77746D]">
              {EXPLORE_IMAGES.length} curated
            </span>
          </div>
          <p className="mt-1 text-xs text-[#66635C]">
            Click any image to use it as a reference for your next generation.
          </p>
        </div>

        <div className="relative w-full sm:w-64">
          <FiSearch className="absolute left-3 top-1/2 -translate-y-1/2 text-[#77746D]" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search explore images…"
            className="w-full rounded-xl border border-[#111111]/15 bg-white py-2 pl-9 pr-3 text-xs outline-none focus:border-[#111111]"
          />
        </div>
      </div>

      {/* Model Capability Banner */}
      {!supportsReferences ? (
        <div className="mb-4 flex items-center gap-2 rounded-xl border border-[#111111]/15 bg-[#EFECE1] p-3 text-xs text-[#66635C]">
          <FiInfo className="shrink-0 text-[#111111]" size={16} />
          <span>
            The currently selected model (<strong className="text-[#111111]">{selectedModel?.displayName || "Text-to-Image"}</strong>) does not accept reference images. Switch to an Image-to-Image model to attach reference media.
          </span>
        </div>
      ) : atLimit ? (
        <div className="mb-4 flex items-center justify-between rounded-xl border border-[#111111]/15 bg-[#E6D9FF]/40 p-3 text-xs text-[#111111]">
          <div className="flex items-center gap-2">
            <FiInfo className="shrink-0" size={16} />
            <span>
              Maximum reference limit reached ({totalAttached}/{maxReferences}). Remove an attached reference in the composer to select another.
            </span>
          </div>
        </div>
      ) : null}

      {/* Grid Container */}
      <div className="flex-1 overflow-y-auto pr-1">
        {filteredImages.length === 0 ? (
          <div className="flex h-64 flex-col items-center justify-center rounded-2xl border border-dashed border-[#111111]/20 bg-white/50 text-center p-6">
            <p className="text-sm font-semibold text-[#111111]">No explore images found</p>
            <p className="mt-1 text-xs text-[#66635C]">Try searching with a different keyword.</p>
          </div>
        ) : (
          <div className="columns-1 gap-4 sm:columns-2 md:columns-3 lg:columns-4 space-y-4">
            {filteredImages.map((item) => {
              const isSelected = selectedExploreIds.includes(item.id);
              const isDisabled = !supportsReferences || (!isSelected && atLimit);

              return (
                <div
                  key={item.id}
                  className={`group relative break-inside-avoid overflow-hidden rounded-2xl border bg-white transition-all duration-200 ${
                    isSelected
                      ? "border-[#111111] ring-2 ring-[#E6D9FF] shadow-md"
                      : "border-[#111111]/15 hover:border-[#111111]/40 hover:shadow-sm"
                  }`}
                >
                  <div
                    className="relative w-full overflow-hidden bg-[#EFECE1]"
                    style={{ aspectRatio: `${item.aspectRatio}` }}
                  >
                    <img
                      src={item.thumbUrl}
                      alt={item.title}
                      loading="lazy"
                      className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.03]"
                    />

                    {/* Selected Badge */}
                    {isSelected && (
                      <div className="absolute left-2.5 top-2.5 flex items-center gap-1.5 rounded-full border border-[#111111]/15 bg-white/95 px-2.5 py-1 text-xs font-bold text-[#111111] shadow-sm backdrop-blur-sm">
                        <FiCheck className="text-[#111111]" size={13} />
                        <span>Attached</span>
                      </div>
                    )}

                    {/* Hover Overlay */}
                    <div className="absolute inset-0 flex flex-col justify-between bg-gradient-to-t from-[#111111]/80 via-[#111111]/20 to-transparent p-3 opacity-0 transition-opacity duration-200 group-hover:opacity-100 focus-within:opacity-100">
                      <div></div>
                      <div>
                        {/* Raw pixel dimensions and the decimal aspect ratio were
                            shown here ("1672 × 941 • 1.777"), which means nothing
                            to a user choosing a reference image. */}
                        <p className="text-sm font-bold text-white drop-shadow-sm">{item.title}</p>

                        <div className="mt-2.5 flex items-center gap-2">
                          <button
                            type="button"
                            disabled={isDisabled}
                            onClick={() => onToggleExploreReference(item.id)}
                            className={`flex flex-1 items-center justify-center gap-1.5 rounded-xl px-3 py-2 text-xs font-bold transition-all shadow-sm ${
                              isSelected
                                ? "bg-white text-[#111111] hover:bg-[#EFECE1]"
                                : isDisabled
                                ? "cursor-not-allowed bg-white/40 text-white/60"
                                : "bg-[#E6D9FF] text-[#111111] hover:bg-[#DBCBFF]"
                            }`}
                          >
                            {isSelected ? (
                              <>
                                <FiCheck size={14} /> Remove reference
                              </>
                            ) : (
                              <>
                                <FiPlus size={14} /> Use as reference
                              </>
                            )}
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
