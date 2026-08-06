"use client";

import { useState, useEffect } from "react";
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
  FiGrid,
  FiClock,
  FiAlertCircle
} from "react-icons/fi";
import PresetHeaderCard from "./PresetHeaderCard";
import VideoMakerForm from "./VideoMakerForm";
import ProductAdForm from "./ProductAdForm";
import AppStudioForm from "./AppStudioForm";
import ProgressTimeline from "./ProgressTimeline";
import { PRESETS_LIBRARY } from "@/lib/presetsData";
import CreationDetailModal from "./CreationDetailModal";

function getPlayfulProgressMessage(progress) {
  if (progress <= 20) return "Adding ingredients...";
  if (progress <= 50) return "Sprinkling magic...";
  if (progress <= 80) return "Doing the final touches...";
  if (progress < 100) return "Almost finished...";
  return "Finished!";
}

const PRESET_MODES = [
  {
    id: "video_maker",
    name: "Video Studio",
    subtitle: "Seedance 2.0",
    category: "General",
    image: "/studios/video_studio.jpg",
    credits: 30,
  },
  {
    id: "product",
    name: "Product Studio",
    subtitle: "Product Ad Generator",
    category: "Product & E-Com",
    image: "/studios/product_studio.jpg",
    credits: 80,
  },
  {
    id: "app",
    name: "App Studio",
    subtitle: "App & SaaS Showcase",
    category: "Apps & SaaS",
    image: "/studios/app_studio.jpg",
    credits: 80,
  }
];

const MODELS = [
  { id: "seedance-2", name: "Seedance 2" }
];

