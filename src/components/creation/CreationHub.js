"use client";

import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { 
  FiEdit3, 
  FiSearch, 
  FiX, 
  FiPlay, 
  FiMaximize2, 
  FiZap, 
  FiCheck,
  FiVideo,
  FiBox,
  FiSmartphone,
  FiLayers,
  FiGrid
} from "react-icons/fi";
import PresetHeaderCard from "./PresetHeaderCard";
import VideoMakerForm from "./VideoMakerForm";
import ProductAdForm from "./ProductAdForm";
import AppStudioForm from "./AppStudioForm";
import PreflightReview from "./PreflightReview";
import ProgressTimeline from "./ProgressTimeline";
import { PRESETS_LIBRARY } from "@/lib/presetsData";

const PRESET_MODES = [
  {
    id: "video_maker",
    name: "Video Maker",
    subtitle: "Seedance 2.0",
    category: "General",
    image: "/explore/Explore 01.mp4",
    credits: 30,
  },
  {
    id: "product",
    name: "Product Ad",
    subtitle: "Product Ad",
    category: "Product & E-Com",
    image: "/explore/Explore 03.mp4",
    credits: 80,
  },
  {
    id: "app",
    name: "App Studio",
    subtitle: "App Studio",
    category: "Apps & SaaS",
    image: "/explore/Explore 02.mp4",
    credits: 80,
  }
];

const MODELS = [
  { id: "seedance-2", name: "Seedance 2.0" },
  { id: "grok-video", name: "Grok Video" },
  { id: "veo-3-1", name: "Veo 3.1" },
  { id: "happy-horse", name: "Happy Horse 1" },
  { id: "fal-kling-3-std", name: "Kling 3.0 Standard" },
  { id: "fal-luma-ray-v2", name: "Luma Ray 2" }
];

const MOCK_VIDEOS = [
  { id: "v1", title: "Luxury Box Unboxing", url: "/explore/Explore 01.mp4", poster: "/explore/Explore 01.mp4" },
  { id: "v2", title: "Creator Reaction & Phone Demo", url: "/explore/Explore 02.mp4", poster: "/explore/Explore 02.mp4" },
  { id: "v3", title: "Guilty Passion Drink Splash", url: "/explore/Explore 03.mp4", poster: "/explore/Explore 03.mp4" },
  { id: "v4", title: "Outdoor Travel Bag Load", url: "/explore/Explore 04.mp4", poster: "/explore/Explore 04.mp4" },
  { id: "v5", title: "Haircare Shower Routine", url: "/explore/Explore 05.mp4", poster: "/explore/Explore 05.mp4" },
  { id: "v6", title: "Oat Milk Product Review", url: "/explore/Explore 06.mp4", poster: "/explore/Explore 06.mp4" },
  { id: "v7", title: "Serum Bottle Showcase", url: "/explore/Explore 07.mp4", poster: "/explore/Explore 07.mp4" },
  { id: "v8", title: "Talking Head UGC Creator", url: "/explore/Explore 08.mp4", poster: "/explore/Explore 08.mp4" },
];

