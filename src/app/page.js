"use client";

import { useSession } from "next-auth/react";
import {
  FiArrowUp,
  FiVideo,
  FiX,
  FiSearch,
  FiChevronDown,
  FiPlus,
  FiLoader,
  FiTrash2,
  FiDownload,
  FiMaximize2,
  FiAlertCircle,
  FiClock,
  FiLayers,
  FiUser,
  FiCheck,
  FiTag,
  FiZap,
  FiMessageSquare,
  FiFilm,
  FiBox
} from "react-icons/fi";
import { FaCoins } from "react-icons/fa";
import { useEffect, useState, useRef, Suspense } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useRouter, useSearchParams } from "next/navigation";
import toast, { Toaster } from "react-hot-toast";
import { PRESETS_LIBRARY } from "@/lib/presetsData";
import CreationHub from "@/components/creation/CreationHub";

const MODELS = [
  {
    id: "grok-video",
    name: "Grok Video",
    type: "MODEL",
    icon: FiVideo,
    description: "xAI's Grok video generation model with text-to-video and image-to-video modes.",
    params: {
      aspect_ratio: { options: ["9:16", "16:9", "2:3", "3:2", "1:1"], default: "9:16" },
      resolution: { options: ["480p", "720p", "1080p"], default: "720p" },
      duration: { min: 3, max: 15, default: 6 },
    },
  },
  {
    id: "veo-3-1",
    name: "Veo 3.1",
    type: "MODEL",
    icon: FiVideo,
    description: "Google's high-fidelity video generation model with realistic movement.",
    params: {
      aspect_ratio: { options: ["9:16", "16:9"], default: "9:16" },
      duration: { options: [8, 15], default: 8 },
      resolution: { options: ["720p", "1080p", "4k"], default: "720p" },
    },
  },
  {
    id: "happy-horse",
    name: "Happy Horse 1",
    type: "MODEL",
    icon: FiVideo,
    description: "Fast and expressive animation model for lifelike motion.",
    params: {
      aspect_ratio: { options: ["9:16", "16:9", "1:1", "4:3", "3:4"], default: "9:16" },
      duration: { min: 3, max: 15, default: 5 },
    },
  },
  {
    id: "seedance-2",
    name: "Seedance 2",
    type: "MODEL",
    icon: FiVideo,
    description: "Advanced video animation with character reference support.",
    params: {
      aspect_ratio: { options: ["9:16", "16:9", "4:3", "1:1", "3:4"], default: "9:16" },
      duration: { min: 4, max: 15, default: 5 },
    },
  },
  {
    id: "fal-bytedance-seedance-v2",
    name: "Seedance 2",
    type: "MODEL",
    icon: FiVideo,
    description: "ByteDance's advanced video animation model with character reference.",
    params: {
      aspect_ratio: { options: ["9:16", "16:9", "1:1"], default: "9:16" },
      duration: { min: 4, max: 15, default: 5 },
    },
  },
  {
    id: "fal-kling-3-std",
    name: "Kling 3.0 Standard",
    type: "MODEL",
    icon: FiVideo,
    description: "Kling AI's leading video generation model with realistic camera movements.",
    params: {
      aspect_ratio: { options: ["9:16", "16:9", "1:1"], default: "9:16" },
      duration: { min: 5, max: 15, default: 5 },
    },
  },
  {
    id: "fal-luma-ray-v2",
    name: "Luma Ray 2",
    type: "MODEL",
    icon: FiVideo,
    description: "Advanced image-to-video generator with dual-image motion keyframes.",
    params: {
      aspect_ratio: { options: ["9:16", "16:9"], default: "9:16" },
      duration: { min: 5, max: 15, default: 5 },
    },
  }
];

const AVATARS = [
  { id: "andrew", name: "Andrew", image: "/avatars/Andrew E1.png" },
  { id: "choi", name: "Choi", image: "/avatars/Choi E1.png" },
  { id: "dianna", name: "Dianna", image: "/avatars/Dianna E1.png" },
  { id: "duma", name: "Duma", image: "/avatars/Duma E1.png" },
  { id: "eduardo", name: "Eduardo", image: "/avatars/Eduardo E1.png" },
  { id: "elizabeth", name: "Elizabeth", image: "/avatars/Elizabeth E1.png" },
  { id: "garret", name: "Garret", image: "/avatars/Garret E1.png" },
  { id: "hannah", name: "Hannah", image: "/avatars/Hannah E1.png" },
  { id: "jameson", name: "Jameson", image: "/avatars/Jameson E1.png" },
  { id: "jim", name: "Jim", image: "/avatars/Jim E1.png" },
  { id: "john", name: "John", image: "/avatars/John E1.png" },
  { id: "jordon", name: "Jordon", image: "/avatars/Jordon E1.png" },
  { id: "josh", name: "Josh", image: "/avatars/Josh E1.png" },
  { id: "li", name: "Li", image: "/avatars/Li E1.png" },
  { id: "mathilda", name: "Mathilda", image: "/avatars/Mathilda E1.png" },
  { id: "matty", name: "Matty", image: "/avatars/Matty E1.png" },
  { id: "meena", name: "Meena", image: "/avatars/Meena E1.png" },
  { id: "milly", name: "Milly", image: "/avatars/Milly E1.png" },
  { id: "naomi", name: "Naomi", image: "/avatars/Naomi E1.png" },
  { id: "shyla", name: "Shyla", image: "/avatars/Shyla E1.png" },
  { id: "sydney", name: "Sydney", image: "/avatars/Sydney E1.png" },
  { id: "tracey", name: "Tracey", image: "/avatars/Tracey E1.png" }
];

