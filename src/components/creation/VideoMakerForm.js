"use client";

import { FiUser, FiMusic, FiPlus, FiHelpCircle } from "react-icons/fi";
import AssetLibraryPicker from "./AssetLibraryPicker";
import StudioModelPicker from "@/components/studio/StudioModelPicker";
import StudioSelect from "@/components/studio/StudioSelect";

export default function VideoMakerForm({
  sceneMotion,
  setSceneMotion,
  additionalInstructions,
  setAdditionalInstructions,
  spokenScript,
  setSpokenScript,
  selectedModel,
  setSelectedModel,
  duration,
  setDuration,
  resolution,
  setResolution,
  aspectRatio,
  setAspectRatio,
  numVideos,
  setNumVideos,
  selectedActor,
  onOpenActorModal,
  uploadedImages,
  onImageUpload,
  onChooseLibraryReference,
  onRemoveImage,
  audioSource,
  setAudioSource,
  modelsList = []
}) {
  const currentInstructions = additionalInstructions !== undefined ? additionalInstructions : sceneMotion;
  const handleInstructionChange = (val) => {
    if (setSceneMotion) setSceneMotion(val);
    if (setAdditionalInstructions) setAdditionalInstructions(val);
  };

  return (
    <div className="studio-form space-y-3 font-sans text-[#111111]">
      {/* Write your script */}
      <div className="space-y-1.5">
        <label className="block text-base font-semibold text-[#111111]">
          Write your script <span className="text-red-500">*</span>
        </label>
        <div className="relative">
          <textarea
            value={spokenScript}
            onChange={(e) => setSpokenScript(e.target.value)}
            maxLength={300}
            rows={3}
            required
            placeholder="Write the exact spoken script for the avatar (max 300 chars)..."
            className="w-full bg-[#F2EFE5] focus:bg-white p-3.5 text-sm font-medium text-[#111111] placeholder-[#8C887B] border border-[#111111]/15 focus:border-[#111111] focus:outline-none focus:ring-2 focus:ring-[#111111] caret-[#111111] transition-all resize-none rounded-xl"
          />
          <div className="absolute bottom-2.5 right-3 text-xs text-[#77746D] font-mono">
            {spokenScript ? spokenScript.length : 0}/300
          </div>
        </div>
      </div>

      {/* Describe your scene */}
      <div className="space-y-1.5">
        <label className="block text-base font-semibold text-[#111111]">
          Describe your scene (Additional Instructions)
        </label>
        <div className="relative">
          <textarea
            value={currentInstructions}
            onChange={(e) => handleInstructionChange(e.target.value)}
            maxLength={1000}
            rows={3}
            placeholder="Describe motion, camera angles, or delivery overrides..."
            className="w-full bg-[#F2EFE5] focus:bg-white p-3.5 text-sm font-medium text-[#111111] placeholder-[#8C887B] border border-[#111111]/15 focus:border-[#111111] focus:outline-none focus:ring-2 focus:ring-[#111111] caret-[#111111] transition-all resize-none rounded-xl"
          />
          <div className="absolute bottom-2.5 right-3 text-xs text-[#77746D] font-mono">
            {currentInstructions ? currentInstructions.length : 0}/1000
          </div>
        </div>
      </div>

      {/* AI Model */}
      <div className="space-y-1.5">
        <label className="block text-base font-semibold text-[#111111]">AI model</label>
        <StudioModelPicker models={modelsList} value={selectedModel?.id} onChange={setSelectedModel} />
      </div>

      {/* Duration */}
      <div className="space-y-1.5">
        <label className="block text-base font-semibold text-[#111111]">Duration</label>
        <StudioSelect label="Duration" value={duration} values={["Auto", "5", "8", "12", "15"]} onChange={setDuration} formatLabel={(value) => value === "Auto" ? value : `${value}s`} className="w-full max-w-none justify-between bg-[#F2EFE5]" />
        <p className="text-xs text-[#77746D] leading-relaxed">
          Auto lets preflight resolve the final length from your script, scene notes, and attached assets.
        </p>
      </div>

      {/* Resolution */}
      <div className="space-y-1.5">
        <label className="block text-base font-semibold text-[#111111]">Resolution</label>
        <StudioSelect label="Resolution" value={resolution} values={selectedModel?.resolutions || ["720p"]} onChange={setResolution} className="w-full max-w-none justify-between bg-[#F2EFE5]" />
      </div>

      {/* Aspect Ratio */}
      <div className="space-y-1.5">
        <label className="block text-base font-semibold text-[#111111]">Aspect Ratio</label>
        <StudioSelect label="Aspect ratio" value={aspectRatio} values={["Auto", ...(selectedModel?.aspectRatios || ["9:16"])]} onChange={setAspectRatio} className="w-full max-w-none justify-between bg-[#F2EFE5]" />
      </div>

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
            onClick={() => setNumVideos(Math.min(2, numVideos + 1))}
            className="w-9 h-9 rounded-full bg-white text-[#111111] flex items-center justify-center font-bold text-base border border-[#111111]/20 hover:bg-[#F2EFE5] active:scale-95 transition-all shadow-sm cursor-pointer"
          >
            +
          </button>
        </div>
      </div>

      {/* Choose an avatar */}
      <div className="space-y-1.5">
        <label className="block text-base font-semibold text-[#111111]">Choose an avatar</label>
        <button
          type="button"
          onClick={onOpenActorModal}
          className="w-full bg-[#F2EFE5] hover:bg-[#EAE6D8] focus:bg-white p-3.5 text-left flex items-center justify-between text-sm text-[#55534E] hover:border-[#111111]/30 transition-all cursor-pointer rounded-xl border border-[#111111]/15 focus:outline-none focus:ring-2 focus:ring-[#111111]"
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

      {/* References (optional) */}
      <div className="space-y-1.5">
        <div className="flex items-center gap-1.5">
          <label className="block text-base font-semibold text-[#111111]">References</label>
          <FiHelpCircle size={14} className="text-[#77746D]" title="Optional reference images" />
          {onChooseLibraryReference && <AssetLibraryPicker label="My Assets" accept={["image/"]} onSelect={onChooseLibraryReference} selectedAssetIds={(uploadedImages || []).map((asset) => asset.assetId || asset.id)} />}
        </div>
        <div className="flex flex-wrap gap-2">
          {uploadedImages?.map((img) => (
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
    </div>
  );
}