export default function CreationHub({ 
  selectedAvatar, 
  onOpenAvatarModal,
  onOpenPricing,
  onNavigateTab,
  userCredits
}) {
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

  const [generationId, setGenerationId] = useState(null);
  const [activeGeneration, setActiveGeneration] = useState(null);
  const [generationProgress, setGenerationProgress] = useState(0);
  const [selectedVideo, setSelectedVideo] = useState(null);

  const [creations, setCreations] = useState([]);
  const [isLoadingCreations, setIsLoadingCreations] = useState(true);

  const fetchCreations = async () => {
    try {
      const res = await fetch("/api/creations");
      if (res.ok) {
        const data = await res.json();
        setCreations(data);
      }
    } catch (err) {
      console.error("Failed to fetch creations:", err);
    } finally {
      setIsLoadingCreations(false);
    }
  };

  useEffect(() => {
    fetchCreations();
  }, []);

  // Real-time live creation progress polling
  useEffect(() => {
    if (!generationId) return;

    let isSubscribed = true;
    let timerId = null;

    const pollStatus = async () => {
      try {
        const res = await fetch(`/api/creations/${generationId}`);
        if (!res.ok) return;
        const data = await res.json();
        if (!isSubscribed) return;

        setActiveGeneration(data);
        const status = (data.status || "").toLowerCase();

        if (status === "completed") {
          setGenerationProgress(100);
          fetchCreations();
        } else if (status === "failed") {
          fetchCreations();
        } else {
          setGenerationProgress(prev => Math.min(prev + 12, 95));
          timerId = setTimeout(pollStatus, 3000);
        }
      } catch (e) {
        if (isSubscribed) timerId = setTimeout(pollStatus, 3000);
      }
    };

    setGenerationProgress(10);
    pollStatus();

    return () => {
      isSubscribed = false;
      if (timerId) clearTimeout(timerId);
    };
  }, [generationId]);

  const activePreset = PRESET_MODES.find(m => m.id === activeModeId) || PRESET_MODES[0];

  const compressImageIfNeeded = (file, maxWidth = 1024, maxHeight = 1024, quality = 0.82) => {
    return new Promise((resolve) => {
      if (!file || typeof file !== "object" || !file.type?.startsWith("image/")) {
        resolve(null);
        return;
      }
      const reader = new FileReader();
      reader.onload = (e) => {
        const img = new Image();
        img.onload = () => {
          let width = img.width;
          let height = img.height;
          if (width > maxWidth || height > maxHeight) {
            if (width > height) {
              height = Math.round((height * maxWidth) / width);
              width = maxWidth;
            } else {
              width = Math.round((width * maxHeight) / height);
              height = maxHeight;
            }
          }
          const canvas = document.createElement("canvas");
          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext("2d");
          ctx.drawImage(img, 0, 0, width, height);
          resolve(canvas.toDataURL("image/jpeg", quality));
        };
        img.onerror = () => resolve(e.target.result);
        img.src = e.target.result;
      };
      reader.onerror = () => resolve(null);
      reader.readAsDataURL(file);
    });
  };

  const handleProductUpload = async (e) => {
    const file = e.target.files?.[0];
    if (file) {
      const dataUrl = await compressImageIfNeeded(file);
      if (dataUrl) {
        const obj = { id: `prod_${Date.now()}`, preview: dataUrl, url: dataUrl };
        setProductImage(obj);
        setUploadedImages(prev => [obj, ...prev]);
      }
    }
  };

  const handleAppUpload = async (e) => {
    const file = e.target.files?.[0];
    if (file) {
      const dataUrl = await compressImageIfNeeded(file);
      if (dataUrl) {
        const obj = { id: `app_${Date.now()}`, preview: dataUrl, url: dataUrl };
        setAppImage(obj);
        setUploadedImages(prev => [obj, ...prev]);
      }
    }
  };

  const handleImageUpload = (e) => {
    const files = Array.from(e.target.files || []);
    files.forEach(async (file) => {
      const dataUrl = await compressImageIfNeeded(file);
      if (dataUrl) {
        const obj = { id: Math.random().toString(36).substring(2, 9), preview: dataUrl, url: dataUrl };
        setUploadedImages(prev => [...prev, obj]);
      }
    });
  };

  const handleRemoveImage = (id) => {
    if (productImage?.id === id) setProductImage(null);
    if (appImage?.id === id) setAppImage(null);
    setUploadedImages(prev => prev.filter(img => img.id !== id));
  };

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState(null);

  const handleConfirmGeneration = async () => {
    setIsSubmitting(true);
    setSubmitError(null);

    const scriptContent = spokenScript || sceneMotion || "";

    const avatarImgUrl = selectedAvatar?.imageUrl || selectedAvatar?.image || selectedAvatar?.avatar_url;
    const prodImgUrl = productImage?.url || appImage?.url;
    
    // Pack avatar as images[0] and product as images[1]
    const baseImages = [avatarImgUrl, prodImgUrl].filter(Boolean);
    const otherImages = uploadedImages.map(img => img.url).filter(url => url && url !== prodImgUrl && url !== avatarImgUrl);
    const finalImages = [...new Set([...baseImages, ...otherImages])];

    const payload = {
      modelId: selectedModel?.id || "seedance-2",
      prompt: sceneMotion || scriptContent || "A high quality professional marketing ad video",
      spokenScript: scriptContent,
      voiceoverText: scriptContent,
      additionalInstructions: additionalInstructions || "",
      settings: {
        duration: duration === "Auto" ? "Auto" : parseInt(duration) || 5,
        resolution: resolution || "720p",
        aspect_ratio: aspectRatio === "Auto" ? "Auto" : aspectRatio
      },
      images: finalImages,
      avatarName: selectedAvatar?.name,
      avatarImageUrl: avatarImgUrl,
      productImageUrl: prodImgUrl,
      useAvatar: !!selectedAvatar,
      presetCategory: activePreset?.category
    };

    try {
      const res = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });

      let data;
      const contentType = res.headers.get("content-type") || "";
      if (contentType.includes("application/json")) {
        data = await res.json();
      } else {
        const rawText = await res.text();
        if (res.status === 413 || rawText.toLowerCase().includes("request entity") || rawText.toLowerCase().includes("too large")) {
          throw new Error("Payload size exceeds Vercel limit (4.5MB). Please use smaller reference images.");
        }
        throw new Error(`Server returned HTTP ${res.status}: ${rawText.substring(0, 120)}`);
      }

      if (!res.ok || !data.success) {
        throw new Error(data?.error || `Generation failed (${data?.code || res.status})`);
      }

      setGenerationId(data.creationId);
    } catch (err) {
      console.error("[GENERATION_SUBMISSION_ERROR]", err);
      setSubmitError(err.message || "Failed to submit video generation request");
    } finally {
      setIsSubmitting(false);
    }
  };

  // Recreate handler: auto-fills left studio panel with exact configuration
  const handleRecreate = (creation) => {
    if (!creation) return;

    if (creation.generationType === "APP_STUDIO" || creation.presetId === "app") {
      setActiveModeId("app");
    } else if (creation.generationType === "PRODUCT_STUDIO" || creation.presetId === "product") {
      setActiveModeId("product");
    } else {
      setActiveModeId("video_maker");
    }

    if (creation.spokenScript || creation.prompt) setSpokenScript(creation.spokenScript || creation.prompt);
    if (creation.duration) setDuration(creation.duration);
    if (creation.resolution) setResolution(creation.resolution);
    if (creation.aspectRatio) setAspectRatio(creation.aspectRatio);
    if (creation.additionalInstructions) setAdditionalInstructions(creation.additionalInstructions);

    if (creation.productImageUrl) {
      setProductImage({ id: `recreate_prod_${Date.now()}`, preview: creation.productImageUrl, url: creation.productImageUrl });
    }
    
    // toast.success("Restored creation parameters into Studio controls!"); // Assuming toast is available
  };

  // Playful progress message selector
  const getPlayfulProgressMessage = (percent) => {
    if (percent < 20) return "adding ingredients";
    if (percent < 50) return "sprinkling magic";
    if (percent < 80) return "doing the final touches";
    if (percent < 100) return "almost finished";
    return "finished";
  };

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
              spokenScript={spokenScript}
              setSpokenScript={setSpokenScript}
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
          {submitError && (
            <div className="p-2.5 bg-red-500/10 border border-red-500/20 rounded-xl text-[11px] text-red-300">
              {submitError}
            </div>
          )}
          <button
            type="button"
            disabled={isSubmitting}
            onClick={handleConfirmGeneration}
            className="w-full py-3.5 px-4 bg-gradient-to-r from-indigo-600 via-violet-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 text-white rounded-2xl font-bold text-xs shadow-lg shadow-indigo-600/30 transition-all active:scale-[0.98] flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50"
          >
            <FiZap size={15} />
            <span>{isSubmitting ? "Submitting Request..." : `Generate (${creditCost} credits)`}</span>
          </button>
          <p className="text-[10px] text-center text-gray-400 font-medium">
            Typical run takes ~3 min
          </p>
        </div>
      </aside>

      {/* RIGHT MAIN CONTENT VIEW (REALTIME LIVE PREVIEW & 4-COLUMN VIDEO GRID) */}
      <main className="flex-1 h-full overflow-y-auto p-4 md:p-6 bg-[#0b0b0e] scrollbar-subtle space-y-5">
        {/* Top Header Bar */}
        <div className="flex items-center justify-end gap-2.5 mb-2">
          <button
            onClick={() => onOpenPricing?.()}
            className="bg-[#6366f1] hover:bg-[#4f46e5] text-white font-semibold text-xs px-3.5 py-2 rounded-full flex items-center gap-1.5 shadow-md transition-all active:scale-95 cursor-pointer"
          >
            <FiZap size={13} />
            <span>Upgrade</span>
            <span className="bg-emerald-400/20 text-emerald-300 text-[9px] font-extrabold px-1.5 py-0.5 rounded-full border border-emerald-400/30">
              30% OFF
            </span>
          </button>

          <div className="bg-[#121217] border border-white/10 px-3.5 py-2 rounded-full flex items-center gap-1.5 text-xs font-semibold text-white shadow-sm">
            <span className="text-[#8b5cf6]">💎</span>
            <span>{userCredits !== undefined ? userCredits : "9999"} credits</span>
          </div>

          <button
            onClick={() => onNavigateTab?.("explore")}
            className="bg-[#121217] hover:bg-white/10 border border-white/10 text-slate-300 hover:text-white font-semibold text-xs px-3.5 py-2 rounded-full flex items-center gap-1.5 transition-colors cursor-pointer"
          >
            <span>🌐</span>
            <span>Community</span>
          </button>

          <button
            onClick={() => onNavigateTab?.("library")}
            className="bg-[#121217] hover:bg-white/10 border border-white/10 text-slate-300 hover:text-white font-semibold text-xs px-3.5 py-2 rounded-full flex items-center gap-1.5 transition-colors cursor-pointer"
          >
            <span>📜</span>
            <span>History</span>
          </button>
        </div>

        {/* EMBEDDED REAL-TIME GENERATION HERO CANVAS */}
        {generationId && activeGeneration && (
          <div className="bg-[#121217] border border-indigo-500/30 rounded-3xl p-6 shadow-2xl relative overflow-hidden">
            <div className="flex flex-col md:flex-row items-center gap-6">
              <div className="relative aspect-[9/16] w-48 shrink-0 rounded-2xl overflow-hidden bg-black border border-white/15 shadow-xl flex items-center justify-center">
                {activeGeneration.status?.toLowerCase() === "completed" && activeGeneration.url ? (
                  <video
                    src={activeGeneration.url}
                    controls
                    autoPlay
                    loop
                    playsInline
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <div className="flex flex-col items-center justify-center p-4 text-center space-y-3">
                    <div className="w-10 h-10 rounded-full border-2 border-indigo-500 border-t-transparent animate-spin" />
                    <span className="text-[11px] font-medium text-indigo-400">Rendering AI Video...</span>
                  </div>
                )}
              </div>

              <div className="flex-1 space-y-4 text-left w-full">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-extrabold uppercase tracking-widest text-[#8b5cf6]">
                    Live Generation Studio
                  </span>
                  <span className="text-xs text-slate-400 font-mono">
                    Model: {activeGeneration.modelId || "Seedance 2.0"}
                  </span>
                </div>

                <div className="space-y-1.5">
                  <h3 className="text-lg font-bold text-white capitalize">
                    {getPlayfulProgressMessage(generationProgress)}...
                  </h3>
                  <div className="w-full bg-white/10 rounded-full h-2.5 overflow-hidden">
                    <div 
                      className="bg-gradient-to-r from-indigo-500 via-violet-500 to-purple-500 h-full transition-all duration-500 rounded-full"
                      style={{ width: `${generationProgress}%` }}
                    />
                  </div>
                </div>

                {activeGeneration.prompt && (
                  <p className="text-xs text-slate-300 italic bg-black/40 p-3 rounded-xl border border-white/5 line-clamp-2">
                    "{activeGeneration.prompt}"
                  </p>
                )}

                {activeGeneration.status?.toLowerCase() === "completed" && (
                  <button
                    onClick={() => setSelectedVideo(activeGeneration)}
                    className="px-5 py-2.5 bg-[#6366f1] hover:bg-[#4f46e5] text-white font-bold text-xs rounded-xl flex items-center gap-2 shadow-md transition-all cursor-pointer"
                  >
                    <FiMaximize2 size={14} />
                    <span>View Full Details & Inputs</span>
                  </button>
                )}
              </div>
            </div>
          </div>
        )}

        {/* 4-COLUMN CREATIONS HISTORY GRID */}
        {isLoadingCreations ? (
          <div className="flex-1 flex flex-col items-center justify-center py-20 gap-3">
            <FiClock className="text-3xl text-[#38bdf8] animate-spin" />
            <span className="text-xs text-slate-400 animate-pulse">Loading creations...</span>
          </div>
        ) : creations.length === 0 ? (
          <div className="flex-1 flex flex-col items-center justify-center py-20 gap-3 text-center">
            <div className="w-16 h-16 rounded-2xl glass-card flex items-center justify-center text-slate-400 border border-white/10 mb-2">
              <FiVideo size={28} />
            </div>
            <h3 className="text-sm font-semibold text-white">No creations yet</h3>
            <p className="text-xs text-slate-400 max-w-sm">Generate your first video using the studio on the left.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3.5">
            {creations.map((item) => (
              <div
                key={item.id}
                onClick={() => item.status?.toLowerCase() === "completed" && setSelectedVideo(item)}
                className={`group relative aspect-[9/16] rounded-2xl overflow-hidden bg-[#18181b] border border-white/10 shadow-md transition-all ${
                  item.status?.toLowerCase() === "completed" ? "cursor-pointer hover:border-white/30" : ""
                }`}
              >
                {item.status?.toLowerCase() === "completed" ? (
                  <>
                    <video
                      src={item.url}
                      className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                      autoPlay
                      muted
                      loop
                      playsInline
                    />
                    <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-black/20 p-3 flex flex-col justify-between opacity-0 group-hover:opacity-100 transition-opacity">
                      <div className="flex justify-between items-start">
                        <span className="text-[10px] bg-emerald-500/20 text-emerald-400 px-2 py-0.5 rounded-full border border-emerald-500/30 uppercase font-bold">
                          COMPLETED
                        </span>
                        <span className="p-1.5 rounded-full bg-black/60 backdrop-blur-md text-white h-fit">
                          <FiMaximize2 size={13} />
                        </span>
                      </div>
                      <div>
                        <p className="text-white text-xs font-semibold leading-snug line-clamp-2">{item.prompt}</p>
                        <p className="text-slate-400 text-[9px] mt-1">{new Date(item.createdAt || Date.now()).toLocaleDateString()}</p>
                      </div>
                    </div>
                  </>
                ) : item.status?.toLowerCase() === "failed" ? (
                  <div className="w-full h-full flex flex-col items-center justify-center p-4 gap-2 text-center bg-red-500/5">
                    <FiAlertCircle className="text-red-400 text-2xl" />
                    <span className="text-[10px] bg-red-500/20 text-red-400 px-2 py-0.5 rounded-full border border-red-500/30 uppercase font-bold">
                      FAILED
                    </span>
                    <p className="text-[10px] text-slate-400 mt-2 line-clamp-3">{item.prompt}</p>
                  </div>
                ) : (
                  <div className="w-full h-full flex flex-col items-center justify-center gap-3 p-4 text-center">
                    <FiClock className="text-2xl text-[#38bdf8] animate-spin" />
                    <span className="text-[10px] bg-blue-500/20 text-[#38bdf8] px-2 py-0.5 rounded-full border border-blue-500/30 uppercase font-bold animate-pulse">
                      PROCESSING
                    </span>
                    <p className="text-[10px] text-slate-400 mt-2 line-clamp-3 opacity-50">{item.prompt}</p>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
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
                    className={`p-4 rounded-2xl border text-left transition-all cursor-pointer flex flex-col justify-end h-40 relative overflow-hidden group ${
                      activeModeId === mode.id
                        ? "border-[#6366f1] text-white shadow-[0_0_20px_rgba(99,102,241,0.4)] ring-2 ring-[#6366f1]"
                        : "border-white/10 text-slate-300 hover:border-white/30"
                    }`}
                  >
                    <img
                      src={mode.image}
                      alt={mode.name}
                      className="absolute inset-0 w-full h-full object-cover opacity-80 group-hover:scale-105 transition-transform duration-300 pointer-events-none"
                    />
                    <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/40 to-black/20 pointer-events-none" />

                    <div className="relative z-10 flex items-center justify-between w-full">
                      <h4 className="text-base font-extrabold text-white tracking-wide drop-shadow-md">
                        {mode.name}
                      </h4>
                      {activeModeId === mode.id && (
                        <span className="w-6 h-6 rounded-full bg-[#6366f1] text-white flex items-center justify-center shadow-md shrink-0">
                          <FiCheck size={14} />
                        </span>
                      )}
                    </div>
                  </button>
                ))}
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* RICH CREATION DETAILS INSPECTOR & RECREATE MODAL */}
      {selectedVideo && (
        <CreationDetailModal
          creation={selectedVideo}
          onClose={() => setSelectedVideo(null)}
          onRecreate={handleRecreate}
        />
      )}
    </div>
  );
}