const MOCK_COMMUNITY = [
  { id: "e1", title: "Beauty & Skincare Unboxing", prompt: "Female UGC creator holding green serum box packaging close to camera, natural indoor lighting", url: "/explore/Explore 01.mp4", aspect: "9:16" },
  { id: "e2", title: "Tech & Mobile Reaction", prompt: "Glasses creator looking at smartphone with expressive reaction, aesthetic room setup", url: "/explore/Explore 02.mp4", aspect: "9:16" },
  { id: "e3", title: "Beverage Product Commercial", prompt: "Sleek Mixtons drink can with steamy refreshing vapor, vibrant orange background", url: "/explore/Explore 03.mp4", aspect: "9:16" },
  { id: "e5", title: "Haircare & Shower Routine", prompt: "Woman applying foaming shampoo in modern tiled shower, authentic UGC lifestyle style", url: "/explore/Explore 05.mp4", aspect: "9:16" },
  { id: "e6", title: "Coffee Bag Product Showcase", prompt: "Minimalist silver coffee pouch product shot on clean studio backdrop", url: "/explore/Explore 06.mp4", aspect: "9:16" },
  { id: "e7", title: "Outdoor Fashion Walk", prompt: "Couple walking in London street setting, casual autumn fashion UGC ad", url: "/explore/Explore 07.mp4", aspect: "9:16" },
  { id: "e8", title: "Luxury Perfume Bottle", prompt: "Amber luxury perfume bottle standing elegantly under moody warm studio spotlight", url: "/explore/Explore 08.mp4", aspect: "9:16" },
  { id: "e9", title: "Casual Creator Dialogue", prompt: "Creator wearing winter beanie speaking directly to camera in home studio setting", url: "/explore/Explore 09.mp4", aspect: "9:16" }
];

const PRICING_PLANS = [
  { id: "basic", name: "Basic Pack", price: "$5", credits: 100, description: "Perfect for testing custom prompts and exploring styles." },
  { id: "standard", name: "Standard Pack", price: "$10", credits: 250, description: "Ideal for regular creators wanting high resolution outputs." },
  { id: "pro", name: "Professional Pack", price: "$20", credits: 600, description: "Designed for power users demanding batch exports.", popular: true },
  { id: "business", name: "Business Pack", price: "$50", credits: 2000, description: "Maximum value pack for agency workflows." }
];

function calculateScriptDuration(text) {
  if (!text || !text.trim()) return 5;
  const words = text.trim().split(/\s+/).filter(Boolean).length;
  if (words <= 15) return 5;
  if (words <= 25) return 8;
  if (words <= 35) return 12;
  return 15;
}

