"use client";

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
  FiBox,
  FiStar,
  FiEdit2
} from "react-icons/fi";
import { FaCoins } from "react-icons/fa";
import { useEffect, useState, useRef, Suspense } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useRouter, useSearchParams } from "next/navigation";
import toast, { Toaster } from "react-hot-toast";
import { PRESETS_LIBRARY } from "@/lib/presetsData";
import CreationHub from "@/components/creation/CreationHub";
import LazyVideo from "@/components/LazyVideo";
import { useAppAccount } from "@/components/AppAccountProvider";
import { navigateAppView } from "@/lib/app/app-navigation";
import { PLAN_BY_CODE, PURCHASE_PLAN_CODES } from "@/lib/entitlements/plan-catalog";

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

const FEATURED_MODES = [
  {
    id: "video-studio",
    title: "Video Studio →",
    badge: "UGC Video Engine",
    cover: "/studios/video_studio.jpg",
    tab: "video",
    studio: "video_maker",
    desc: "Turn scripts & photos into high-converting video ads."
  },
  {
    id: "image-maker",
    title: "Image Studio →",
    badge: "AI Avatars & Visuals",
    cover: "/avatars/Andrew E1.png",
    tab: "images",
    href: "/app/images",
    desc: "Create high-resolution images from a prompt or reference."
  },
  {
    id: "product-ad",
    title: "Product Ad →",
    badge: "E-Commerce Studio",
    cover: "/studios/product_studio.jpg",
    tab: "video",
    studio: "product",
    desc: "Studio-grade product commercials & showcases."
  },
  {
    id: "app-studio",
    title: "App Studio →",
    badge: "SaaS & App Walkthrough",
    cover: "/studios/app_studio.jpg",
    tab: "video",
    studio: "app",
    desc: "Engaging product walkthroughs & app promos."
  }
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

const PRICING_PLANS = PURCHASE_PLAN_CODES.map((code) => PLAN_BY_CODE[code]);

function calculateScriptDuration(text) {
  if (!text || !text.trim()) return 5;
  const words = text.trim().split(/\s+/).filter(Boolean).length;
  if (words <= 15) return 5;
  if (words <= 25) return 8;
  if (words <= 35) return 12;
  return 15;
}

function HomeContent() {
  const { account } = useAppAccount();
  const searchParams = useSearchParams();
  const router = useRouter();
  
  const currentTab = searchParams.get("tab") || "explore";
  const currentStudio = searchParams.get("studio") || "video_maker";
  const navigateToTab = (tab, studio) => {
    navigateAppView({ tab, studio });
  };
  
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
  const [libraryFilters, setLibraryFilters] = useState({ type: "all", model: "all", status: "all", date: "all", favorites: false });
  const [editingCreationTitle, setEditingCreationTitle] = useState("");
  const [isSavingCreationMetadata, setIsSavingCreationMetadata] = useState(false);
  
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
  const [selectedExploreVideo, setSelectedExploreVideo] = useState(null);
  
  const isSubmittingRef = useRef(false);
  const hasLoadedLibraryCreations = useRef(false);

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
    // Explore, Avatars, and the Studio do not render this collection. Defer
    // its separately-authorized API request until Library is actually opened.
    if (currentTab !== "library") return;
    if (hasLoadedLibraryCreations.current && !lastGeneration) return;
    hasLoadedLibraryCreations.current = true;
    fetchCreations();
  }, [currentTab, lastGeneration]);

  const updateCreationMetadata = async (id, changes) => {
    setIsSavingCreationMetadata(true);
    try {
      const response = await fetch("/api/creations", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, ...changes })
      });
      const updated = await response.json();
      if (!response.ok) throw new Error(updated.error || "Could not update creation");
      setCreations((items) => items.map((item) => item.id === id ? { ...item, ...updated } : item));
      setSelectedCreation((item) => item?.id === id ? { ...item, ...updated } : item);
      return updated;
    } catch (error) {
      toast.error(error.message || "Could not save creation details");
      return null;
    } finally {
      setIsSavingCreationMetadata(false);
    }
  };

  const libraryFilterOptions = {
    types: [...new Set(creations.map((item) => item.generationType).filter(Boolean))],
    models: [...new Set(creations.map((item) => item.modelId).filter(Boolean))],
    statuses: [...new Set(creations.map((item) => item.status).filter(Boolean))]
  };
  const filteredCreations = creations.filter((item) => {
    const search = searchQuery.trim().toLowerCase();
    const matchesSearch = !search || [item.title, item.prompt, item.spokenScript, item.modelId, item.generationType]
      .filter(Boolean).some((value) => value.toLowerCase().includes(search));
    const matchesType = libraryFilters.type === "all" || item.generationType === libraryFilters.type;
    const matchesModel = libraryFilters.model === "all" || item.modelId === libraryFilters.model;
    const matchesStatus = libraryFilters.status === "all" || item.status === libraryFilters.status;
    const createdAt = new Date(item.createdAt);
    const now = new Date();
    const ageDays = (now - createdAt) / 86400000;
    const matchesDate = libraryFilters.date === "all"
      || (libraryFilters.date === "week" && ageDays <= 7)
      || (libraryFilters.date === "month" && ageDays <= 30)
      || (libraryFilters.date === "today" && createdAt.toDateString() === now.toDateString());
    return matchesSearch && matchesType && matchesModel && matchesStatus && matchesDate && (!libraryFilters.favorites || item.isFavorite);
  });

  const handleSelectAvatar = async (avatar) => {
    setSelectedAvatar(avatar);
    setIsAvatarsModalOpen(false);
  };

  const handleCheckoutPlan = async (planId) => {
    setLoadingCheckoutPlan(planId);
    try {
      const res = await fetch("/api/checkout/polar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ planCode: planId }),
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

  return (
    <div className="h-full w-full flex flex-col overflow-hidden relative font-sans text-[#111111] bg-[#FAF8ED]">
      <Toaster 
        position="top-right" 
        toastOptions={{ 
          duration: 2500,
          style: { 
            background: '#FFFFFF', 
            color: '#111111', 
            border: '1px solid rgba(17, 17, 17, 0.15)',
            borderRadius: '9999px',
            boxShadow: '0 8px 30px rgba(17, 17, 17, 0.08)'
          } 
        }} 
      />

      {/* FLOATING TOP HEADER FOR NON-STUDIO TABS */}
      {currentTab !== "video" && (
        <header className="absolute right-3 top-3 z-30 max-w-[calc(100%-1.5rem)] pointer-events-auto sm:right-6 sm:top-4">
          <div className="flex max-w-full flex-wrap justify-end gap-2">
            <button
              onClick={() => setIsPricingModalOpen(true)}
              className="bg-[#E6D9FF] hover:bg-[#DBCBFF] text-[#111111] border border-[#111111] font-semibold text-sm px-4.5 py-2.5 rounded-full flex items-center gap-2 shadow-sm transition-all active:scale-95 cursor-pointer"
            >
              <FiZap size={15} />
              <span>Upgrade</span>
              <span className="hidden bg-[#064E3B] text-white text-xs font-bold px-2 py-0.5 rounded-full sm:inline-block">
                30% OFF
              </span>
            </button>

            <div className="bg-white border border-[#111111]/15 px-4 py-2.5 rounded-full flex items-center gap-2 text-sm font-semibold text-[#111111] shadow-sm">
              <span className="text-[#111111]">💎</span>
              <span>{account?.credits ?? "—"} credits</span>
            </div>

            <button
              onClick={() => navigateToTab("explore")}
              className="bg-white hover:bg-[#F2EFE5] border border-[#111111]/15 text-[#55534E] hover:text-[#111111] font-semibold text-sm px-4.5 py-2.5 rounded-full flex items-center gap-2 transition-colors cursor-pointer shadow-sm"
            >
              <span>🌐</span>
              <span className="hidden sm:inline">Community</span>
            </button>

            <button
              onClick={() => navigateToTab("library")}
              className="bg-white hover:bg-[#F2EFE5] border border-[#111111]/15 text-[#55534E] hover:text-[#111111] font-semibold text-sm px-4.5 py-2.5 rounded-full flex items-center gap-2 transition-colors cursor-pointer shadow-sm"
            >
              <span>📜</span>
              <span className="hidden sm:inline">My Library</span>
            </button>
          </div>
        </header>
      )}

      {/* MAIN CONTENT VIEWS */}
      <div className="flex-1 flex overflow-hidden min-h-0 relative z-10">
        
        {/* EXPLORE TAB (WISPR FLOW DESIGN LANGUAGE) */}
        {currentTab === "explore" && (
          <div className="flex-1 overflow-y-auto px-3 py-6 md:px-5 space-y-12 scrollbar-subtle relative w-full">
            
            {/* 1. TOP SECTION: FEATURED MODE CARDS GRID */}
            <div className="space-y-5 w-full">
              <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-2 border-b border-[#111111]/10 pb-3">
                <div>
                  <span className="text-xs font-bold tracking-[0.2em] uppercase text-[#77746D]">
                    CREATION MODES
                  </span>
                  <h2 className="text-2xl sm:text-3xl font-serif font-bold text-[#111111] tracking-tight">
                    Featured Studio Modes
                  </h2>
                </div>
                <p className="text-sm text-[#55534E] font-medium">
                  Select a studio mode to generate AI videos
                </p>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-6">
                {FEATURED_MODES.map((mode) => {
                  const isComingSoon = mode.comingSoon;
                  return (
                    <div
                      key={mode.id}
                      onClick={() => {
                        if (!isComingSoon) { if (mode.href) router.push(mode.href); else navigateToTab(mode.tab, mode.studio); }
                      }}
                      className={`relative h-80 sm:h-96 md:h-[400px] rounded-2xl md:rounded-[28px] border border-[#111111]/15 overflow-hidden group shadow-sm bg-white flex flex-col justify-between transition-all duration-300 ${
                        isComingSoon 
                          ? "cursor-not-allowed select-none" 
                          : "cursor-pointer hover:shadow-xl hover:border-[#111111]/35 active:scale-[0.98]"
                      }`}
                    >
                      {/* Cover Image */}
                      <img
                        src={mode.cover}
                        alt={mode.title}
                        className={`absolute inset-0 w-full h-full object-cover transition-transform duration-500 ease-out ${
                          isComingSoon ? "grayscale-[15%]" : "group-hover:scale-105"
                        }`}
                      />

                      {/* Dark Gradient Overlay */}
                      <div className="absolute inset-0 bg-gradient-to-t from-black/95 via-black/40 to-black/10" />

                      {/* Top Badges */}
                      <div className="relative z-10 p-4 sm:p-5 flex flex-wrap items-center justify-between gap-1.5">
                        <span className="inline-block text-xs sm:text-sm font-semibold text-white/90 bg-black/50 backdrop-blur-md px-3.5 py-1.5 rounded-full border border-white/20 shadow-sm">
                          {mode.badge}
                        </span>
                        {isComingSoon && (
                          <span className="inline-block text-xs font-bold text-[#111111] bg-[#E6D9FF] px-3 py-1 rounded-full border border-[#111111] shadow-md uppercase tracking-wider">
                            Coming Soon
                          </span>
                        )}
                      </div>

                      {/* Bottom White Serif Title */}
                      <div className="relative z-10 p-5 sm:p-6">
                        <h3 className={`font-serif text-2xl sm:text-3xl md:text-[32px] font-bold text-white tracking-tight flex items-center justify-between gap-1 transition-transform duration-200 leading-tight ${
                          isComingSoon ? "" : "group-hover:translate-x-1.5"
                        }`}>
                          <span>{mode.title}</span>
                          {isComingSoon && (
                            <span className="text-xs font-sans font-semibold text-white/70 bg-white/20 backdrop-blur-sm px-2.5 py-1 rounded-full border border-white/20">
                              Soon
                            </span>
                          )}
                        </h3>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* 2. BOTTOM SECTION: COMMUNITY SHOWCASE GRID */}
            <div className="space-y-5 w-full pt-4">
              <div className="space-y-1.5 border-b border-[#111111]/10 pb-4">
                <h2 className="text-2xl sm:text-3xl font-serif font-extrabold tracking-widest text-[#111111] uppercase">
                  COMMUNITY
                </h2>
                <p className="text-sm sm:text-base text-[#55534E] font-medium">
                  Images and videos from our community
                </p>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-5 sm:gap-6">
                {MOCK_COMMUNITY.map((item) => (
                  <div
                    key={item.id}
                    onClick={() => setSelectedExploreVideo(item)}
                    className="bg-white aspect-[9/16] overflow-hidden group relative shadow-sm cursor-pointer rounded-2xl md:rounded-3xl border border-[#111111]/15 hover:border-[#111111]/35 hover:shadow-xl transition-all duration-200"
                  >
                    <LazyVideo
                      src={item.url}
                      className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500 ease-out"
                      autoPlay
                    />

                    {/* Dark Gradient Overlay */}
                    <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/35 to-transparent p-5 flex flex-col justify-end opacity-90 group-hover:opacity-100 transition-opacity duration-200">
                      <h4 className="text-white text-xl sm:text-2xl font-serif font-bold leading-tight mb-3">
                        {item.title || item.prompt}
                      </h4>
                      <div className="flex items-center justify-between text-xs text-white/90 font-medium pt-2 border-t border-white/20">
                        <span className="flex items-center gap-1.5 bg-white/20 backdrop-blur-md px-3 py-1 rounded-full text-xs font-semibold text-white">
                          <FiMaximize2 size={13} /> Watch Video
                        </span>
                        <span className="text-xs uppercase font-bold tracking-wider text-white/70">
                          {item.aspect || "9:16"}
                        </span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* AVATARS TAB */}
        {currentTab === "avatars" && (
          <div className="flex-1 overflow-y-auto px-6 py-8 md:px-12 space-y-8 scrollbar-subtle">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-[#111111]/10 pb-5">
              <div>
                <h2 className="text-2xl sm:text-3xl font-serif font-bold text-[#111111]">AI Avatars</h2>
                <p className="text-sm sm:text-base text-[#55534E] mt-0.5">Select from our realistic video avatars</p>
              </div>
              <button
                onClick={() => navigateToTab("video", "video_maker")}
                className="bg-[#E6D9FF] text-[#111111] border border-[#111111] px-6 py-2.5 rounded-full text-sm font-semibold hover:bg-[#DBCBFF] cursor-pointer transition-colors shadow-sm self-start sm:self-auto"
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
                    navigateToTab("video", "video_maker");
                  }}
                  className="bg-white aspect-[3/4] overflow-hidden cursor-pointer relative group flex flex-col justify-between p-3 rounded-2xl md:rounded-3xl border border-[#111111]/15 shadow-sm hover:border-[#111111]/30 hover:shadow-md transition-all duration-200 active:scale-[0.98]"
                >
                  <img src={avatar.image} alt={avatar.name} loading="lazy" decoding="async" className="absolute inset-0 w-full h-full object-cover rounded-xl md:rounded-2xl" />
                  <div className="relative z-10 flex justify-end">
                    {selectedAvatar?.id === avatar.id && (
                      <span className="w-7 h-7 rounded-full bg-[#064E3B] text-white flex items-center justify-center text-xs shadow-md">
                        <FiCheck size={16} />
                      </span>
                    )}
                  </div>
                  <div className="relative z-10 p-2.5 text-center rounded-xl md:rounded-2xl bg-white/95 backdrop-blur-md border border-[#111111]/15 shadow-sm">
                    <span className="text-sm font-semibold text-[#111111]">{avatar.name}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* VIDEO WORKSPACE STUDIO */}
        {currentTab === "video" && (
          <div className="flex-1 overflow-hidden min-h-0 bg-[#FAF8ED]">
            <CreationHub 
              selectedAvatar={selectedAvatar} 
              onOpenAvatarModal={() => setIsAvatarsModalOpen(true)} 
              onOpenPricing={() => setIsPricingModalOpen(true)}
              onNavigateTab={navigateToTab}
              studioMode={currentStudio}
              onStudioModeChange={(studio) => navigateToTab("video", studio)}
              userCredits={account?.credits}
            />
          </div>
        )}

        {/* MY LIBRARY TAB */}
        {currentTab === "library" && (
          <div className="flex-1 overflow-y-auto px-6 py-8 md:px-12 space-y-8 scrollbar-subtle select-none">
            <header className="border-b border-[#111111]/10 pb-5 flex flex-col sm:flex-row sm:items-end justify-between gap-4">
              <div>
                <h2 className="text-2xl sm:text-3xl font-serif font-bold text-[#111111]">My Library</h2>
                <p className="text-sm sm:text-base text-[#55534E] mt-0.5">Search, organize, and download your generated images and videos</p>
              </div>
            </header>

            {creations.length > 0 && (
              <section aria-label="Filter creations" className="rounded-2xl border border-[#111111]/10 bg-white p-3 sm:p-4 space-y-3 shadow-sm">
                <div className="flex flex-col lg:flex-row gap-2.5">
                  <label className="relative flex-1 min-w-0">
                    <FiSearch aria-hidden="true" className="absolute left-3 top-1/2 -translate-y-1/2 text-[#77746D]" size={16} />
                    <input
                      value={searchQuery}
                      onChange={(event) => setSearchQuery(event.target.value)}
                      placeholder="Search titles, prompts, models…"
                      className="w-full rounded-xl border border-[#111111]/15 bg-[#FAF8ED] py-2.5 pl-9 pr-3 text-sm outline-none focus:border-[#111111]"
                    />
                  </label>
                  <button
                    type="button"
                    onClick={() => setLibraryFilters((filters) => ({ ...filters, favorites: !filters.favorites }))}
                    aria-pressed={libraryFilters.favorites}
                    className={`inline-flex items-center justify-center gap-1.5 rounded-xl border px-3 py-2.5 text-sm font-semibold transition-colors ${libraryFilters.favorites ? "border-[#111111] bg-[#E6D9FF]" : "border-[#111111]/15 bg-white hover:bg-[#FAF8ED]"}`}
                  >
                    <FiStar size={15} fill={libraryFilters.favorites ? "currentColor" : "none"} /> Favorites
                  </button>
                </div>
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5">
                  {[
                    ["type", "All studios", libraryFilterOptions.types],
                    ["model", "All models", libraryFilterOptions.models],
                    ["status", "All statuses", libraryFilterOptions.statuses],
                    ["date", "Any date", [["today", "Today"], ["week", "Past 7 days"], ["month", "Past 30 days"]]]
                  ].map(([key, placeholder, options]) => (
                    <label key={key} className="sr-only">
                      {placeholder}
                      <select
                        value={libraryFilters[key]}
                        onChange={(event) => setLibraryFilters((filters) => ({ ...filters, [key]: event.target.value }))}
                        className="not-sr-only w-full rounded-xl border border-[#111111]/15 bg-white px-3 py-2.5 text-sm text-[#33312C] outline-none focus:border-[#111111]"
                      >
                        <option value="all">{placeholder}</option>
                        {options.map((option) => {
                          const [value, label] = Array.isArray(option) ? option : [option, option];
                          return <option key={value} value={value}>{label.replaceAll("_", " ")}</option>;
                        })}
                      </select>
                    </label>
                  ))}
                </div>
                <p className="text-xs text-[#77746D]">Showing {filteredCreations.length} of {creations.length} creation{creations.length === 1 ? "" : "s"}</p>
              </section>
            )}

            {isLoadingCreations ? (
              <div className="py-24 flex flex-col items-center justify-center gap-3">
                <FiLoader className="text-3xl text-[#111111] animate-spin" />
                <span className="text-sm text-[#55534E] font-medium animate-pulse">Loading creations...</span>
              </div>
            ) : creations.length === 0 ? (
              <div className="py-24 flex flex-col items-center justify-center text-center space-y-4">
                <div className="w-16 h-16 rounded-2xl bg-white flex items-center justify-center text-[#55534E] border border-[#111111]/15 shadow-sm">
                  <FiVideo size={28} />
                </div>
                <div className="space-y-1">
                  <h3 className="text-lg font-serif font-bold text-[#111111]">No creations yet</h3>
                  <p className="text-sm text-[#55534E] max-w-sm">Your completed images and videos will appear here.</p>
                </div>
                <button
                  onClick={() => navigateToTab("video", "video_maker")}
                  className="bg-[#E6D9FF] text-[#111111] border border-[#111111] px-6 py-3 rounded-full text-sm font-semibold hover:bg-[#DBCBFF] cursor-pointer shadow-sm transition-colors"
                >
                  Open Video Studio
                </button>
              </div>
            ) : filteredCreations.length === 0 ? (
              <div className="py-20 flex flex-col items-center justify-center text-center space-y-3">
                <FiSearch size={28} className="text-[#77746D]" />
                <div>
                  <h3 className="text-lg font-serif font-bold text-[#111111]">No matching creations</h3>
                  <p className="text-sm text-[#55534E]">Try a different search or clear one of the filters.</p>
                </div>
                <button type="button" onClick={() => { setSearchQuery(""); setLibraryFilters({ type: "all", model: "all", status: "all", date: "all", favorites: false }); }} className="text-sm font-semibold underline">Clear filters</button>
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-5 sm:gap-6">
                {filteredCreations.map((item) => (
                  <div
                    key={item.id}
                    onClick={() => { setSelectedCreation(item); setEditingCreationTitle(item.title || ""); }}
                    className={`bg-white overflow-hidden relative cursor-pointer group shadow-sm rounded-2xl md:rounded-3xl border border-[#111111]/15 hover:border-[#111111]/35 hover:shadow-lg transition-all ${item.mediaType === "image" ? "aspect-square" : "aspect-[9/16]"}`}
                  >
                    {item.status?.toLowerCase() === "completed" ? (
                      item.mediaType === "image" ? (
                        <img src={item.url} alt={item.prompt || item.title || "Generated image"} loading="lazy" decoding="async" className="w-full h-full object-cover" />
                      ) : item.url ? (
                        <LazyVideo src={item.url} className="w-full h-full object-cover" />
                      ) : (
                        <div className="w-full h-full flex flex-col items-center justify-center gap-2 bg-[#FAF8ED] text-center p-4"><FiAlertCircle className="text-[#77746D] text-2xl" /><span className="text-xs font-semibold text-[#55534E]">Media preview unavailable</span></div>
                      )
                    ) : item.status?.toLowerCase() === "failed" ? (
                      <div className="w-full h-full flex flex-col items-center justify-center p-4 gap-2 text-center bg-red-50">
                        <FiAlertCircle className="text-red-600 text-2xl" />
                        <span className="text-xs font-semibold text-red-600">Generation Failed</span>
                      </div>
                    ) : (
                      <div className="w-full h-full flex flex-col items-center justify-center gap-3 bg-[#FAF8ED]">
                        <FiClock className="text-2xl text-[#111111] animate-spin" />
                        <span className="text-xs font-semibold text-[#55534E] animate-pulse">Processing...</span>
                      </div>
                    )}

                    <button
                      type="button"
                      aria-label={item.isFavorite ? "Remove from favorites" : "Add to favorites"}
                      onClick={(event) => { event.stopPropagation(); void updateCreationMetadata(item.id, { isFavorite: !item.isFavorite }); }}
                      className="absolute right-3 top-3 z-10 rounded-full bg-white/90 p-2 text-[#111111] shadow-sm transition-transform hover:scale-110"
                    >
                      <FiStar size={15} fill={item.isFavorite ? "#E6B800" : "none"} className={item.isFavorite ? "text-[#C99800]" : ""} />
                    </button>
                    
                    <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/30 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-200 p-4 flex flex-col justify-end pointer-events-none">
                      <p className="text-white text-sm font-semibold leading-snug line-clamp-2 mb-1">{item.title || item.prompt}</p>
                      {item.title && <p className="text-white/75 text-xs leading-snug line-clamp-2 mb-2">{item.prompt}</p>}
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-semibold text-slate-200 uppercase tracking-wider">
                          {item.mediaType === "image" ? `${item.imageCount > 1 ? `${item.imageCount} images · ` : ""}${item.resolution || item.aspectRatio || "Image"}` : item.aspectRatio || "9:16"}
                        </span>
                        <div className="w-9 h-9 rounded-full bg-white/90 flex items-center justify-center text-[#111111] shadow-sm">
                          <FiMaximize2 size={15} />
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

      {/* WISPR FLOW MODALS */}

      {/* 1. Avatars Modal */}
      <AnimatePresence>
        {isAvatarsModalOpen && (
          <div className="fixed inset-0 z-[1000] flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setIsAvatarsModalOpen(false)}
              className="absolute inset-0 bg-[#111111]/40 backdrop-blur-md"
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.96 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.96 }}
              className="relative w-full max-w-3xl h-[75vh] bg-[#FAF8ED] rounded-3xl p-6 sm:p-8 shadow-2xl flex flex-col overflow-hidden text-[#111111] border border-[#111111]/20 z-10"
            >
              <div className="pb-4 border-b border-[#111111]/10 flex items-center justify-between">
                <div>
                  <h3 className="text-xl font-serif font-bold text-[#111111]">Select AI Avatar</h3>
                  <p className="text-sm text-[#55534E] mt-0.5">Select from our curated realistic avatars</p>
                </div>
                <button
                  onClick={() => setIsAvatarsModalOpen(false)}
                  className="p-2 text-[#55534E] hover:text-[#111111] transition-colors cursor-pointer rounded-full hover:bg-black/5"
                >
                  <FiX size={20} />
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
                        className={`bg-white aspect-[3/4] overflow-hidden cursor-pointer relative group flex flex-col justify-between p-3 rounded-2xl border border-[#111111]/15 transition-all duration-150 active:scale-[0.98] ${isSelected ? "border-[#111111] ring-2 ring-[#111111]" : "hover:border-[#111111]/30"}`}
                      >
                        <img src={avatar.image} alt={avatar.name} loading="lazy" decoding="async" className="absolute inset-0 w-full h-full object-cover rounded-xl" />
                        <div className="relative z-10 flex justify-end">
                          {isSelected && (
                            <span className="w-6 h-6 rounded-full bg-[#064E3B] text-white flex items-center justify-center text-xs shadow">
                              <FiCheck size={14} />
                            </span>
                          )}
                        </div>
                        <div className="relative z-10 p-2 text-center rounded-xl bg-white/95 backdrop-blur-md border border-[#111111]/15">
                          <span className="text-sm font-semibold text-[#111111]">{avatar.name}</span>
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

      {/* 2. Pricing Upgrade Modal */}
      <AnimatePresence>
        {isPricingModalOpen && (
          <div className="fixed inset-0 z-[1000] flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setIsPricingModalOpen(false)}
              className="absolute inset-0 bg-[#111111]/40 backdrop-blur-md"
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.96 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.96 }}
              className="relative w-full max-w-4xl h-[75vh] bg-[#FAF8ED] rounded-3xl p-6 sm:p-8 shadow-2xl flex flex-col overflow-hidden text-[#111111] border border-[#111111]/20 z-10"
            >
              <div className="pb-4 border-b border-[#111111]/10 flex items-center justify-between">
                <div>
                  <h3 className="text-xl sm:text-2xl font-serif font-bold text-[#111111]">Upgrade Plan</h3>
                  <p className="text-sm text-[#55534E] mt-0.5">Top up balance to generate high-fidelity videos.</p>
                </div>
                <button
                  onClick={() => setIsPricingModalOpen(false)}
                  className="p-2 text-[#55534E] hover:text-[#111111] transition-colors cursor-pointer rounded-full hover:bg-black/5"
                >
                  <FiX size={20} />
                </button>
              </div>

              <div className="flex-1 py-6 overflow-y-auto scrollbar-subtle flex items-center">
                <div className="grid grid-cols-1 md:grid-cols-4 gap-5 w-full">
                  {PRICING_PLANS.map((plan) => (
                    <div
                      key={plan.code}
                      className={`bg-white p-5 sm:p-6 rounded-2xl md:rounded-3xl flex flex-col justify-between gap-4 relative border border-[#111111]/15 ${plan.popular ? "border-[#111111] ring-2 ring-[#111111]/20 shadow-md" : ""}`}
                    >
                      {plan.popular && (
                        <span className="bg-[#064E3B] text-white absolute -top-3 left-1/2 -translate-x-1/2 px-3.5 py-0.5 rounded-full text-xs font-semibold shadow-sm">
                          Popular
                        </span>
                      )}

                      <div className="space-y-3">
                        <div>
                          <h4 className="text-xs font-bold uppercase tracking-wider text-[#77746D]">{plan.name}</h4>
                          <p className="text-3xl font-serif font-bold text-[#111111] mt-1">{plan.price}</p>
                        </div>
                        
                        <div className="bg-[#E6D9FF] text-[#111111] py-1.5 text-center text-xs font-semibold rounded-full border border-[#111111]/20">
                          {plan.credits.toLocaleString()} credits
                        </div>

                        <p className="text-xs sm:text-sm text-[#55534E] leading-relaxed min-h-[2.5rem]">
                          {plan.cadence}. Credits roll over.
                        </p>
                      </div>

                      <button
                        onClick={() => handleCheckoutPlan(plan.code)}
                        disabled={loadingCheckoutPlan !== null}
                        className={`w-full py-3 rounded-full text-sm font-semibold cursor-pointer transition-transform active:scale-95 ${plan.popular ? "bg-[#E6D9FF] text-[#111111] border border-[#111111] hover:bg-[#DBCBFF]" : "bg-[#FAF8ED] text-[#111111] border border-[#111111]/20 hover:bg-[#EFECE1]"}`}
                      >
                        {loadingCheckoutPlan === plan.code ? "Opening…" : "Choose plan"}
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* 3. Creation Detail View Modal */}
      <AnimatePresence>
        {selectedCreation && (
          <div className="fixed inset-0 z-[1000] flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setSelectedCreation(null)}
              className="absolute inset-0 bg-[#111111]/40 backdrop-blur-md"
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.96 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.96 }}
              className="relative w-full max-w-lg bg-white rounded-3xl p-6 shadow-2xl overflow-hidden flex flex-col justify-between text-[#111111] border border-[#111111]/20 z-10"
            >
              <div className="pb-3 border-b border-[#111111]/10 flex items-center justify-between">
                <span className="text-xs font-bold uppercase tracking-wider text-[#77746D]">Creation Detail</span>
                <button
                  onClick={() => setSelectedCreation(null)}
                  className="p-1.5 text-[#55534E] hover:text-[#111111] transition-colors cursor-pointer rounded-full hover:bg-[#EFECE1]"
                >
                  <FiX size={20} />
                </button>
              </div>

              <div className={`w-full ${selectedCreation.mediaType === "image" ? "aspect-square" : "aspect-[9/16]"} max-h-[55vh] my-4 bg-black rounded-2xl overflow-hidden flex items-center justify-center relative border border-[#111111]/20`}>
                {selectedCreation.status?.toLowerCase() === "completed" && selectedCreation.url ? (
                  selectedCreation.mediaType === "image" ? (
                    <img src={selectedCreation.url} alt={selectedCreation.prompt || selectedCreation.title || "Generated image"} className="w-full h-full object-contain" />
                  ) : (
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
                  )
                ) : (
                  <div className="text-center space-y-2 p-6 text-white">
                    <FiClock size={32} className="mx-auto animate-spin" />
                    <p className="text-sm font-bold">Processing creation</p>
                  </div>
                )}
              </div>

              <div className="space-y-3 border-t border-[#111111]/10 pt-3">
                <div className="flex gap-2">
                  <label className="sr-only" htmlFor="creation-title">Creation title</label>
                  <input
                    id="creation-title"
                    value={editingCreationTitle}
                    onChange={(event) => setEditingCreationTitle(event.target.value)}
                    maxLength={120}
                    placeholder="Add a title"
                    className="min-w-0 flex-1 rounded-xl border border-[#111111]/15 bg-[#FAF8ED] px-3 py-2 text-sm font-semibold outline-none focus:border-[#111111]"
                  />
                  <button
                    type="button"
                    disabled={isSavingCreationMetadata || editingCreationTitle.trim() === (selectedCreation.title || "")}
                    onClick={() => void updateCreationMetadata(selectedCreation.id, { title: editingCreationTitle.trim() || null })}
                    className="rounded-xl border border-[#111111] bg-[#E6D9FF] px-3 py-2 text-xs font-bold disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <FiEdit2 className="inline mr-1" size={13} /> Save
                  </button>
                </div>
                <button
                  type="button"
                  onClick={() => void updateCreationMetadata(selectedCreation.id, { isFavorite: !selectedCreation.isFavorite })}
                  className="flex items-center gap-1.5 text-xs font-semibold text-[#55534E] hover:text-[#111111]"
                >
                  <FiStar size={15} fill={selectedCreation.isFavorite ? "#E6B800" : "none"} className={selectedCreation.isFavorite ? "text-[#C99800]" : ""} />
                  {selectedCreation.isFavorite ? "Favorited" : "Add to favorites"}
                </button>
                <p className="text-sm sm:text-base font-serif text-[#111111] line-clamp-2">"{selectedCreation.prompt}"</p>
                <div className="flex items-center justify-between text-xs sm:text-sm text-[#55534E]">
                  <span>Model: {selectedCreation.modelId || "Generic"}</span>
                  {selectedCreation.status?.toLowerCase() === "completed" && selectedCreation.url && (
                    <a
                      href={selectedCreation.mediaType === "image" ? selectedCreation.url : `/api/creations/${selectedCreation.id}/download`}
                      download={`doolphin-${selectedCreation.id}.${selectedCreation.mediaType === "image" ? "jpg" : "mp4"}`}
                      className="text-[#111111] font-semibold flex items-center gap-1 hover:underline"
                    >
                      <FiDownload size={15} />
                      <span>Download</span>
                    </a>
                  )}
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* 4. EXPLORE VIDEO DETAIL MODAL */}
      <AnimatePresence>
        {selectedExploreVideo && (
          <div 
            onClick={() => setSelectedExploreVideo(null)}
            className="fixed inset-0 z-[1000] flex items-center justify-center p-4 bg-[#111111]/60 backdrop-blur-md"
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              onClick={(e) => e.stopPropagation()}
              className="relative p-3 flex flex-col items-center justify-center max-h-[92vh] overflow-hidden rounded-3xl bg-[#FAF8ED] border border-[#111111]/20 shadow-2xl"
            >
              <button
                onClick={() => setSelectedExploreVideo(null)}
                className="absolute top-5 right-5 z-20 w-10 h-10 rounded-full bg-black/70 hover:bg-black/90 text-white border border-white/20 flex items-center justify-center cursor-pointer transition-all shadow-lg"
              >
                <FiX size={20} />
              </button>

              <div className="relative aspect-[9/16] h-[82vh] max-w-sm mx-auto rounded-2xl overflow-hidden bg-black shadow-2xl flex items-center justify-center border border-[#111111]/20">
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
      <div className="h-full w-full flex flex-col items-center justify-center gap-3 text-[#111111] bg-[#FAF8ED]">
        <div className="w-10 h-10 border-3 border-[#111111] border-t-transparent rounded-full animate-spin" />
      </div>
    }>
      <HomeContent />
    </Suspense>
  );
}
