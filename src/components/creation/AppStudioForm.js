"use client";

import { FiUser, FiPlus, FiHelpCircle } from "react-icons/fi";
import AssetLibraryPicker from "./AssetLibraryPicker";
import StudioModelPicker from "@/components/studio/StudioModelPicker";
import StudioSelect from "@/components/studio/StudioSelect";

export default function AppStudioForm({
  appImages = [],
  onAppUpload,
  onChooseLibraryApp,
  selectedActor,
  onOpenActorModal,
  spokenScript,
  setSpokenScript,
  scriptRequired = false,
  additionalInstructions,
  setAdditionalInstructions,
  uploadedImages,
  onImageUpload,
  onChooseLibraryReference,
  onRemoveImage,
  duration,
  setDuration,
  resolution,
  setResolution,
  aspectRatio,
  setAspectRatio,
  numVideos,
  maxVideos = 1,
  setNumVideos,
  selectedModel,
  setSelectedModel,
  modelsList = []
}) {
  const explicitDurationValues = selectedModel?.durationValues?.length
    ? selectedModel?.durationValues || []
    : [5, 8, 10, 12, 15].filter((value) => value >= (selectedModel?.minDuration ?? 1) && value <= (selectedModel?.maxDuration ?? 60));
  const durationValues = ["Auto", ...new Set(explicitDurationValues.map(String))];
  const aspectRatioValues = selectedModel?.aspectRatios || [];
  const resolutionValues = selectedModel?.resolutions || [];

  return (
    <div className="studio-form space-y-3 font-sans text-[#111111]">
      {/* Upload your app * (i) */}
      <div className="space-y-1.5">
        <div className="flex items-center gap-1.5">
          <label className="block text-base font-semibold text-[#111111]">
            Upload your app <span className="text-red-500">*</span>
          </label>
          <FiHelpCircle size={14} className="text-[#77746D]" title="Upload app screenshots and optionally one MP4 or QuickTime screen recording" />
          {onChooseLibraryApp && <AssetLibraryPicker label="My Assets" accept={["image/", "video/"]} onSelect={onChooseLibraryApp} selectedAssetIds={appImages.map((asset) => asset.assetId || asset.id)} />}
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {appImages.map((appImage) => (
            <div key={appImage.id || appImage.assetId} className="relative w-20 h-20 rounded-xl border border-[#111111]/15 overflow-hidden group">
              {String(appImage.detectedMimeType || appImage.mimeType || "").startsWith("video/") ? (
                <video src={appImage.preview || appImage.url} aria-label={appImage.alias || "App screen recording"} muted playsInline className="w-full h-full object-cover" />
              ) : (
                <img src={appImage.preview || appImage.url} alt={appImage.alias || "App UI"} className="w-full h-full object-cover" />
              )}
              <button
                type="button"
                onClick={() => onRemoveImage(appImage.id || appImage.assetId)}
                className="absolute top-1 right-1 bg-black/70 text-white rounded-full w-4 h-4 flex items-center justify-center text-xs opacity-0 group-hover:opacity-100 transition-opacity"
              >
                ✕
              </button>
            </div>
          ))}
          <label className="w-20 h-20 rounded-xl bg-[#F2EFE5] hover:bg-[#EAE6D8] border border-dashed border-[#111111]/25 hover:border-[#111111]/50 flex flex-col items-center justify-center cursor-pointer transition-colors">
            <FiPlus size={22} className="text-[#77746D]" />
            <input type="file" accept="image/jpeg,image/png,image/webp,video/mp4,video/quicktime" multiple onChange={onAppUpload} className="hidden" />
          </label>
        </div>
      </div>

      {/* Choose an avatar */}
      <div className="space-y-1.5">
        <label className="block text-base font-semibold text-[#111111]">Choose an avatar <span className="text-red-500">*</span></label>
        <button
          type="button"
          onClick={onOpenActorModal}
          className="w-full bg-[#F2EFE5] hover:bg-[#EAE6D8] focus:bg-white border border-[#111111]/15 focus:border-[#111111] focus:ring-2 focus:ring-[#111111] focus:outline-none rounded-xl p-3.5 text-left flex items-center justify-between text-sm text-[#55534E] transition-colors cursor-pointer"
        >
          <div className="flex items-center gap-2.5">
            {selectedActor ? (
              <>
                <img src={selectedActor.image} alt={selectedActor.name} className="w-6 h-6 rounded-full object-cover border border-[#111111]/20" />
                <span className="text-[#111111] font-semibold text-sm">{selectedActor.name}</span>
              </>
            ) : (
              <>
                <FiUser size={16} className="text-[#77746D]" />
                <span className="font-medium text-sm">Choose avatar</span>
              </>
            )}
          </div>
        </button>
      </div>

      {/* Write your script */}
      <div className="space-y-1.5">
        <label className="block text-base font-semibold text-[#111111]">
          Write your script {scriptRequired
            ? <span className="text-red-500">*</span>
            : <span className="text-[#77746D] text-sm font-normal">(optional with a confirmed screenshot)</span>}
        </label>
        <div className="relative">
          <textarea
            value={spokenScript}
            onChange={(e) => setSpokenScript(e.target.value)}
            maxLength={300}
            rows={3}
            required={scriptRequired}
            placeholder={scriptRequired
              ? "Write the exact script for this recording-only app demo (max 300 chars)."
              : "Write the exact script for your app demo (max 300 chars). Leave blank for an app-informed draft."}
            className="w-full bg-[#F2EFE5] focus:bg-white p-3.5 text-sm font-medium text-[#111111] placeholder-[#8C887B] border border-[#111111]/15 focus:border-[#111111] focus:outline-none focus:ring-2 focus:ring-[#111111] caret-[#111111] transition-all resize-none rounded-xl"
          />
          <div className="absolute bottom-2.5 right-3 text-xs text-[#77746D] font-mono">
            {spokenScript ? spokenScript.length : 0}/300
          </div>
        </div>
      </div>

      {/* Additional instructions */}
      <div className="space-y-1.5">
        <label className="block text-base font-semibold text-[#111111]">
          Additional instructions <span className="text-[#77746D] text-sm font-normal">(optional)</span>
        </label>
        <div className="relative">
          <textarea
            value={additionalInstructions}
            onChange={(e) => setAdditionalInstructions(e.target.value)}
            maxLength={1600}
            rows={4}
            placeholder="Add any extra direction beyond what the preset enforces."
            className="w-full bg-[#F2EFE5] focus:bg-white p-3.5 text-sm font-medium text-[#111111] placeholder-[#8C887B] border border-[#111111]/15 focus:border-[#111111] focus:outline-none focus:ring-2 focus:ring-[#111111] caret-[#111111] transition-all resize-none rounded-xl"
          />
          <div className="absolute bottom-2.5 right-3 text-xs text-[#77746D] font-mono">
            {additionalInstructions ? additionalInstructions.length : 0}/1600
          </div>
        </div>
      </div>

      {/* References (i) */}
      <div className="space-y-1.5">
        <div className="flex items-center gap-1.5">
          <label className="block text-base font-semibold text-[#111111]">References</label>
          <FiHelpCircle size={14} className="text-[#77746D]" title="Optional reference images" />
          {onChooseLibraryReference && <AssetLibraryPicker label="My Assets" accept={["image/"]} onSelect={onChooseLibraryReference} selectedAssetIds={(uploadedImages || []).map((asset) => asset.assetId || asset.id)} />}
        </div>
        <div className="flex flex-wrap gap-2">
          {uploadedImages?.filter(i => !appImages.some((app) => (app.id || app.assetId) === (i.id || i.assetId))).map((img) => (
            <div key={img.id} className="relative w-16 h-16 rounded-xl border border-[#111111]/15 overflow-hidden group">
              <img src={img.preview || img.url} alt="Reference" className="w-full h-full object-cover" />
              <button
                type="button"
                onClick={() => onRemoveImage(img.id)}
                className="absolute top-1 right-1 bg-black/70 text-white rounded-full w-4 h-4 flex items-center justify-center text-xs opacity-0 group-hover:opacity-100 transition-opacity"
              >
                ✕
              </button>
            </div>
          ))}
          <label className="w-16 h-16 rounded-xl bg-[#F2EFE5] border border-dashed border-[#111111]/25 hover:border-[#111111]/50 flex items-center justify-center cursor-pointer transition-colors">
            <FiPlus size={20} className="text-[#77746D]" />
            <input type="file" accept="image/*" multiple onChange={onImageUpload} className="hidden" />
          </label>
        </div>
      </div>

      <div className="space-y-1.5">
        <label className="block text-base font-semibold text-[#111111]">AI Model <span className="text-red-500">*</span></label>
        <StudioModelPicker models={modelsList} value={selectedModel?.id} onChange={setSelectedModel} />
      </div>

      {/* Duration */}
      <div className="space-y-1.5">
        <label className="block text-base font-semibold text-[#111111]">Duration</label>
        <StudioSelect label="Duration" value={duration} values={durationValues} onChange={setDuration} formatLabel={(value) => value === "Auto" ? value : `${value}s`} className="w-full max-w-none justify-between bg-[#F2EFE5]" />
        <p className="text-xs text-[#77746D] leading-relaxed">
          Auto lets the app flow, screen count, and script timing decide the final length.
        </p>
      </div>

      {/* Resolution — rendered only when the selected model exposes it. */}
      {resolutionValues.length > 0 && (
        <div className="space-y-1.5">
          <label className="block text-base font-semibold text-[#111111]">Resolution</label>
          <StudioSelect label="Resolution" value={resolution} values={resolutionValues} onChange={setResolution} className="w-full max-w-none justify-between bg-[#F2EFE5]" />
        </div>
      )}

      {/* Aspect ratio — unsupported controls are omitted rather than left empty. */}
      {aspectRatioValues.length > 0 && (
        <div className="space-y-1.5">
          <label className="block text-base font-semibold text-[#111111]">Aspect Ratio</label>
          <StudioSelect label="Aspect ratio" value={aspectRatio} values={aspectRatioValues} onChange={setAspectRatio} className="w-full max-w-none justify-between bg-[#F2EFE5]" />
        </div>
      )}

      {/* Number of videos stepper */}
      <div className="space-y-1.5">
        <label className="block text-base font-semibold text-[#111111]">Number of videos</label>
        <div className="flex items-center gap-2 bg-[#F2EFE5] p-1.5 w-32 rounded-2xl border border-[#111111]/15">
          <button
            type="button"
            onClick={() => setNumVideos(Math.max(1, numVideos - 1))}
            className="w-9 h-9 rounded-full bg-white text-[#111111] flex items-center justify-center font-bold text-base border border-[#111111]/20 hover:bg-[#F2EFE5] active:scale-95 transition-all shadow-sm cursor-pointer"
          >
            -
          </button>
          <span className="flex-1 text-center font-bold text-[#111111] text-sm">{numVideos}</span>
          <button
            type="button"
            onClick={() => setNumVideos(Math.min(maxVideos, numVideos + 1))}
            disabled={numVideos >= maxVideos}
            className="w-9 h-9 rounded-full bg-white text-[#111111] flex items-center justify-center font-bold text-base border border-[#111111]/20 hover:bg-[#F2EFE5] active:scale-95 transition-all shadow-sm cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
          >
            +
          </button>
        </div>
      </div>
    </div>
  );
}