function HomeContent() {
  const { data: session } = useSession();
  const searchParams = useSearchParams();
  const router = useRouter();
  
  const currentTab = searchParams.get("tab") || "video";
  
  const [selectedModel, setSelectedModel] = useState(MODELS[0]);
  const [selectedPreset, setSelectedPreset] = useState(null);
  const [selectedAvatar, setSelectedAvatar] = useState(null);
  
  const [modelSettings, setModelSettings] = useState({});
  const [isGenerating, setIsGenerating] = useState(false);
  
  const [spokenScript, setSpokenScript] = useState("");
  const [sceneMotion, setSceneMotion] = useState("");
  const [productImage, setProductImage] = useState(null);
  const [uploadedImages, setUploadedImages] = useState([]);
  
  const [lastGeneration, setLastGeneration] = useState(null);
  const [searchQuery, setSearchQuery] = useState("");
  
  const [voiceoverVoice, setVoiceoverVoice] = useState("21m00Tcm4TlvDq8ikWAM");
  
  const [creations, setCreations] = useState([]);
  const [isLoadingCreations, setIsLoadingCreations] = useState(true);
  const [selectedCreation, setSelectedCreation] = useState(null);
  
  const [isModelsModalOpen, setIsModelsModalOpen] = useState(false);
  const [isPresetsModalOpen, setIsPresetsModalOpen] = useState(false);
  const [presetCategoryFilter, setPresetCategoryFilter] = useState("All");
  const [presetSearchQuery, setPresetSearchQuery] = useState("");

  const [isAvatarsModalOpen, setIsAvatarsModalOpen] = useState(false);
  const [isPricingModalOpen, setIsPricingModalOpen] = useState(false);
  const [loadingCheckoutPlan, setLoadingCheckoutPlan] = useState(null);
  const [workspaceFilter, setWorkspaceFilter] = useState("all");
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const [uploadingProduct, setUploadingProduct] = useState(false);
  const [selectedExploreVideo, setSelectedExploreVideo] = useState(null);
  const [isExploreMuted, setIsExploreMuted] = useState(false);
  
  const fileInputRef = useRef(null);
  const productInputRef = useRef(null);
  const isSubmittingRef = useRef(false);

  const scriptWordCount = spokenScript.trim() ? spokenScript.trim().split(/\s+/).filter(Boolean).length : 0;
  const recommendedDuration = calculateScriptDuration(spokenScript);

  useEffect(() => {
    if (spokenScript.trim()) {
      setModelSettings((prev) => {
        const currentDur = typeof prev.duration === "number" ? prev.duration : 5;
        if (currentDur < recommendedDuration) {
          return { ...prev, duration: recommendedDuration };
        }
        return prev;
      });
    }
  }, [spokenScript, recommendedDuration]);

  const fetchCreations = async () => {
    try {
      const response = await fetch('/api/creations');
      if (response.ok && response.headers.get("content-type")?.includes("application/json")) {
        const data = await response.json();
        setCreations(data);
      }
    } catch (error) {
      console.error("Failed to fetch creations:", error);
    } finally {
      setIsLoadingCreations(false);
    }
  };

  useEffect(() => {
    fetchCreations();
  }, [lastGeneration]);

  useEffect(() => {
    let interval;
    const activeStatuses = ['processing', 'pending', 'starting', 'queued'];
    if (lastGeneration && activeStatuses.includes(lastGeneration.status?.toLowerCase())) {
      interval = setInterval(async () => {
        try {
          const res = await fetch(`/api/creations/${lastGeneration.id}`);
          if (res.ok && res.headers.get("content-type")?.includes("application/json")) {
            const data = await res.json();
            if (data && !activeStatuses.includes(data.status?.toLowerCase())) {
              setLastGeneration(data);
              fetchCreations();
              clearInterval(interval);
            } else if (data && data.status?.toLowerCase() !== lastGeneration.status?.toLowerCase()) {
              setLastGeneration(data);
            }
          }
        } catch (error) {
          console.error("Polling error:", error);
        }
      }, 5000);
    }
    return () => clearInterval(interval);
  }, [lastGeneration]);

  useEffect(() => {
    let interval;
    const activeStatuses = ['processing', 'pending', 'starting', 'queued'];
    const hasActiveCreations = creations.some(c => activeStatuses.includes(c.status?.toLowerCase()));
    
    if (hasActiveCreations) {
      interval = setInterval(() => {
        fetchCreations();
      }, 5000);
    }
    return () => clearInterval(interval);
  }, [creations]);

  useEffect(() => {
    if (selectedModel.params) {
      const defaults = {};
      Object.keys(selectedModel.params).forEach((key) => {
        if (key === "mode") return;
        let defVal = selectedModel.params[key].default || selectedModel.params[key].options?.[0] || "";
        if (key === "duration" && typeof defVal === "number") {
          defVal = Math.min(defVal, 15);
        }
        defaults[key] = defVal;
      });
      setModelSettings(defaults);
    }
  }, [selectedModel]);

  const updateSetting = (key, value) => {
    setModelSettings((prev) => ({ ...prev, [key]: value }));
  };

  const getRequiredCredits = () => {
    const duration = typeof modelSettings.duration === "number" ? Math.min(modelSettings.duration, 15) : 5;
    const resolution = modelSettings.resolution || "";

    if (selectedModel.id === "grok-video") {
      const rate = resolution === "1080p" ? 15 : resolution === "720p" ? 10 : 5;
      return duration * rate;
    }
    if (selectedModel.id === "veo-3-1") {
      let rate = 500;
      if (resolution === "1080p") rate = 650;
      else if (resolution === "4k") rate = 740;
      return duration * rate;
    }
    if (selectedModel.id === "happy-horse") return duration * 36;
    if (selectedModel.id === "seedance-2") return duration * 50;
    return 10;
  };

  const handleSelectPreset = (preset) => {
    setSelectedPreset(preset);
    let compiledPrompt = preset.prompt;
    if (selectedAvatar) {
      compiledPrompt = compiledPrompt.replace(/\[Avatar\]/g, selectedAvatar.name);
    }
    if (productImage) {
      compiledPrompt = compiledPrompt.replace(/\[Target Product\]/g, "Attached Product").replace(/\[Brand\]/g, "Attached Product");
    }
    setSpokenScript(compiledPrompt.slice(0, 300));
    setSceneMotion(`Studio tracking ${preset.name} motion`);

    const recDur = calculateScriptDuration(compiledPrompt);
    const targetDur = Math.max(recDur, Math.min(preset.defaultDuration || 15, 15));

    setModelSettings((prev) => ({
      ...prev,
      duration: targetDur,
      aspect_ratio: preset.defaultAspect || prev.aspect_ratio || "9:16"
    }));

    setIsPresetsModalOpen(false);
    toast.success(`Preset "${preset.name}" selected`);
  };

  const handleSelectAvatar = async (avatar) => {
    setSelectedAvatar(avatar);
    setIsAvatarsModalOpen(false);
    setUploadingAvatar(true);

    try {
      const blobRes = await fetch(avatar.image);
      const blob = await blobRes.blob();
      const file = new File([blob], `${avatar.id}.png`, { type: "image/png" });

      const formData = new FormData();
      formData.append("file", file);

      const response = await fetch('/api/upload', {
        method: 'POST',
        body: formData
      });

      if (!response.ok) throw new Error("Avatar upload failed");

      const data = await response.json();
      
      const newImg = {
        id: `avatar_${avatar.id}`,
        preview: avatar.image,
        url: data.url,
        status: 'ready',
        isAvatar: true
      };

      setUploadedImages(prev => [newImg, ...prev.filter(p => !p.isAvatar)]);
    } catch (err) {
      const newImg = {
        id: `avatar_${avatar.id}`,
        preview: avatar.image,
        url: avatar.image,
        status: 'ready',
        isAvatar: true
      };
      setUploadedImages(prev => [newImg, ...prev.filter(p => !p.isAvatar)]);
    } finally {
      setUploadingAvatar(false);
    }
  };

  const handleProductUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploadingProduct(true);
    const localPreview = URL.createObjectURL(file);
    
    try {
      const formData = new FormData();
      formData.append("file", file);

      const response = await fetch('/api/upload', {
        method: 'POST',
        body: formData
      });

      if (!response.ok) throw new Error("Upload failed");

      const data = await response.json();
      
      const prodObj = {
        id: `product_${Date.now()}`,
        preview: localPreview,
        url: data.url,
        file
      };

      setProductImage(prodObj);
      setUploadedImages(prev => [prodObj, ...prev.filter(p => p.id !== prodObj.id)]);
    } catch (err) {
      setProductImage({
        id: `product_${Date.now()}`,
        preview: localPreview,
        url: localPreview
      });
    } finally {
      setUploadingProduct(false);
    }
  };

  const handleImageUpload = async (e) => {
    const files = Array.from(e.target.files);
    if (uploadedImages.length + files.length > 7) {
      alert("Maximum 7 reference images allowed.");
      return;
    }

    const newImages = files.map(file => ({
      id: Math.random().toString(36).substr(2, 9),
      file,
      preview: URL.createObjectURL(file),
      status: 'uploading'
    }));

    setUploadedImages(prev => [...prev, ...newImages]);

    for (const img of newImages) {
      try {
        const formData = new FormData();
        formData.append("file", img.file);

        const response = await fetch('/api/upload', {
          method: 'POST',
          body: formData
        });

        if (!response.ok) throw new Error("Upload failed");

        const data = await response.json();
        
        setUploadedImages(prev => prev.map(p => 
          p.id === img.id ? { ...p, status: 'ready', url: data.url } : p
        ));
      } catch (error) {
        setUploadedImages(prev => prev.map(p => 
          p.id === img.id ? { ...p, status: 'error' } : p
        ));
      }
    }
  };

  const removeImage = (id) => {
    if (productImage?.id === id) setProductImage(null);
    setUploadedImages(prev => prev.filter(img => img.id !== id));
  };

  const handleGenerate = async () => {
    if (isSubmittingRef.current || isGenerating) return;

    const fullPrompt = spokenScript.trim() || sceneMotion.trim();

    if (!fullPrompt) {
      toast.error("Please add a script or visual motion prompt.");
      return;
    }
    if (spokenScript.length > 300) {
      toast.error("Script must be capped to max 300 characters.");
      return;
    }

    isSubmittingRef.current = true;
    setIsGenerating(true);

    const attemptId = `att_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const currentSettings = { ...modelSettings };
    if (typeof currentSettings.duration === "number") {
      currentSettings.duration = Math.min(currentSettings.duration, 15);
    }

    const compiledGenerationPrompt = `${sceneMotion ? `Visual Motion: ${sceneMotion}. ` : ""}${spokenScript ? `Script: ${spokenScript}` : ""}`.trim().slice(0, 300);

    try {
      const response = await fetch('/api/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          idempotencyKey: attemptId,
          modelId: selectedModel.id,
          prompt: compiledGenerationPrompt,
          settings: currentSettings,
          images: uploadedImages.filter(img => img.status === 'ready').map(img => img.url),
          generateVoiceover: Boolean(spokenScript.trim()),
          voiceoverVoice,
          voiceoverText: spokenScript.trim().slice(0, 300),
          avatarName: selectedAvatar ? selectedAvatar.name : "Actor",
          productName: productImage ? "Product" : "Product",
          presetCategory: selectedPreset ? selectedPreset.category : ""
        })
      });

      const data = await response.json().catch(() => null);

      if (!response.ok || !data?.success) {
        setLastGeneration({
          id: `err_${Date.now()}`,
          status: 'failed',
          error: data?.error || "Request failed",
          prompt: compiledGenerationPrompt
        });
        toast.error(data?.error || "Generation failed");
        return;
      }

      setLastGeneration({
        id: data.creationId,
        status: 'processing',
        stage: data.stage || 'queued',
        prompt: compiledGenerationPrompt
      });
      toast.success("Generation started!");
    } catch (error) {
      toast.error(error.message || "Failed to start generation");
    } finally {
      setIsGenerating(false);
      isSubmittingRef.current = false;
    }
  };

  const handleCheckoutPlan = async (planId) => {
    setLoadingCheckoutPlan(planId);
    try {
      const res = await fetch("/api/stripe/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ planId }),
      });
      const data = await res.json();
      if (data?.url) {
        window.location.href = data.url;
      } else {
        toast.error(data?.error || "Failed to initiate checkout");
      }
    } catch (err) {
      toast.error("Checkout process failed");
    } finally {
      setLoadingCheckoutPlan(null);
    }
  };

  const categoriesList = ["All", "Apps & SaaS", "Product & E-Com", "Tutorials & How-To", "Showcase & Ads", "Lifestyle & Story", "Fashion & Beauty", "Services"];
  const filteredPresets = PRESETS_LIBRARY.filter((item) => {
    const matchesCategory = presetCategoryFilter === "All" || item.category === presetCategoryFilter;
    const matchesSearch = item.name.toLowerCase().includes(presetSearchQuery.toLowerCase()) || 
                          item.tag.toLowerCase().includes(presetSearchQuery.toLowerCase());
    return matchesCategory && matchesSearch;
  });

  const currentAspect = modelSettings.aspect_ratio || "9:16";
  const getAspectClass = () => {
    if (currentAspect === "16:9") return "aspect-video max-w-lg";
    if (currentAspect === "1:1") return "aspect-square max-w-sm";
    if (currentAspect === "2:3" || currentAspect === "3:4") return "aspect-[3/4] max-w-sm";
    return "aspect-[9/16] max-w-xs";
  };

  return (
    <div className="h-full w-full flex flex-col overflow-hidden relative font-sans text-white bg-black">
      <Toaster 
        position="top-right" 
        toastOptions={{ 
          duration: 2500,
          style: { 
            background: 'rgba(13, 13, 18, 0.95)', 
            color: '#ffffff', 
            border: '1px solid rgba(255, 255, 255, 0.15)',
            backdropFilter: 'blur(20px)',
            boxShadow: '0 12px 34px rgba(0, 0, 0, 0.6)'
          } 
        }} 
      />

      {/* FLOATING TOP HEADER FOR NON-STUDIO TABS */}
      {currentTab !== "video" && (
        <header className="absolute top-3 right-6 flex items-center justify-end gap-4 z-30 pointer-events-auto">
          <div className="flex items-center gap-2.5">
            <button
              onClick={() => setIsPricingModalOpen(true)}
              className="bg-[#0070f3] hover:bg-[#1e82f7] text-white font-semibold text-xs px-3.5 py-2 rounded-full flex items-center gap-1.5 shadow-md transition-all active:scale-95 cursor-pointer"
            >
              <FiZap size={13} />
              <span>Upgrade</span>
              <span className="bg-emerald-400/20 text-emerald-300 text-[9px] font-extrabold px-1.5 py-0.5 rounded-full border border-emerald-400/30">
                30% OFF
              </span>
            </button>

            <div className="bg-[#121217] border border-white/10 px-3.5 py-2 rounded-full flex items-center gap-1.5 text-xs font-semibold text-white shadow-sm">
              <span className="text-[#38bdf8]">💎</span>
              <span>{session?.user?.credits !== undefined ? session.user.credits : "90"} credits</span>
            </div>

            <button
              onClick={() => router.push("/?tab=explore")}
              className="bg-[#121217] hover:bg-white/10 border border-white/10 text-slate-300 hover:text-white font-semibold text-xs px-3.5 py-2 rounded-full flex items-center gap-1.5 transition-colors cursor-pointer"
            >
              <span>🌐</span>
              <span>Community</span>
            </button>

            <button
              onClick={() => router.push("/?tab=library")}
              className="bg-[#121217] hover:bg-white/10 border border-white/10 text-slate-300 hover:text-white font-semibold text-xs px-3.5 py-2 rounded-full flex items-center gap-1.5 transition-colors cursor-pointer"
            >
              <span>📜</span>
              <span>History</span>
            </button>
          </div>
        </header>
      )}

      {/* MAIN CONTENT VIEWS */}
      <div className="flex-1 flex overflow-hidden min-h-0 relative z-10">
        
        {/* EXPLORE TAB */}
        {currentTab === "explore" && (
          <div className="flex-1 overflow-y-auto px-6 py-6 md:px-8 space-y-6 scrollbar-subtle">
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
              <button
                onClick={() => router.push("/?tab=video")}
                className="glass-card glass-card-hover p-5 text-left cursor-pointer group relative overflow-hidden transition-all duration-150 active:scale-[0.98] border border-white/10"
              >
                <div className="w-10 h-10 rounded-2xl bg-[#0070f3]/20 text-[#38bdf8] border border-[#0070f3]/40 flex items-center justify-center mb-3 group-hover:bg-[#0070f3]/30 transition-colors">
                  <FiVideo size={20} />
                </div>
                <h3 className="text-sm font-bold text-white mb-1">Video Studio</h3>
                <p className="text-xs text-slate-400 leading-relaxed">Create video ads with actors and scripts.</p>
              </button>

              {[
                { title: "Avatars", desc: "Browse high-resolution video actors.", icon: FiUser, tab: "avatars" },
                { title: "Product Studio", desc: "Attach and showcase product photos.", icon: FiBox, tab: "video" },
                { title: "My Creations", desc: "Review your generated video media.", icon: FiLayers, tab: "library" }
              ].map((card, i) => (
                <button
                  key={i}
                  onClick={() => router.push(`/?tab=${card.tab}`)}
                  className="glass-card glass-card-hover p-5 text-left cursor-pointer group relative overflow-hidden transition-all duration-150 active:scale-[0.98] border border-white/10"
                >
                  <div className="w-10 h-10 rounded-2xl bg-white/5 text-slate-300 border border-white/10 flex items-center justify-center mb-3 group-hover:text-[#38bdf8] group-hover:border-[#0070f3]/40 transition-colors">
                    <card.icon size={20} />
                  </div>
                  <h3 className="text-sm font-bold text-white mb-1">{card.title}</h3>
                  <p className="text-xs text-slate-400 leading-relaxed">{card.desc}</p>
                </button>
              ))}
            </div>

            {/* Showcase Feed */}
            <div className="space-y-4 pt-2">
              <div className="border-b glass-divider pb-3 flex items-center justify-between">
                <div>
                  <h2 className="text-sm font-bold text-white tracking-wide">Showcase</h2>
                  <p className="text-xs text-slate-400">High-converting AI UGC video ads</p>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-5">
                {MOCK_COMMUNITY.map((item) => (
                  <div
                    key={item.id}
                    onClick={() => {
                      setSelectedExploreVideo(item);
                      setIsExploreMuted(false);
                    }}
                    className="glass-card glass-card-hover aspect-[9/16] overflow-hidden group relative shadow-lg cursor-pointer rounded-2xl border border-white/10"
                  >
                    <video
                      src={item.url}
                      className="w-full h-full object-cover"
                      autoPlay
                      muted
                      loop
                      playsInline
                    />
                    <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/30 to-transparent p-4 flex flex-col justify-end opacity-0 group-hover:opacity-100 transition-opacity duration-150">
                      <p className="text-white text-xs font-semibold leading-snug mb-1">{item.title || item.prompt}</p>
                      <span className="text-[10px] text-slate-300 font-medium flex items-center gap-1">
                        <FiMaximize2 size={12} /> Click to watch with audio
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* AVATARS TAB */}
        {currentTab === "avatars" && (
          <div className="flex-1 overflow-y-auto px-6 py-6 md:px-8 space-y-6 scrollbar-subtle">
            <div className="flex items-center justify-between border-b glass-divider pb-4">
              <div>
                <h2 className="text-lg font-bold text-white">Avatars</h2>
                <p className="text-xs text-slate-400">Select from our curated actors</p>
              </div>
              <button
                onClick={() => router.push("/?tab=video")}
                className="glass-btn-primary px-4 py-2 text-xs cursor-pointer transition-transform active:scale-95"
              >
                Launch Video Studio
              </button>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-5">
              {AVATARS.map((avatar) => (
                <div
                  key={avatar.id}
                  onClick={() => {
                    handleSelectAvatar(avatar);
                    router.push("/?tab=video");
                  }}
                  className="glass-card glass-card-hover aspect-[3/4] overflow-hidden cursor-pointer relative group flex flex-col justify-between p-3 transition-all duration-150 active:scale-[0.98] border border-white/10"
                >
                  <img src={avatar.image} className="absolute inset-0 w-full h-full object-cover rounded-xl" />
                  <div className="relative z-10 flex justify-end">
                    {selectedAvatar?.id === avatar.id && (
                      <span className="w-6 h-6 rounded-full bg-[#0070f3] text-white flex items-center justify-center text-xs shadow-md border border-white/20">
                        <FiCheck />
                      </span>
                    )}
                  </div>
                  <div className="relative z-10 glass-panel p-2 text-center rounded-xl bg-black/70 backdrop-blur-md border border-white/10">
                    <span className="text-xs font-semibold text-white">{avatar.name}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* VIDEO WORKSPACE STUDIO */}
        {currentTab === "video" && (
          <div className="flex-1 overflow-hidden min-h-0 bg-[#0b0b0e]">
            <CreationHub 
              selectedAvatar={selectedAvatar} 
              onOpenAvatarModal={() => setIsAvatarsModalOpen(true)} 
              onOpenPricing={() => setIsPricingModalOpen(true)}
              onNavigateTab={(tab) => router.push(`/?tab=${tab}`)}
              userCredits={session?.user?.credits}
            />
          </div>
        )}

        {/* MY LIBRARY TAB */}
        {currentTab === "library" && (
          <div className="flex-1 overflow-y-auto px-6 py-6 md:px-8 space-y-6 scrollbar-subtle select-none">
            <header className="border-b glass-divider pb-4 flex flex-col sm:flex-row sm:items-end justify-between gap-4">
              <div>
                <h2 className="text-lg font-bold text-white">My Creations</h2>
                <p className="text-xs text-slate-400">Browse and download your generated videos</p>
              </div>
            </header>

            {isLoadingCreations ? (
              <div className="py-24 flex flex-col items-center justify-center gap-3">
                <FiLoader className="text-3xl text-[#38bdf8] animate-spin" />
                <span className="text-xs text-slate-400 animate-pulse">Loading creations...</span>
              </div>
            ) : creations.length === 0 ? (
              <div className="py-24 flex flex-col items-center justify-center text-center space-y-4">
                <div className="w-16 h-16 rounded-2xl glass-card flex items-center justify-center text-slate-400 border border-white/10">
                  <FiVideo size={28} />
                </div>
                <div className="space-y-1">
                  <h3 className="text-sm font-semibold text-white">No creations yet</h3>
                  <p className="text-xs text-slate-400 max-w-sm">Your completed video media will appear here.</p>
                </div>
                <button
                  onClick={() => router.push("/?tab=video")}
                  className="glass-btn-primary px-6 py-2.5 text-xs cursor-pointer transition-transform active:scale-95"
                >
                  Create First Video
                </button>
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-5">
                {creations.map((item) => (
                  <div
                    key={item.id}
                    onClick={() => setSelectedCreation(item)}
                    className="glass-card glass-card-hover aspect-[9/16] overflow-hidden relative cursor-pointer group shadow-lg transition-all duration-150 active:scale-[0.98] border border-white/10"
                  >
                    {item.status?.toLowerCase() === "completed" ? (
                      <video src={item.url} className="w-full h-full object-cover" muted loop playsInline />
                    ) : item.status?.toLowerCase() === "failed" ? (
                      <div className="w-full h-full flex flex-col items-center justify-center p-4 gap-2 text-center bg-red-500/5">
                        <FiAlertCircle className="text-red-400 text-2xl" />
                        <span className="text-xs font-semibold text-red-400">Generation Failed</span>
                      </div>
                    ) : (
                      <div className="w-full h-full flex flex-col items-center justify-center gap-3">
                        <FiClock className="text-2xl text-[#38bdf8] animate-spin" />
                        <span className="text-xs font-semibold text-slate-400 animate-pulse">Processing...</span>
                      </div>
                    )}
                    
                    <div className="absolute inset-0 bg-gradient-to-t from-black/95 via-black/40 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-150 p-4 flex flex-col justify-end pointer-events-none">
                      <p className="text-white text-xs font-semibold leading-snug line-clamp-3 mb-2">{item.prompt}</p>
                      <div className="flex items-center justify-between">
                        <span className="text-[10px] font-medium text-slate-300 uppercase">
                          {item.aspectRatio || "9:16"}
                        </span>
                        <div className="w-8 h-8 rounded-full glass-panel flex items-center justify-center text-white bg-black/60 backdrop-blur-md">
                          <FiMaximize2 size={14} />
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

      </div>

      {/* MODALS */}

      {/* 1. Model Selection Modal */}
      <AnimatePresence>
        {isModelsModalOpen && (
          <div className="fixed inset-0 z-[1000] flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.12 }}
              onClick={() => setIsModelsModalOpen(false)}
              className="absolute inset-0 bg-black/75 backdrop-blur-xl"
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.96 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.96 }}
              transition={{ duration: 0.12 }}
              className="relative w-full max-w-4xl h-[70vh] glass-panel p-6 shadow-2xl flex flex-col overflow-hidden text-white border border-white/10 bg-[#0d0d12]/90 z-10"
            >
              <div className="pb-4 border-b glass-divider flex items-center justify-between">
                <h3 className="text-sm font-bold text-white tracking-wide">Select an AI model</h3>
                <button
                  onClick={() => setIsModelsModalOpen(false)}
                  className="p-1.5 text-slate-400 hover:text-white transition-colors cursor-pointer rounded-lg hover:bg-white/10"
                >
                  <FiX size={18} />
                </button>
              </div>

              <div className="flex-1 py-5 overflow-y-auto scrollbar-subtle">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {MODELS.map((model) => (
                    <div
                      key={model.id}
                      onClick={() => {
                        setSelectedModel(model);
                        setIsModelsModalOpen(false);
                      }}
                      className={`glass-card p-4 cursor-pointer space-y-3 flex flex-col justify-between transition-all duration-150 active:scale-[0.98] border border-white/10 ${selectedModel.id === model.id ? "border-[#0070f3] bg-[#0070f3]/20 shadow-[0_4px_20px_rgba(0,112,243,0.3)]" : "hover:border-white/20"}`}
                    >
                      <div className="space-y-2">
                        <div className="flex items-center justify-between">
                          <span className="text-xs font-bold text-white">{model.name}</span>
                        </div>
                        <p className="text-xs text-slate-400 leading-relaxed">{model.description}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* 2. Avatars Modal */}
      <AnimatePresence>
        {isAvatarsModalOpen && (
          <div className="fixed inset-0 z-[1000] flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.12 }}
              onClick={() => setIsAvatarsModalOpen(false)}
              className="absolute inset-0 bg-black/75 backdrop-blur-xl"
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.96 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.96 }}
              transition={{ duration: 0.12 }}
              className="relative w-full max-w-3xl h-[75vh] glass-panel p-6 shadow-2xl flex flex-col overflow-hidden text-white border border-white/10 bg-[#0d0d12]/90 z-10"
            >
              <div className="pb-4 border-b glass-divider flex items-center justify-between">
                <div>
                  <h3 className="text-sm font-bold text-white tracking-wide">Select Avatar</h3>
                  <p className="text-xs text-slate-400">Select from our curated avatars</p>
                </div>
                <button
                  onClick={() => setIsAvatarsModalOpen(false)}
                  className="p-1.5 text-slate-400 hover:text-white transition-colors cursor-pointer rounded-lg hover:bg-white/10"
                >
                  <FiX size={18} />
                </button>
              </div>

              <div className="flex-1 py-5 overflow-y-auto scrollbar-subtle">
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
                  {AVATARS.map((avatar) => {
                    const isSelected = selectedAvatar?.id === avatar.id;
                    return (
                      <div
                        key={avatar.id}
                        onClick={() => handleSelectAvatar(avatar)}
                        className={`glass-card aspect-[3/4] overflow-hidden cursor-pointer relative group flex flex-col justify-between p-3 transition-all duration-150 active:scale-[0.98] border border-white/10 ${isSelected ? "border-[#0070f3] ring-2 ring-[#0070f3]/50" : ""}`}
                      >
                        <img src={avatar.image} className="absolute inset-0 w-full h-full object-cover" />
                        <div className="relative z-10 flex justify-end">
                          {isSelected && (
                            <span className="w-5 h-5 rounded-full bg-[#0070f3] text-white flex items-center justify-center text-[10px] shadow">
                              <FiCheck />
                            </span>
                          )}
                        </div>
                        <div className="relative z-10 glass-panel p-1.5 text-center rounded-xl bg-black/70 backdrop-blur-md border border-white/10">
                          <span className="text-xs font-semibold text-white">{avatar.name}</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* 3. Presets Modal */}
      <AnimatePresence>
        {isPresetsModalOpen && (
          <div className="fixed inset-0 z-[1000] flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.12 }}
              onClick={() => setIsPresetsModalOpen(false)}
              className="absolute inset-0 bg-black/75 backdrop-blur-xl"
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.96 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.96 }}
              transition={{ duration: 0.12 }}
              className="relative w-full max-w-4xl h-[80vh] glass-panel p-6 shadow-2xl flex flex-col overflow-hidden text-white border border-white/10 bg-[#0d0d12]/90 z-10"
            >
              <div className="pb-4 border-b glass-divider flex items-center justify-between">
                <h3 className="text-sm font-bold text-white tracking-wide">Presets</h3>
                <button
                  onClick={() => setIsPresetsModalOpen(false)}
                  className="p-1.5 text-slate-400 hover:text-white transition-colors cursor-pointer rounded-lg hover:bg-white/10"
                >
                  <FiX size={18} />
                </button>
              </div>

              {/* Search & Filter Controls */}
              <div className="py-3 space-y-3">
                <div className="glass-control h-11 flex items-center px-4 gap-3 bg-[#121217] border border-white/10">
                  <FiSearch size={16} className="text-slate-400" />
                  <input
                    type="text"
                    value={presetSearchQuery}
                    onChange={(e) => setPresetSearchQuery(e.target.value)}
                    placeholder="Search presets..."
                    className="w-full bg-transparent border-none outline-none text-xs text-white placeholder-slate-400"
                  />
                </div>

                <div className="flex gap-2 overflow-x-auto scrollbar-subtle pb-1">
                  {categoriesList.map((cat) => (
                    <button
                      key={cat}
                      onClick={() => setPresetCategoryFilter(cat)}
                      className={`px-3 py-1.5 rounded-xl text-xs font-semibold whitespace-nowrap transition-all cursor-pointer ${
                        presetCategoryFilter === cat 
                          ? "bg-[#0070f3] text-white shadow-sm border border-white/20" 
                          : "glass-chip-blue"
                      }`}
                    >
                      {cat}
                    </button>
                  ))}
                </div>
              </div>

              {/* Presets Grid */}
              <div className="flex-1 py-3 overflow-y-auto scrollbar-subtle">
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {filteredPresets.map((preset) => (
                    <div
                      key={preset.id}
                      onClick={() => handleSelectPreset(preset)}
                      className="glass-card glass-card-hover p-4 cursor-pointer flex flex-col justify-between space-y-3 transition-all duration-150 active:scale-[0.98] border border-white/10"
                    >
                      <div className="space-y-2">
                        <div className="flex items-center justify-between">
                          <span className="text-[11px] font-semibold text-[#38bdf8] uppercase tracking-wider">Preset #{preset.code}</span>
                          <span className="glass-chip-blue px-2 py-0.5 text-[10px]">{preset.tag}</span>
                        </div>
                        <h4 className="text-xs font-bold text-white">{preset.name}</h4>
                        <p className="text-xs text-slate-400 leading-relaxed line-clamp-2">{preset.bestFor}</p>
                      </div>

                      <div className="flex items-center justify-between border-t glass-divider pt-2 text-xs text-slate-400">
                        <span>{preset.defaultAspect} • {preset.defaultDuration}s</span>
                        <span className="text-[#38bdf8] font-semibold">Select →</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* 4. Pricing Upgrade Modal */}
      <AnimatePresence>
        {isPricingModalOpen && (
          <div className="fixed inset-0 z-[1000] flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.12 }}
              onClick={() => setIsPricingModalOpen(false)}
              className="absolute inset-0 bg-black/75 backdrop-blur-xl"
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.96 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.96 }}
              transition={{ duration: 0.12 }}
              className="relative w-full max-w-4xl h-[70vh] glass-panel p-6 shadow-2xl flex flex-col overflow-hidden text-white border border-white/10 bg-[#0d0d12]/90 z-10"
            >
              <div className="pb-4 border-b glass-divider flex items-center justify-between">
                <div>
                  <h3 className="text-sm font-bold text-white tracking-wide">Upgrade Plan</h3>
                  <p className="text-xs text-slate-400">Top up balance to generate videos.</p>
                </div>
                <button
                  onClick={() => setIsPricingModalOpen(false)}
                  className="p-1.5 text-slate-400 hover:text-white transition-colors cursor-pointer rounded-lg hover:bg-white/10"
                >
                  <FiX size={18} />
                </button>
              </div>

              <div className="flex-1 py-5 overflow-y-auto scrollbar-subtle flex items-center">
                <div className="grid grid-cols-1 md:grid-cols-4 gap-4 w-full">
                  {PRICING_PLANS.map((plan) => (
                    <div
                      key={plan.id}
                      className={`glass-card p-5 flex flex-col justify-between gap-4 relative border border-white/10 ${plan.popular ? "border-[#0070f3] shadow-lg shadow-[#0070f3]/20" : ""}`}
                    >
                      {plan.popular && (
                        <span className="glass-chip-blue absolute -top-3 left-1/2 -translate-x-1/2 px-2.5 py-0.5 text-[10px]">
                          Popular
                        </span>
                      )}

                      <div className="space-y-3">
                        <div>
                          <h4 className="text-xs font-semibold uppercase text-slate-400">{plan.name}</h4>
                          <p className="text-2xl font-bold text-white mt-1">{plan.price}</p>
                        </div>
                        
                        <div className="glass-chip-blue py-1.5 text-center text-xs font-semibold">
                          {plan.credits} Credits
                        </div>

                        <p className="text-xs text-slate-400 leading-relaxed min-h-[2.5rem]">
                          {plan.description}
                        </p>
                      </div>

                      <button
                        onClick={() => handleCheckoutPlan(plan.id)}
                        disabled={loadingCheckoutPlan !== null}
                        className={`w-full py-2 rounded-xl text-xs font-semibold cursor-pointer transition-transform active:scale-95 ${plan.popular ? "glass-btn-primary" : "glass-btn-secondary"}`}
                      >
                        {loadingCheckoutPlan === plan.id ? "Loading..." : "Purchase"}
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* 5. Creation Detail View Modal */}
      <AnimatePresence>
        {selectedCreation && (
          <div className="fixed inset-0 z-[1000] flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.12 }}
              onClick={() => setSelectedCreation(null)}
              className="absolute inset-0 bg-black/75 backdrop-blur-xl"
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.96 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.96 }}
              transition={{ duration: 0.12 }}
              className="relative w-full max-w-lg glass-panel p-6 shadow-2xl overflow-hidden flex flex-col justify-between text-white border border-white/10 bg-[#0d0d12]/90 z-10"
            >
              <div className="pb-3 border-b glass-divider flex items-center justify-between">
                <span className="text-xs font-semibold uppercase text-slate-400">Creation Detail</span>
                <button
                  onClick={() => setSelectedCreation(null)}
                  className="p-1.5 text-slate-400 hover:text-white transition-colors cursor-pointer rounded-lg hover:bg-white/10"
                >
                  <FiX size={18} />
                </button>
              </div>

              <div className="w-full aspect-[9/16] max-h-[55vh] my-4 glass-card overflow-hidden flex items-center justify-center relative border border-white/10">
                {selectedCreation.status === "completed" && selectedCreation.url ? (
                  <video
                    key={selectedCreation.url}
                    className="w-full h-full object-cover"
                    controls
                    autoPlay
                    loop
                    playsInline
                  >
                    <source src={selectedCreation.url} type="video/mp4" />
                  </video>
                ) : selectedCreation.status === "failed" ? (
                  <div className="text-center space-y-2 p-6">
                    <FiAlertCircle size={32} className="text-red-400 mx-auto" />
                    <p className="text-xs font-bold text-red-400">Generation Failed</p>
                    <p className="text-xs text-slate-400">{selectedCreation.error || "An error occurred."}</p>
                  </div>
                ) : (
                  <div className="text-center space-y-3 p-6">
                    <FiClock size={32} className="text-[#38bdf8] mx-auto animate-spin" />
                    <p className="text-xs font-bold text-[#38bdf8]">Processing</p>
                  </div>
                )}
              </div>

              <div className="space-y-3 border-t glass-divider pt-3">
                <p className="text-xs font-semibold text-white line-clamp-2">"{selectedCreation.prompt}"</p>
                <div className="flex items-center justify-between text-xs text-slate-400">
                  <span>Model: {selectedCreation.modelId || "Generic"}</span>
                  {selectedCreation.status === "completed" && selectedCreation.url && (
                    <a
                      href={`/api/creations/${selectedCreation.id}/download`}
                      download={`lembda-${selectedCreation.id}.mp4`}
                      className="text-[#38bdf8] font-semibold flex items-center gap-1 hover:underline"
                    >
                      <FiDownload size={14} />
                      <span>Download</span>
                    </a>
                  )}
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* EXPLORE VIDEO DETAIL MODAL (Clean minimal popup) */}
      <AnimatePresence>
        {selectedExploreVideo && (
          <div 
            onClick={() => setSelectedExploreVideo(null)}
            className="fixed inset-0 z-[1000] flex items-center justify-center p-4 bg-black/85 backdrop-blur-xl"
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              onClick={(e) => e.stopPropagation()}
              className="relative p-2 flex flex-col items-center justify-center max-h-[92vh] overflow-hidden rounded-[24px]"
            >
              <button
                onClick={() => setSelectedExploreVideo(null)}
                className="absolute top-4 right-4 z-20 w-9 h-9 rounded-full bg-black/70 hover:bg-black/90 text-white border border-white/20 flex items-center justify-center cursor-pointer transition-all duration-150 shadow-lg"
              >
                <FiX size={18} />
              </button>

              <div className="relative aspect-[9/16] h-[82vh] max-w-sm mx-auto rounded-[20px] overflow-hidden bg-black shadow-2xl border border-white/10 flex items-center justify-center">
                <video
                  src={selectedExploreVideo.url}
                  className="w-full h-full object-contain"
                  autoPlay
                  loop
                  playsInline
                  controls
                />
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

    </div>
  );
}

export default function Home() {
  return (
    <Suspense fallback={
      <div className="h-full w-full flex flex-col items-center justify-center gap-3 text-white">
        <div className="w-10 h-10 border-3 border-[#0070f3] border-t-transparent rounded-full animate-spin" />
      </div>
    }>
      <HomeContent />
    </Suspense>
  );
}