export default function CreationHub({ selectedAvatar, onOpenAvatarModal }) {
  const [activeModeId, setActiveModeId] = useState("video_maker");
  const [isPresetModalOpen, setIsPresetModalOpen] = useState(false);
  const [presetSearch, setPresetSearch] = useState("");
  
  // Shared Form States
  const [sceneMotion, setSceneMotion] = useState("");
  const [selectedModel, setSelectedModel] = useState(MODELS[0]);
  const [duration, setDuration] = useState("Auto");
  const [resolution, setResolution] = useState("720p");
  const [aspectRatio, setAspectRatio] = useState("Auto");
  const [numVideos, setNumVideos] = useState(1);
  const [uploadedImages, setUploadedImages] = useState([]);
  const [audioSource, setAudioSource] = useState("");

  const [productImage, setProductImage] = useState(null);
  const [appImage, setAppImage] = useState(null);
  const [spokenScript, setSpokenScript] = useState("");
  const [additionalInstructions, setAdditionalInstructions] = useState("");

  const [showPreflight, setShowPreflight] = useState(false);
  const [generationId, setGenerationId] = useState(null);
  const [selectedVideo, setSelectedVideo] = useState(null);

  const activePreset = PRESET_MODES.find(m => m.id === activeModeId) || PRESET_MODES[0];

  const handleProductUpload = (e) => {
    const file = e.target.files?.[0];
    if (file) {
      const localUrl = URL.createObjectURL(file);
      const obj = { id: `prod_${Date.now()}`, preview: localUrl, url: localUrl };
      setProductImage(obj);
      setUploadedImages(prev => [obj, ...prev]);
    }
  };

  const handleAppUpload = (e) => {
    const file = e.target.files?.[0];
    if (file) {
      const localUrl = URL.createObjectURL(file);
      const obj = { id: `app_${Date.now()}`, preview: localUrl, url: localUrl };
      setAppImage(obj);
      setUploadedImages(prev => [obj, ...prev]);
    }
  };

  const handleImageUpload = (e) => {
    const files = Array.from(e.target.files || []);
    const newImgs = files.map(file => ({
      id: Math.random().toString(36).substring(2, 9),
      preview: URL.createObjectURL(file),
      url: URL.createObjectURL(file)
    }));
    setUploadedImages(prev => [...prev, ...newImgs]);
  };

  const handleRemoveImage = (id) => {
    if (productImage?.id === id) setProductImage(null);
    if (appImage?.id === id) setAppImage(null);
    setUploadedImages(prev => prev.filter(img => img.id !== id));
  };

  const handleConfirmGeneration = () => {
    setShowPreflight(false);
    setGenerationId(Math.random().toString(36).substring(7));
  };

  if (generationId) {
    return (
      <div className="w-full h-full overflow-y-auto px-4 py-8 bg-[#0b0b0e]">
        <button 
          onClick={() => setGenerationId(null)}
          className="mb-8 text-xs text-gray-400 hover:text-white flex items-center space-x-2 transition-colors max-w-4xl mx-auto cursor-pointer"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
          </svg>
          <span>Back to Video Studio</span>
        </button>
        <ProgressTimeline generationId={generationId} />
      </div>
    );
  }

  const creditCost = activePreset.credits || (activeModeId === "video_maker" ? 30 : 80);

  return (
    <div className="w-full h-full flex overflow-hidden bg-[#0b0b0e] text-white">
      {/* LEFT CONTROL PANEL / DRAWER (~340px) */}
      <aside className="w-80 md:w-[340px] shrink-0 border-r border-white/10 flex flex-col h-full bg-[#121215] overflow-hidden select-none">
        
        {/* Scrollable Form Content */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4 scrollbar-subtle">
          {/* Top Header Card */}
          <PresetHeaderCard
            preset={activePreset}
            onChangeClick={() => setIsPresetModalOpen(true)}
          />

          {/* Render Active Form Fields */}
          {activeModeId === "video_maker" && (
            <VideoMakerForm
              sceneMotion={sceneMotion}
              setSceneMotion={setSceneMotion}
              selectedModel={selectedModel}
              setSelectedModel={setSelectedModel}
              duration={duration}
              setDuration={setDuration}
              resolution={resolution}
              setResolution={setResolution}
              aspectRatio={aspectRatio}
              setAspectRatio={setAspectRatio}
              numVideos={numVideos}
              setNumVideos={setNumVideos}
              selectedActor={selectedAvatar}
              onOpenActorModal={onOpenAvatarModal}
              uploadedImages={uploadedImages}
              onImageUpload={handleImageUpload}
              onRemoveImage={handleRemoveImage}
              audioSource={audioSource}
              setAudioSource={setAudioSource}
              modelsList={MODELS}
            />
          )}

          {activeModeId === "product" && (
            <ProductAdForm
              productImage={productImage}
              onProductUpload={handleProductUpload}
              selectedActor={selectedAvatar}
              onOpenActorModal={onOpenAvatarModal}
              spokenScript={spokenScript}
              setSpokenScript={setSpokenScript}
              additionalInstructions={additionalInstructions}
              setAdditionalInstructions={setAdditionalInstructions}
              uploadedImages={uploadedImages}
              onImageUpload={handleImageUpload}
              onRemoveImage={handleRemoveImage}
              duration={duration}
              setDuration={setDuration}
              resolution={resolution}
              setResolution={setResolution}
              aspectRatio={aspectRatio}
              setAspectRatio={setAspectRatio}
              numVideos={numVideos}
              setNumVideos={setNumVideos}
            />
          )}

          {activeModeId === "app" && (
            <AppStudioForm
              appImage={appImage}
              onAppUpload={handleAppUpload}
              selectedActor={selectedAvatar}
              onOpenActorModal={onOpenAvatarModal}
              spokenScript={spokenScript}
              setSpokenScript={setSpokenScript}
              additionalInstructions={additionalInstructions}
              setAdditionalInstructions={setAdditionalInstructions}
              uploadedImages={uploadedImages}
              onImageUpload={handleImageUpload}
              onRemoveImage={handleRemoveImage}
              duration={duration}
              setDuration={setDuration}
              resolution={resolution}
              setResolution={setResolution}
              aspectRatio={aspectRatio}
              setAspectRatio={setAspectRatio}
              numVideos={numVideos}
              setNumVideos={setNumVideos}
            />
          )}
        </div>

        {/* STICKY BOTTOM GENERATE BUTTON */}
        <div className="p-4 border-t border-white/10 bg-[#121215] shrink-0 space-y-2">
          <button
            type="button"
            onClick={() => setShowPreflight(true)}
            className="w-full py-3.5 px-4 bg-gradient-to-r from-blue-600 via-indigo-600 to-purple-600 hover:from-blue-500 hover:to-purple-500 text-white rounded-2xl font-bold text-xs shadow-lg shadow-blue-600/30 transition-all active:scale-[0.98] flex items-center justify-center gap-2 cursor-pointer"
          >
            <FiZap size={15} />
            <span>Generate ({creditCost} credits)</span>
          </button>
          <p className="text-[10px] text-center text-gray-400 font-medium">
            Typical run takes ~3 min
          </p>
        </div>
      </aside>

      {/* RIGHT MAIN CONTENT VIEW (4-COLUMN VIDEO GRID) */}
      <main className="flex-1 h-full overflow-y-auto p-4 md:p-6 bg-[#0b0b0e] scrollbar-subtle">
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
          {MOCK_VIDEOS.map((vid) => (
            <div
              key={vid.id}
              onClick={() => setSelectedVideo(vid)}
              className="group relative aspect-[9/16] rounded-2xl overflow-hidden bg-[#18181b] border border-white/10 shadow-md cursor-pointer hover:border-white/30 transition-all"
            >
              <video
                src={vid.url}
                className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                autoPlay
                muted
                loop
                playsInline
              />
              <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-black/20 p-3 flex flex-col justify-between opacity-0 group-hover:opacity-100 transition-opacity">
                <div className="flex justify-end">
                  <span className="p-1.5 rounded-full bg-black/60 backdrop-blur-md text-white">
                    <FiMaximize2 size={13} />
                  </span>
                </div>
                <div>
                  <h4 className="text-xs font-semibold text-white leading-tight">{vid.title}</h4>
                  <span className="text-[10px] text-gray-300 font-medium flex items-center gap-1 mt-1">
                    <FiPlay size={10} /> Play with audio
                  </span>
                </div>
              </div>
            </div>
          ))}
        </div>
      </main>

      {/* PRESET SELECTOR MODAL */}
      <AnimatePresence>
        {isPresetModalOpen && (
          <div className="fixed inset-0 z-[1000] flex items-center justify-center p-4 bg-black/80 backdrop-blur-xl">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="w-full max-w-2xl bg-[#0d0d12] border border-white/10 rounded-3xl p-6 shadow-2xl space-y-5"
            >
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-base font-bold text-white">Choose Preset & Workspace</h3>
                  <p className="text-xs text-slate-400">Select a creative workflow preset for your video</p>
                </div>
                <button
                  onClick={() => setIsPresetModalOpen(false)}
                  className="w-8 h-8 rounded-full bg-white/10 hover:bg-white/20 text-white flex items-center justify-center cursor-pointer transition-colors"
                >
                  <FiX size={16} />
                </button>
              </div>

              {/* Presets Grid */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                {PRESET_MODES.map((mode) => (
                  <button
                    key={mode.id}
                    onClick={() => {
                      setActiveModeId(mode.id);
                      setIsPresetModalOpen(false);
                    }}
                    className={`p-4 rounded-2xl border text-left transition-all cursor-pointer flex flex-col justify-between h-36 relative overflow-hidden ${
                      activeModeId === mode.id
                        ? "bg-[#0070f3]/20 border-[#0070f3] text-white shadow-[0_0_20px_rgba(0,112,243,0.2)]"
                        : "bg-[#14141c] border-white/10 text-slate-300 hover:bg-white/10"
                    }`}
                  >
                    <div className="relative z-10">
                      <span className="text-[10px] font-bold uppercase tracking-wider text-[#38bdf8]">
                        {mode.category}
                      </span>
                      <h4 className="text-sm font-bold text-white mt-1">{mode.name}</h4>
                      <p className="text-xs text-slate-400 mt-0.5">{mode.subtitle}</p>
                    </div>

                    <div className="relative z-10 flex items-center justify-between text-[11px] font-semibold text-slate-300 pt-2 border-t border-white/10">
                      <span>{mode.credits} credits</span>
                      {activeModeId === mode.id && <FiCheck className="text-[#38bdf8]" size={16} />}
                    </div>
                  </button>
                ))}
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* VIDEO PREVIEW MODAL */}
      <AnimatePresence>
        {selectedVideo && (
          <div 
            onClick={() => setSelectedVideo(null)}
            className="fixed inset-0 z-[1000] flex items-center justify-center p-4 bg-black/85 backdrop-blur-xl"
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.9 }}
              onClick={(e) => e.stopPropagation()}
              className="relative max-w-md w-full aspect-[9/16] rounded-3xl overflow-hidden border border-white/20 shadow-2xl bg-black"
            >
              <video
                src={selectedVideo.url}
                className="w-full h-full object-cover"
                controls
                autoPlay
              />
              <button
                onClick={() => setSelectedVideo(null)}
                className="absolute top-4 right-4 w-9 h-9 rounded-full bg-black/70 hover:bg-black/90 text-white flex items-center justify-center cursor-pointer border border-white/20 transition-all shadow-lg"
              >
                <FiX size={18} />
              </button>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* PREFLIGHT REVIEW MODAL */}
      <AnimatePresence>
        {showPreflight && (
          <PreflightReview 
            onConfirm={handleConfirmGeneration}
            onCancel={() => setShowPreflight(false)}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
