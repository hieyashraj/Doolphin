"use client";

import { useState } from "react";
import { FiUser, FiMusic, FiPlus, FiChevronDown, FiHelpCircle } from "react-icons/fi";

export default function VideoMakerForm({
  sceneMotion,
  setSceneMotion,
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
  onRemoveImage,
  audioSource,
  setAudioSource,
  modelsList = []
}) {
  return (
    <div className="space-y-4 text-xs font-sans text-slate-200">
      {/* Describe your scene */}
      <div className="space-y-1.5">
        <label className="block text-xs font-semibold text-slate-300">
          Describe your scene <span className="text-red-400">*</span>
        </label>
        <div className="relative">
          <textarea
            value={sceneMotion}
            onChange={(e) => setSceneMotion(e.target.value)}
            maxLength={1000}
            rows={4}
            placeholder="Describe the motion, subject actions, lighting, camera angle..."
            className="w-full glass-control p-3 text-xs text-white placeholder-slate-500 focus:border-[#0070f3] focus:ring-1 focus:ring-[#0070f3] transition-all resize-none rounded-xl"
          />
          <div className="absolute bottom-2 right-3 text-[10px] text-slate-500 font-mono">
            {sceneMotion ? sceneMotion.length : 0}/1000
          </div>
        </div>
      </div>

      {/* AI Model */}
      <div className="space-y-1.5">
        <label className="block text-xs font-semibold text-slate-300">AI model</label>
        <div className="relative">
          <select
            value={selectedModel?.id || "seedance-2"}
            onChange={(e) => {
              const m = modelsList.find((item) => item.id === e.target.value);
              if (m) setSelectedModel(m);
            }}
            className="w-full glass-control px-3 py-2.5 text-xs text-white appearance-none focus:border-[#0070f3] focus:ring-1 focus:ring-[#0070f3] cursor-pointer pr-8 rounded-xl"
          >
            {modelsList.map((m) => (
              <option key={m.id} value={m.id} className="bg-[#0d0d12] text-white">
                {m.name}
              </option>
            ))}
          </select>
          <FiChevronDown className="absolute right-3 top-3 text-slate-400 pointer-events-none" size={14} />
        </div>
      </div>

      {/* Duration */}
      <div className="space-y-1.5">
        <label className="block text-xs font-semibold text-slate-300">Duration</label>
        <div className="relative">
          <select
            value={duration}
            onChange={(e) => setDuration(e.target.value)}
            className="w-full glass-control px-3 py-2.5 text-xs text-white appearance-none focus:border-[#0070f3] focus:ring-1 focus:ring-[#0070f3] cursor-pointer pr-8 rounded-xl"
          >
            <option value="Auto" className="bg-[#0d0d12]">Auto</option>
            <option value="5" className="bg-[#0d0d12]">5s</option>
            <option value="8" className="bg-[#0d0d12]">8s</option>
            <option value="12" className="bg-[#0d0d12]">12s</option>
            <option value="15" className="bg-[#0d0d12]">15s</option>
          </select>
          <FiChevronDown className="absolute right-3 top-3 text-slate-400 pointer-events-none" size={14} />
        </div>
      </div>

      {/* Resolution */}
      <div className="space-y-1.5">
        <label className="block text-xs font-semibold text-slate-300">Resolution</label>
        <div className="relative">
          <select
            value={resolution}
            onChange={(e) => setResolution(e.target.value)}
            className="w-full glass-control px-3 py-2.5 text-xs text-white appearance-none focus:border-[#0070f3] focus:ring-1 focus:ring-[#0070f3] cursor-pointer pr-8 rounded-xl"
          >
            <option value="720p" className="bg-[#0d0d12]">720p</option>
            <option value="1080p" className="bg-[#0d0d12]">1080p</option>
            <option value="4k" className="bg-[#0d0d12]">4k</option>
          </select>
          <FiChevronDown className="absolute right-3 top-3 text-slate-400 pointer-events-none" size={14} />
        </div>
      </div>

      {/* Aspect Ratio */}
      <div className="space-y-1.5">
        <label className="block text-xs font-semibold text-slate-300">Aspect Ratio</label>
        <div className="relative">
          <select
            value={aspectRatio}
            onChange={(e) => setAspectRatio(e.target.value)}
            className="w-full glass-control px-3 py-2.5 text-xs text-white appearance-none focus:border-[#0070f3] focus:ring-1 focus:ring-[#0070f3] cursor-pointer pr-8 rounded-xl"
          >
            <option value="Auto" className="bg-[#0d0d12]">Auto</option>
            <option value="9:16" className="bg-[#0d0d12]">9:16 (Portrait)</option>
            <option value="16:9" className="bg-[#0d0d12]">16:9 (Landscape)</option>
            <option value="1:1" className="bg-[#0d0d12]">1:1 (Square)</option>
          </select>
          <FiChevronDown className="absolute right-3 top-3 text-slate-400 pointer-events-none" size={14} />
        </div>
      </div>

      {/* Number of videos stepper */}
      <div className="space-y-1.5">
        <label className="block text-xs font-semibold text-slate-300">Number of videos</label>
        <div className="flex items-center gap-2 glass-control p-1 w-28 rounded-xl border border-white/10">
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

      {/* Choose an actor */}
      <div className="space-y-1.5">
        <label className="block text-xs font-semibold text-slate-300">Choose an actor</label>
        <button
          type="button"
          onClick={onOpenActorModal}
          className="w-full glass-control p-3 text-left flex items-center justify-between text-xs text-slate-400 hover:border-white/20 transition-all cursor-pointer rounded-xl"
        >
          <div className="flex items-center gap-2">
            {selectedActor ? (
              <>
                <img src={selectedActor.image} alt={selectedActor.name} className="w-5 h-5 rounded-full object-cover border border-white/20" />
                <span className="text-white font-medium">{selectedActor.name}</span>
              </>
            ) : (
              <>
                <FiUser size={14} className="text-slate-400" />
                <span>Choose actor</span>
              </>
            )}
          </div>
        </button>
      </div>

      {/* References (optional) */}
      <div className="space-y-1.5">
        <div className="flex items-center gap-1">
          <label className="block text-xs font-semibold text-gray-300">References</label>
          <FiHelpCircle size={12} className="text-gray-500" title="Optional reference images" />
        </div>
        <div className="flex flex-wrap gap-2">
          {uploadedImages?.map((img) => (
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

      {/* Audio Reference (optional) */}
      <div className="space-y-1.5">
        <label className="block text-xs font-semibold text-gray-300">Audio Reference (optional)</label>
        <button
          type="button"
          onClick={() => {
            const val = prompt("Enter audio URL or description:");
            if (val) setAudioSource(val);
          }}
          className="w-full bg-[#1c1c20] hover:bg-[#27272c] border border-white/10 rounded-xl p-3 text-left flex items-center justify-between text-xs text-gray-400 transition-colors cursor-pointer"
        >
          <div className="flex items-center gap-2">
            <FiMusic size={14} className="text-gray-400" />
            <span className="truncate">{audioSource || "Choose audio source"}</span>
          </div>
        </button>
      </div>
    </div>
  );
}
