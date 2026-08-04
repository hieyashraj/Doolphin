"use client";

import { useState } from "react";
import { FiUser, FiPlus, FiChevronDown, FiHelpCircle, FiSmartphone } from "react-icons/fi";

export default function AppStudioForm({
  appImage,
  onAppUpload,
  selectedActor,
  onOpenActorModal,
  spokenScript,
  setSpokenScript,
  additionalInstructions,
  setAdditionalInstructions,
  uploadedImages,
  onImageUpload,
  onRemoveImage,
  duration,
  setDuration,
  resolution,
  setResolution,
  aspectRatio,
  setAspectRatio,
  numVideos,
  setNumVideos
}) {
  return (
    <div className="space-y-4 text-xs font-sans text-gray-200">
      {/* Upload your app * (i) */}
      <div className="space-y-1.5">
        <div className="flex items-center gap-1">
          <label className="block text-xs font-semibold text-gray-300">
            Upload your app <span className="text-red-400">*</span>
          </label>
          <FiHelpCircle size={12} className="text-gray-500" title="Upload a screenshot of your app interface" />
        </div>
        <div className="flex items-center gap-3">
          {appImage ? (
            <div className="relative w-20 h-20 rounded-xl border border-white/10 overflow-hidden group">
              <img src={appImage.preview || appImage.url} alt="App UI" className="w-full h-full object-cover" />
              <button
                type="button"
                onClick={() => onRemoveImage(appImage.id)}
                className="absolute top-1 right-1 bg-black/70 text-white rounded-full w-4 h-4 flex items-center justify-center text-[10px] opacity-0 group-hover:opacity-100 transition-opacity"
              >
                ✕
              </button>
            </div>
          ) : (
            <label className="w-20 h-20 rounded-xl bg-[#1c1c20] border border-dashed border-white/20 hover:border-white/40 flex flex-col items-center justify-center cursor-pointer transition-colors">
              <FiPlus size={20} className="text-gray-400" />
              <input type="file" accept="image/*" onChange={onAppUpload} className="hidden" />
            </label>
          )}
        </div>
      </div>

      {/* Choose an actor */}
      <div className="space-y-1.5">
        <label className="block text-xs font-semibold text-gray-300">Choose an actor</label>
        <button
          type="button"
          onClick={onOpenActorModal}
          className="w-full bg-[#1c1c20] hover:bg-[#27272c] border border-white/10 rounded-xl p-3 text-left flex items-center justify-between text-xs text-gray-400 transition-colors cursor-pointer"
        >
          <div className="flex items-center gap-2">
            {selectedActor ? (
              <>
                <img src={selectedActor.image} alt={selectedActor.name} className="w-5 h-5 rounded-full object-cover" />
                <span className="text-white font-medium">{selectedActor.name}</span>
              </>
            ) : (
              <>
                <FiUser size={14} className="text-gray-400" />
                <span>Choose actor</span>
              </>
            )}
          </div>
        </button>
      </div>

      {/* Write your script */}
      <div className="space-y-1.5">
        <label className="block text-xs font-semibold text-gray-300">Write your script</label>
        <div className="relative">
          <textarea
            value={spokenScript}
            onChange={(e) => setSpokenScript(e.target.value)}
            maxLength={300}
            rows={3}
            placeholder="Write what the avatar should say... (leave blank to auto-generate from your app screenshot)"
            className="w-full bg-[#1c1c20] border border-white/10 rounded-xl p-3 text-xs text-white placeholder-gray-500 focus:outline-none focus:border-blue-500 transition-colors resize-none"
          />
          <div className="absolute bottom-2 right-3 text-[10px] text-gray-500 font-mono">
            {spokenScript ? spokenScript.length : 0}/300
          </div>
        </div>
      </div>

      {/* Additional instructions * */}
      <div className="space-y-1.5">
        <label className="block text-xs font-semibold text-gray-300">
          Additional instructions <span className="text-red-400">*</span>
        </label>
        <div className="relative">
          <textarea
            value={additionalInstructions}
            onChange={(e) => setAdditionalInstructions(e.target.value)}
            maxLength={1600}
            rows={4}
            placeholder="Add any extra direction beyond what the preset enforces.."
            className="w-full bg-[#1c1c20] border border-white/10 rounded-xl p-3 text-xs text-white placeholder-gray-500 focus:outline-none focus:border-blue-500 transition-colors resize-none"
          />
          <div className="absolute bottom-2 right-3 text-[10px] text-gray-500 font-mono">
            {additionalInstructions ? additionalInstructions.length : 0}/1600
          </div>
        </div>
      </div>

      {/* References (i) */}
      <div className="space-y-1.5">
        <div className="flex items-center gap-1">
          <label className="block text-xs font-semibold text-gray-300">References</label>
          <FiHelpCircle size={12} className="text-gray-500" title="Optional reference images" />
        </div>
        <div className="flex flex-wrap gap-2">
          {uploadedImages?.filter(i => i.id !== appImage?.id).map((img) => (
            <div key={img.id} className="relative w-16 h-16 rounded-xl border border-white/10 overflow-hidden group">
              <img src={img.preview || img.url} alt="Reference" className="w-full h-full object-cover" />
              <button
                type="button"
                onClick={() => onRemoveImage(img.id)}
                className="absolute top-1 right-1 bg-black/70 text-white rounded-full w-4 h-4 flex items-center justify-center text-[10px] opacity-0 group-hover:opacity-100 transition-opacity"
              >
                ✕
              </button>
            </div>
          ))}
          <label className="w-16 h-16 rounded-xl bg-[#1c1c20] border border-dashed border-white/20 hover:border-white/40 flex items-center justify-center cursor-pointer transition-colors">
            <FiPlus size={18} className="text-gray-400" />
            <input type="file" accept="image/*" multiple onChange={onImageUpload} className="hidden" />
          </label>
        </div>
      </div>

      {/* Duration */}
      <div className="space-y-1.5">
        <label className="block text-xs font-semibold text-gray-300">Duration</label>
        <div className="relative">
          <select
            value={duration}
            onChange={(e) => setDuration(e.target.value)}
            className="w-full bg-[#1c1c20] border border-white/10 rounded-xl px-3 py-2.5 text-xs text-white appearance-none focus:outline-none focus:border-blue-500 cursor-pointer pr-8"
          >
            <option value="12">12s</option>
            <option value="5">5s</option>
            <option value="8">8s</option>
            <option value="15">15s</option>
          </select>
          <FiChevronDown className="absolute right-3 top-3 text-gray-400 pointer-events-none" size={14} />
        </div>
      </div>

      {/* Resolution */}
      <div className="space-y-1.5">
        <label className="block text-xs font-semibold text-gray-300">Resolution</label>
        <div className="relative">
          <select
            value={resolution}
            onChange={(e) => setResolution(e.target.value)}
            className="w-full bg-[#1c1c20] border border-white/10 rounded-xl px-3 py-2.5 text-xs text-white appearance-none focus:outline-none focus:border-blue-500 cursor-pointer pr-8"
          >
            <option value="720p">720p</option>
            <option value="1080p">1080p</option>
            <option value="4k">4k</option>
          </select>
          <FiChevronDown className="absolute right-3 top-3 text-gray-400 pointer-events-none" size={14} />
        </div>
      </div>

      {/* Aspect Ratio */}
      <div className="space-y-1.5">
        <label className="block text-xs font-semibold text-gray-300">Aspect Ratio</label>
        <div className="relative flex items-center">
          <select
            value={aspectRatio}
            onChange={(e) => setAspectRatio(e.target.value)}
            className="w-full bg-[#1c1c20] border border-white/10 rounded-xl pl-8 pr-8 py-2.5 text-xs text-white appearance-none focus:outline-none focus:border-blue-500 cursor-pointer"
          >
            <option value="9:16">9:16 (Vertical)</option>
            <option value="16:9">16:9 (Landscape)</option>
            <option value="1:1">1:1 (Square)</option>
          </select>
          <FiSmartphone className="absolute left-3 text-gray-400 pointer-events-none" size={14} />
          <FiChevronDown className="absolute right-3 text-gray-400 pointer-events-none" size={14} />
        </div>
      </div>

      {/* Number of videos stepper */}
      <div className="space-y-1.5">
        <label className="block text-xs font-semibold text-gray-300">Number of videos</label>
        <div className="flex items-center gap-2 bg-[#1c1c20] border border-white/10 rounded-xl p-1 w-28">
          <button
            type="button"
            onClick={() => setNumVideos(Math.max(1, numVideos - 1))}
            className="w-8 h-8 rounded-lg bg-white/5 hover:bg-white/10 text-white flex items-center justify-center font-bold transition-colors cursor-pointer"
          >
            -
          </button>
          <span className="flex-1 text-center font-semibold text-white text-xs">{numVideos}</span>
          <button
            type="button"
            onClick={() => setNumVideos(Math.min(4, numVideos + 1))}
            className="w-8 h-8 rounded-lg bg-white/5 hover:bg-white/10 text-white flex items-center justify-center font-bold transition-colors cursor-pointer"
          >
            +
          </button>
        </div>
      </div>
    </div>
  );
}
