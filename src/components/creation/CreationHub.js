"use client";

import { useState, useEffect, useMemo, useRef } from "react";
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
  FiAlertCircle,
  FiXCircle
} from "react-icons/fi";
import PresetHeaderCard from "./PresetHeaderCard";
import VideoMakerForm from "./VideoMakerForm";
import ProductAdForm from "./ProductAdForm";
import AppStudioForm from "./AppStudioForm";
import ProgressTimeline from "./ProgressTimeline";
import { PRESETS_LIBRARY } from "@/lib/presetsData";
import CreationDetailModal from "./CreationDetailModal";
import { getGenerationModel, listGenerationModels } from "@/lib/generation/modelRegistry";
import toast from "react-hot-toast";
import LazyVideo from "@/components/LazyVideo";
import { useAppAccount } from "@/components/AppAccountProvider";
import { IN_FLIGHT_VARIANT_STATUSES, VIDEO_GENERATION_TYPES, videoSlotsForPlan } from "@/lib/generation/concurrencyLimit";

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

const BUNDLED_MODELS = listGenerationModels();

const STUDIO_IDS = {
  video_maker: "VIDEO_STUDIO",
  product: "PRODUCT_STUDIO",
  app: "APP_STUDIO"
};

const MODEL_STUDIOS = {
  video_maker: "video-studio",
  product: "product-studio",
  app: "app-studio"
};

const DRAFT_STORAGE_KEY = "doolphin_studio_drafts_v1";
const DRAFT_STORAGE_VERSION = 1;
const DRAFT_MAX_AGE_MS = 1000 * 60 * 60 * 24 * 30;

const APP_IMAGE_MIME_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const isSupportedAppImage = (asset) => APP_IMAGE_MIME_TYPES.has(String(asset?.detectedMimeType || asset?.mimeType || asset?.type || "").toLowerCase());

async function readJsonResponse(response, label) {
  const contentType = response.headers.get("content-type") || "";
  if (!contentType.includes("application/json")) throw new Error(`${label} returned an invalid response.`);
  const data = await response.json();
  if (!response.ok) throw new Error(data?.error || `${label} is unavailable.`);
  return data;
}

const compatibleModelsForStudio = (studioMode = "video_maker") => {
  const modelStudio = MODEL_STUDIOS[studioMode];
  return modelStudio ? BUNDLED_MODELS.filter((model) => model.studios?.includes(modelStudio)) : [];
};

const blankDraft = (studioMode = "video_maker") => {
  const selectedModel = compatibleModelsForStudio(studioMode)[0] || null;
  return {
    sceneMotion: "",
    selectedModel,
    unavailableModelId: null,
    duration: "Auto",
    resolution: selectedModel?.resolutions?.[0] || "",
    aspectRatio: selectedModel?.aspectRatios?.[0] || "",
    numVideos: 1,
    uploadedImages: [],
    productImages: [],
    appImages: [],
    productGroupName: "",
    spokenScript: "",
    additionalInstructions: "",
    draftAvatar: null
  };
};

const asString = (value, maxLength = 10000) => typeof value === "string" ? value.slice(0, maxLength) : "";

const isSupportedDraftDuration = (model, value) => {
  if (!model) return value === "Auto";
  if (value === "Auto") return true;
  const seconds = Number(value);
  if (!Number.isInteger(seconds)) return false;
  if (model.durationValues?.length) return model.durationValues.includes(seconds);
  return seconds >= model.minDuration && seconds <= model.maxDuration;
};

// Object URLs are valid only for the browser session that created them. Keep
// server-backed asset metadata, but never restore a stale blob URL.
const serializableAssets = (assets) => Array.isArray(assets)
  ? assets.filter((asset) => asset && typeof asset === "object" && (asset.assetId || asset.url)).map(({ preview, ...asset }) => asset)
  : [];

const serializeDraft = (draft) => ({
  sceneMotion: asString(draft.sceneMotion),
  // Preserve an unavailable saved ID until the user explicitly chooses a
  // replacement. Autosave must never rewrite it as the first current model.
  selectedModelId: draft.unavailableModelId || draft.selectedModel?.id,
  duration: draft.duration,
  resolution: draft.resolution,
  aspectRatio: draft.aspectRatio,
  numVideos: draft.numVideos,
  uploadedImages: serializableAssets(draft.uploadedImages),
  productImages: serializableAssets(draft.productImages),
  appImages: serializableAssets(draft.appImages),
  productGroupName: asString(draft.productGroupName, 80),
  spokenScript: asString(draft.spokenScript, 300),
  additionalInstructions: asString(draft.additionalInstructions),
  draftAvatar: draft.draftAvatar && typeof draft.draftAvatar === "object" ? draft.draftAvatar : null
});

const restoreDraft = (savedDraft, studioMode = "video_maker") => {
  const fallback = blankDraft(studioMode);
  if (!savedDraft || typeof savedDraft !== "object") return fallback;

  // Models and capabilities can change between visits. Preserve declared
  // legacy aliases, but never silently replace an unknown model with the first
  // current option: generation remains blocked until the user chooses one.
  const modelStudio = MODEL_STUDIOS[studioMode];
  const savedModelId = asString(savedDraft.selectedModelId, 200);
  const resolvedModel = savedModelId ? getGenerationModel(savedModelId) : null;
  const resolvedClientModel = resolvedModel ? BUNDLED_MODELS.find((model) => model.id === resolvedModel.id) : null;
  const compatibleModel = resolvedClientModel?.studios?.includes(modelStudio) ? resolvedClientModel : null;
  const selectedModel = savedModelId ? compatibleModel : fallback.selectedModel;
  const unavailableModelId = savedModelId && !compatibleModel ? savedModelId : null;
  const restoredAppImages = serializableAssets(savedDraft.appImages);
  return {
    sceneMotion: asString(savedDraft.sceneMotion),
    selectedModel,
    unavailableModelId,
    duration: isSupportedDraftDuration(selectedModel, savedDraft.duration) ? savedDraft.duration : fallback.duration,
    resolution: selectedModel?.resolutions?.includes(savedDraft.resolution) ? savedDraft.resolution : (selectedModel?.resolutions?.[0] || ""),
    aspectRatio: selectedModel?.aspectRatios?.includes(savedDraft.aspectRatio) ? savedDraft.aspectRatio : (selectedModel?.aspectRatios?.[0] || ""),
    numVideos: Number.isInteger(savedDraft.numVideos) && savedDraft.numVideos > 0 && savedDraft.numVideos <= 4 ? savedDraft.numVideos : fallback.numVideos,
    uploadedImages: serializableAssets(savedDraft.uploadedImages),
    productImages: serializableAssets(savedDraft.productImages),
    appImages: studioMode === "app" ? restoredAppImages.filter(isSupportedAppImage) : restoredAppImages,
    productGroupName: asString(savedDraft.productGroupName, 80),
    spokenScript: asString(savedDraft.spokenScript, 300),
    additionalInstructions: asString(savedDraft.additionalInstructions),
    draftAvatar: savedDraft.draftAvatar && typeof savedDraft.draftAvatar === "object" ? savedDraft.draftAvatar : null
  };
};

export default function CreationHub({ 
  selectedAvatar, 
  onOpenAvatarModal,
  onOpenPricing,
  onNavigateTab,
  studioMode = "video_maker",
  onStudioModeChange,
  userCredits
}) {
  const { account, refreshAccount } = useAppAccount();
  const [modelsByStudio, setModelsByStudio] = useState(null);
  const [isLoadingModels, setIsLoadingModels] = useState(true);
  const [modelLoadError, setModelLoadError] = useState(null);
  const [modelReloadToken, setModelReloadToken] = useState(0);
  const [activeModeId, setActiveModeId] = useState(() => STUDIO_IDS[studioMode] ? studioMode : "video_maker");
  const [isPresetModalOpen, setIsPresetModalOpen] = useState(false);
  const [presetSearch, setPresetSearch] = useState("");

  // Draggable Sidebar Resizing State
  const [sidebarWidth, setSidebarWidth] = useState(440);
  const [isResizing, setIsResizing] = useState(false);
  const [isMobileViewport, setIsMobileViewport] = useState(false);

  useEffect(() => {
    const media = window.matchMedia("(max-width: 767px)");
    const syncViewport = () => setIsMobileViewport(media.matches);
    syncViewport();
    media.addEventListener("change", syncViewport);
    return () => media.removeEventListener("change", syncViewport);
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    const loadModels = async () => {
      setIsLoadingModels(true);
      setModelLoadError(null);
      try {
        const entries = await Promise.all(Object.entries(MODEL_STUDIOS).map(async ([modeId, studio]) => {
          const response = await fetch(`/api/models?studio=${encodeURIComponent(studio)}`, { signal: controller.signal });
          const data = await readJsonResponse(response, `${PRESET_MODES.find((mode) => mode.id === modeId)?.name || "Studio"} model catalog`);
          if (!Array.isArray(data.models) || data.models.some((model) => !model?.id || !Array.isArray(model.aspectRatios) || !Array.isArray(model.resolutions))) {
            throw new Error(`The ${studio} model catalog is incomplete.`);
          }
          if (!data.models.length) throw new Error(`No enabled AI models are available for ${studio}.`);
          return [modeId, data.models];
        }));
        if (!controller.signal.aborted) setModelsByStudio(Object.fromEntries(entries));
      } catch (error) {
        if (error.name !== "AbortError" && !controller.signal.aborted) {
          setModelsByStudio({});
          setModelLoadError(error.message || "AI models could not be loaded.");
        }
      } finally {
        if (!controller.signal.aborted) setIsLoadingModels(false);
      }
    };
    void loadModels();
    return () => controller.abort();
  }, [modelReloadToken]);

  const startResizing = (e) => {
    e.preventDefault();
    setIsResizing(true);
  };

  useEffect(() => {
    const handleMouseMove = (e) => {
      if (!isResizing) return;
      // Calculate width relative to mouse X position
      const newWidth = Math.max(300, Math.min(e.clientX - 64, 800));
      setSidebarWidth(newWidth);
    };

    const handleMouseUp = () => {
      setIsResizing(false);
    };

    if (isResizing) {
      window.addEventListener("mousemove", handleMouseMove);
      window.addEventListener("mouseup", handleMouseUp);
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
    }

    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
  }, [isResizing]);
  
  // Each studio is snapshotted independently when the user switches modes.
  // Initial form state must match the URL-selected Studio before hydration.
  const initialDraft = useRef(blankDraft(STUDIO_IDS[studioMode] ? studioMode : "video_maker")).current;
  const studioDrafts = useRef({
    video_maker: blankDraft("video_maker"),
    product: blankDraft("product"),
    app: blankDraft("app")
  });
  const draftSnapshotRef = useRef(null);
  const [draftStorageReady, setDraftStorageReady] = useState(false);
  const [draftSaveStatus, setDraftSaveStatus] = useState("");
  const [sceneMotion, setSceneMotion] = useState(initialDraft.sceneMotion);
  const [selectedModel, setSelectedModel] = useState(initialDraft.selectedModel);
  const [unavailableDraftModelId, setUnavailableDraftModelId] = useState(initialDraft.unavailableModelId);
  const [duration, setDuration] = useState(initialDraft.duration);
  const [resolution, setResolution] = useState(initialDraft.resolution);
  const [aspectRatio, setAspectRatio] = useState(initialDraft.aspectRatio);
  const [numVideos, setNumVideos] = useState(1);
  const [uploadedImages, setUploadedImages] = useState([]);
  const [audioSource, setAudioSource] = useState(""); // reserved for a future voice feature

  const [productImages, setProductImages] = useState([]);
  const [appImages, setAppImages] = useState([]);
  const [productGroupName, setProductGroupName] = useState("");
  const [spokenScript, setSpokenScript] = useState("");
  const [additionalInstructions, setAdditionalInstructions] = useState("");
  const [draftAvatar, setDraftAvatar] = useState(selectedAvatar || null);

  useEffect(() => {
    if (selectedAvatar) setDraftAvatar(selectedAvatar);
  }, [selectedAvatar]);

  const [selectedVideo, setSelectedVideo] = useState(null);

  const [creations, setCreations] = useState([]);
  const [isLoadingCreations, setIsLoadingCreations] = useState(true);
  const [creationLoadError, setCreationLoadError] = useState(null);
  const [displayedCredits, setDisplayedCredits] = useState(userCredits);
  const [cancellingCreationIds, setCancellingCreationIds] = useState(() => new Set());
  // Statuses seen on the initial gallery load establish a baseline, preventing
  // stale history from producing a burst of alerts after a page refresh.
  const creationStatuses = useRef(new Map());
  const hasLoadedCreationStatuses = useRef(false);
  // A very fast provider can finish before the post-submit gallery refresh
  // observes QUEUED. Keep submitted IDs so that edge case still alerts once.
  const watchedCreationIds = useRef(new Set());

  useEffect(() => {
    setDisplayedCredits(userCredits);
  }, [userCredits]);

  const notifyGenerationStatusChange = (nextCreations) => {
    const previousStatuses = creationStatuses.current;
    const initialLoad = !hasLoadedCreationStatuses.current;
    const nextStatuses = new Map();

    nextCreations.forEach((creation) => {
      const nextStatus = String(creation.status || "").toUpperCase();
      const previousStatus = previousStatuses.get(creation.id);
      nextStatuses.set(creation.id, nextStatus);

      if (initialLoad || previousStatus === nextStatus) return;
      if (!previousStatus && !watchedCreationIds.current.has(creation.id)) return;
      const completed = ["COMPLETED", "PARTIAL_COMPLETED"].includes(nextStatus);
      const failed = ["FAILED", "QUARANTINED", "TIMED_OUT", "CANCELLED"].includes(nextStatus);
      if (!completed && !failed) return;
      watchedCreationIds.current.delete(creation.id);

      const title = creation.title || "Your generation";
      const message = completed ? `${title} is ready to view.` : `${title} could not be completed.`;
      if (completed) toast.success(message, { duration: 6000 });
      else toast.error(message, { duration: 6000 });
    });

    creationStatuses.current = nextStatuses;
    hasLoadedCreationStatuses.current = true;
  };

  const selectModel = (model) => {
    if (!model) return;
    const modelResolutions = model.resolutions || [];
    const modelAspectRatios = model.aspectRatios || [];
    setSelectedModel(model);
    setUnavailableDraftModelId(null);
    if (modelResolutions.length && !modelResolutions.includes(resolution)) setResolution(modelResolutions[0]);
    if (!modelResolutions.length) setResolution("");
    if (modelAspectRatios.length && !modelAspectRatios.includes(aspectRatio)) setAspectRatio(modelAspectRatios[0]);
    if (!modelAspectRatios.length) setAspectRatio("");
    if (duration !== "Auto") {
      const seconds = Number(duration);
      const allowed = model.durationValues?.length
        ? model.durationValues.includes(seconds)
        : seconds >= model.minDuration && seconds <= model.maxDuration;
      if (!allowed) setDuration("Auto");
    }
  };

  const currentDraft = () => ({
    sceneMotion, selectedModel, unavailableModelId: unavailableDraftModelId,
    duration, resolution, aspectRatio, numVideos,
    uploadedImages, productImages, appImages, productGroupName,
    spokenScript, additionalInstructions, draftAvatar
  });

  const loadDraft = (draft) => {
    setSceneMotion(draft.sceneMotion);
    setSelectedModel(draft.selectedModel);
    setUnavailableDraftModelId(draft.unavailableModelId || null);
    setDuration(draft.duration);
    setResolution(draft.resolution);
    setAspectRatio(draft.aspectRatio);
    setNumVideos(draft.numVideos);
    setUploadedImages(draft.uploadedImages);
    setProductImages(draft.productImages);
    setAppImages(draft.appImages);
    setProductGroupName(draft.productGroupName);
    setSpokenScript(draft.spokenScript);
    setAdditionalInstructions(draft.additionalInstructions);
    setDraftAvatar(draft.draftAvatar);
  };

  // Restore once, after hydration. Expiring malformed or old payloads avoids
  // carrying abandoned drafts and data from an incompatible app version.
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(DRAFT_STORAGE_KEY);
      if (!raw) return;
      const saved = JSON.parse(raw);
      if (saved?.version !== DRAFT_STORAGE_VERSION || !saved?.savedAt || Date.now() - saved.savedAt > DRAFT_MAX_AGE_MS) {
        window.localStorage.removeItem(DRAFT_STORAGE_KEY);
        return;
      }
      const restoredDrafts = {
        video_maker: restoreDraft(saved.drafts?.video_maker, "video_maker"),
        product: restoreDraft(saved.drafts?.product, "product"),
        app: restoreDraft(saved.drafts?.app, "app")
      };
      studioDrafts.current = restoredDrafts;
      loadDraft(restoredDrafts[activeModeId] || blankDraft(activeModeId));
      setDraftSaveStatus("Draft restored");
    } catch {
      // Corrupt local data should never block the studio from loading.
      window.localStorage.removeItem(DRAFT_STORAGE_KEY);
    } finally {
      setDraftStorageReady(true);
    }
  }, []);

  // Keep the active form and the inactive studio snapshots in one durable,
  // debounced payload. The pagehide handler covers closing a tab before the
  // debounce window elapses.
  useEffect(() => {
    if (!draftStorageReady) return undefined;

    studioDrafts.current[activeModeId] = currentDraft();
    const snapshot = {
      version: DRAFT_STORAGE_VERSION,
      savedAt: Date.now(),
      drafts: Object.fromEntries(Object.entries(studioDrafts.current).map(([studioId, draft]) => [studioId, serializeDraft(draft)]))
    };
    draftSnapshotRef.current = snapshot;
    setDraftSaveStatus("Saving draft…");

    const save = () => {
      try {
        window.localStorage.setItem(DRAFT_STORAGE_KEY, JSON.stringify(snapshot));
        setDraftSaveStatus("Draft saved");
      } catch {
        setDraftSaveStatus("Draft could not be saved");
      }
    };
    const timeout = window.setTimeout(save, 600);
    return () => window.clearTimeout(timeout);
  }, [
    draftStorageReady, activeModeId, sceneMotion, selectedModel, unavailableDraftModelId,
    duration,
    resolution, aspectRatio, numVideos, uploadedImages, productImages,
    appImages, productGroupName, spokenScript, additionalInstructions, draftAvatar
  ]);

  useEffect(() => {
    const saveBeforeExit = () => {
      if (!draftSnapshotRef.current) return;
      try {
        window.localStorage.setItem(DRAFT_STORAGE_KEY, JSON.stringify(draftSnapshotRef.current));
      } catch {
        // Storage can be unavailable in privacy-restricted browser sessions.
      }
    };
    window.addEventListener("pagehide", saveBeforeExit);
    return () => window.removeEventListener("pagehide", saveBeforeExit);
  }, []);

  const switchStudio = (nextModeId) => {
    if (!STUDIO_IDS[nextModeId] || nextModeId === activeModeId) return;
    studioDrafts.current[activeModeId] = currentDraft();
    loadDraft(studioDrafts.current[nextModeId] || blankDraft(nextModeId));
    setActiveModeId(nextModeId);
    setPreflight(null);
    setSubmitError(null);
    onStudioModeChange?.(nextModeId);
  };

  // The studio remains a client-side workspace state; this only lets an
  // authenticated /app URL restore or share the currently selected mode.
  useEffect(() => {
    if (STUDIO_IDS[studioMode] && studioMode !== activeModeId) {
      switchStudio(studioMode);
    }
  // switchStudio intentionally reads the current draft snapshot.
  }, [studioMode]);

  const fetchCreations = async () => {
    try {
      const res = await fetch("/api/creations", { headers: { Accept: "application/json" } });
      const data = await readJsonResponse(res, "Creation history");
      if (!Array.isArray(data)) throw new Error("Creation history returned an invalid response.");
      notifyGenerationStatusChange(data);
      setCreations(data);
      setCreationLoadError(null);
    } catch (error) {
      console.error("Failed to fetch creations:", error);
      setCreationLoadError(error.message || "Creation history could not be loaded.");
    } finally {
      setIsLoadingCreations(false);
    }
  };

  useEffect(() => {
    fetchCreations();
  }, []);

  // Jobs continue on the server via webhooks and reconciliation. Poll the
  // durable gallery so a refresh or closed tab never interrupts the workflow.
  useEffect(() => {
    const hasActiveGeneration = creations.some((creation) => ["QUEUED", "PROCESSING"].includes(String(creation.status).toUpperCase()));
    if (!hasActiveGeneration) return undefined;
    const interval = window.setInterval(fetchCreations, 5000);
    return () => window.clearInterval(interval);
  }, [creations]);

  const activePreset = PRESET_MODES.find((m) => m.id === activeModeId) || PRESET_MODES[0];
  const activeModels = modelsByStudio?.[activeModeId] || [];
  // Rebind restored/bundled draft selections to the authenticated server
  // catalog. This is the same entitlement-filtered authority preflight uses.
  useEffect(() => {
    if (isLoadingModels || !modelsByStudio) return;
    const matching = activeModels.find((model) => model.id === selectedModel?.id || model.id === unavailableDraftModelId);
    if (matching) {
      selectModel(matching);
      return;
    }
    if (!unavailableDraftModelId && activeModels[0]) selectModel(activeModels[0]);
  // Reconcile only when the authoritative catalog or active studio changes.
  }, [modelsByStudio, activeModeId, isLoadingModels]);
  // A retired draft must not make the picker visually select its first fallback.
  // Replacement options are rendered explicitly beside the blocking reason.
  const pickerModels = unavailableDraftModelId ? [] : activeModels;

  const providerImageCount = () =>
    1 + uploadedImages.length + productImages.length + appImages.length;

  const updateUploadedAsset = (assetId, changes) => {
    const update = (list) => list.map((asset) => (asset.assetId === assetId ? { ...asset, ...changes } : asset));
    setUploadedImages(update);
    setProductImages(update);
    setAppImages(update);
  };

  const pollAssetAnalysis = async (assetId) => {
    for (let attempt = 0; attempt < 50; attempt += 1) {
      const response = await fetch(`/api/assets/${assetId}/analysis`);
      const data = await response.json();
      if (data.status === "COMPLETED" || data.status === "CONFIRMED") {
        updateUploadedAsset(assetId, { analysisStatus: data.status, analysis: data.analysis, analysisRevision: data.revision, analysisConfirmed: data.status === "CONFIRMED" });
        return;
      }
      if (!response.ok || data.status === "FAILED") {
        updateUploadedAsset(assetId, { analysisStatus: "FAILED", analysisError: data.error || "Analysis failed" });
        return;
      }
      await new Promise((resolve) => window.setTimeout(resolve, 2500));
    }
    updateUploadedAsset(assetId, { analysisStatus: "FAILED", analysisError: "Analysis timed out; retry the upload." });
  };

  const beginAssetAnalysis = async (asset) => {
    updateUploadedAsset(asset.assetId, { analysisStatus: "PROCESSING" });
    const response = await fetch(`/api/assets/${asset.assetId}/analysis`, { method: "POST" });
    const data = await response.json();
    if (!response.ok) {
      updateUploadedAsset(asset.assetId, { analysisStatus: "FAILED", analysisError: data.error || "Analysis could not start" });
      return;
    }
    if (!asset.mimeType?.startsWith("video/")) setDisplayedCredits((value) => typeof value === "number" ? Math.max(0, value - 1) : value);
    if (data.status === "COMPLETED" || data.status === "CONFIRMED") {
      updateUploadedAsset(asset.assetId, { analysisStatus: data.status, analysis: data.analysis, analysisRevision: data.revision, analysisConfirmed: data.status === "CONFIRMED" });
      return;
    }
    await pollAssetAnalysis(asset.assetId);
  };

  const confirmAssetAnalysis = async (asset) => {
    const response = await fetch(`/api/assets/${asset.assetId}/analysis`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ confirmedAnalysis: asset.analysis })
    });
    const data = await response.json();
    if (!response.ok) {
      setSubmitError(data.error || "Could not confirm asset analysis");
      return;
    }
    const isProduct = asset.role === "PRIMARY_PRODUCT" || asset.role?.startsWith("PRODUCT_");
    const confirmedGroup = isProduct ? (productGroupName.trim() || data.analysis.suggestedName) : asset.groupId;
    updateUploadedAsset(asset.assetId, {
      analysisStatus: "CONFIRMED",
      analysisConfirmed: true,
      analysis: data.analysis,
      analysisRevision: data.revision,
      groupId: confirmedGroup,
      alias: isProduct && data.analysis.productViewType && data.analysis.productViewType !== "none" ? data.analysis.productViewType : asset.alias
    });
  };

  const uploadFiles = async (files, roleFactory) => {
    setSubmitError(null);
    const imageFiles = files.filter((file) => !file.type.startsWith("video/"));
    if (providerImageCount() + imageFiles.length > 9) {
      throw new Error("Seedance supports one avatar plus at most eight image inputs. Remove an image before uploading another.");
    }
    const uploaded = [];
    for (const [index, file] of files.entries()) {
      const hashBuffer = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
      const checksumSha256 = Array.from(new Uint8Array(hashBuffer), (byte) => byte.toString(16).padStart(2, "0")).join("");
      const presignResponse = await fetch("/api/uploads/presign", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ filename: file.name, contentType: file.type, fileSizeBytes: file.size, checksumSha256 }) });
      const presign = await presignResponse.json();
      if (!presignResponse.ok) throw new Error(presign.error || `Could not prepare ${file.name}`);
      if (!presign.directUpload) throw new Error(`Direct upload is unavailable for ${file.name}. Please try again later.`);
      if (!presign.assetId) throw new Error(`Upload preparation did not return an asset ID for ${file.name}.`);
      if (!presign.alreadyUploaded) {
        if (!presign.uploadUrl || !presign.requiredHeaders) throw new Error(`Upload preparation was incomplete for ${file.name}.`);
        const putResponse = await fetch(presign.uploadUrl, { method: "PUT", headers: presign.requiredHeaders, body: file });
        if (!putResponse.ok) throw new Error(`Direct storage upload failed for ${file.name}`);
      }
      const completeResponse = await fetch("/api/uploads/complete", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ assetId: presign.assetId }) });
      const data = await completeResponse.json();
      if (!completeResponse.ok) throw new Error(data.error || `Could not verify ${file.name}`);
      if (!data?.asset) throw new Error(`Upload verification did not return an asset for ${file.name}.`);
      const roleData = roleFactory(file, index, data.asset);
      uploaded.push({
        ...data.asset,
        ...roleData,
        id: data.asset.assetId,
        preview: URL.createObjectURL(file),
        url: data.asset.url
      });
    }
    return uploaded;
  };

  const handleProductUpload = async (event) => {
    try {
      const files = Array.from(event.target.files || []);
      const groupId = productGroupName.trim();
      const assets = await uploadFiles(files, (_file, index, storedAsset) => ({
        role: index === 0 ? "PRIMARY_PRODUCT" : "PRODUCT_PACKAGING",
        alias: `${groupId || storedAsset.analysis?.suggestedName || "unconfirmed_product"}_${productImages.length + index + 1}`,
        groupId: groupId || storedAsset.analysis?.suggestedName || `unconfirmed_${storedAsset.assetId}`
      }));
      setProductImages((previous) => [...previous, ...assets]);
    } catch (error) {
      setSubmitError(error.message);
    } finally {
      event.target.value = "";
    }
  };

  const handleAppUpload = async (event) => {
    try {
      const files = Array.from(event.target.files || []);
      if (files.some((file) => !isSupportedAppImage(file))) {
        throw new Error("App Studio currently accepts JPEG, PNG, or WebP screenshots only.");
      }
      const assets = await uploadFiles(files, (_file, index) => ({
        role: "APP_PRIMARY_SCREEN",
        alias: `app_asset_${appImages.length + index + 1}`,
        groupId: "app_flow_1"
      }));
      setAppImages((previous) => [...previous, ...assets]);
    } catch (error) {
      setSubmitError(error.message);
    } finally {
      event.target.value = "";
    }
  };

  const handleImageUpload = async (event) => {
    try {
      const files = Array.from(event.target.files || []);
      const assets = await uploadFiles(files, (_file, index) => ({
        role: "STYLE_REFERENCE",
        alias: `style_reference_${uploadedImages.length + index + 1}`,
        groupId: null
      }));
      setUploadedImages((previous) => [...previous, ...assets]);
    } catch (error) {
      setSubmitError(error.message);
    } finally {
      event.target.value = "";
    }
  };

  // Library assets have already been validated and persisted. Keep the same
  // canonical shape as fresh uploads so preflight/generation receive the asset
  // ID, storage key, analysis revision, and confirmed-analysis state unchanged.
  const addLibraryAsset = (target, storedAsset) => {
    if (!storedAsset?.assetId || storedAsset.validationStatus !== "VALID") {
      setSubmitError("That saved asset is no longer available for generation.");
      return;
    }
    if (target === "app" && !isSupportedAppImage(storedAsset)) {
      setSubmitError("App Studio currently accepts JPEG, PNG, or WebP screenshot assets only.");
      return;
    }
    const imageAsset = !storedAsset.mimeType?.startsWith("video/");
    if (imageAsset && providerImageCount() >= 9) {
      setSubmitError("Seedance supports one avatar plus at most eight image inputs. Remove an image before adding another.");
      return;
    }
    const existing = target === "product" ? productImages : target === "app" ? appImages : uploadedImages;
    if (existing.some((asset) => (asset.assetId || asset.id) === storedAsset.assetId)) return;

    const index = existing.length;
    const groupId = productGroupName.trim();
    const roleData = target === "product"
      ? {
          role: index === 0 ? "PRIMARY_PRODUCT" : "PRODUCT_PACKAGING",
          alias: `${groupId || storedAsset.analysis?.suggestedName || "unconfirmed_product"}_${index + 1}`,
          groupId: groupId || storedAsset.analysis?.suggestedName || `unconfirmed_${storedAsset.assetId}`
        }
      : target === "app"
        ? { role: "APP_PRIMARY_SCREEN", alias: `app_asset_${index + 1}`, groupId: "app_flow_1" }
        : { role: "STYLE_REFERENCE", alias: `style_reference_${index + 1}`, groupId: null };
    
    // Ensure default fallback structure for unconfirmed library analysis
    const fallbackAnalysis = storedAsset.analysis || {
      identity: storedAsset.originalFileName || "Uploaded asset",
      suggestedName: storedAsset.originalFileName || "asset",
      visibleText: [],
      deviceType: "unknown",
      productViewType: "none",
      peoplePresent: 0,
      lighting: "n/a",
      framing: "n/a",
      cameraAngle: "n/a",
      environment: "n/a",
      colors: [],
      pacingCues: [],
      confidence: 1,
      warnings: []
    };

    const asset = { 
      ...storedAsset, 
      ...roleData, 
      id: storedAsset.assetId, 
      preview: storedAsset.url,
      analysis: fallbackAnalysis
    };

    if (target === "product") setProductImages((previous) => [...previous, asset]);
    else if (target === "app") setAppImages((previous) => [...previous, asset]);
    else setUploadedImages((previous) => [...previous, asset]);
    setSubmitError(null);

    // Auto-confirm or analyze if needed so preflight verification succeeds immediately
    if (asset.analysisStatus !== "CONFIRMED" && !asset.analysisConfirmed) {
      if (asset.analysisStatus === "COMPLETED") {
        void confirmAssetAnalysis(asset);
      } else {
        void beginAssetAnalysis(asset);
      }
    }
  };

  const handleRemoveImage = (id) => {
    setProductImages(prev => prev.filter(img => (img.id || img.assetId) !== id));
    setAppImages(prev => prev.filter(img => (img.id || img.assetId) !== id));
    setUploadedImages(prev => prev.filter(img => img.id !== id));
  };

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState(null);
  const [preparedQuote, setPreparedQuote] = useState(null);
  const [preparedQuoteRequest, setPreparedQuoteRequest] = useState(null);
  const [quoteUnavailableRequest, setQuoteUnavailableRequest] = useState(null);

  const assetsNeedingReview = [
    ...(activeModeId === "product" ? productImages : []),
    ...(activeModeId === "app" ? appImages : []),
    ...uploadedImages
  ];
  const selectedModelIsCompatible = Boolean(selectedModel?.id && activeModels.some((model) => model.id === selectedModel?.id));
  const modelSelectionRequired = Boolean(isLoadingModels || modelLoadError || unavailableDraftModelId || !selectedModelIsCompatible);
  const avatarUrl = draftAvatar?.imageUrl || draftAvatar?.image || draftAvatar?.avatar_url;
  const hasRequiredMedia = activeModeId === "video_maker" || (activeModeId === "product" ? productImages.length > 0 : appImages.length > 0);
  const hasUnconfirmedAssets = assetsNeedingReview.some((asset) => !asset.analysisConfirmed);

  const buildCanonicalRequest = () => {
    if (!selectedModelIsCompatible) return null;
    const avatarAssetId = draftAvatar?.assetId || draftAvatar?.id;
    const primaryAssets = activeModeId === "product" ? productImages : activeModeId === "app" ? appImages : [];
    const supportedResolutions = selectedModel?.resolutions || [];
    const supportedAspectRatios = selectedModel?.aspectRatios || [];
    return {
      version: "1",
      studio: STUDIO_IDS[activeModeId],
      modelId: selectedModel?.id,
      modelLocked: true,
      script: { text: spokenScript.trim(), language: "auto", maxCharacters: 300 },
      instructions: {
        raw: (additionalInstructions || sceneMotion || "").trim(),
        confirmedScenePlanId: null
      },
      settings: {
        durationMode: duration === "Auto" ? "AUTO" : "EXPLICIT",
        ...(duration === "Auto" ? {} : { durationSeconds: Number(duration) }),
        ...(resolution && supportedResolutions.includes(resolution) ? { resolution } : {}),
        ...(aspectRatio && supportedAspectRatios.includes(aspectRatio) ? { aspectRatio } : {}),
        outputCount: Number(numVideos)
      },
      assets: [
        ...(avatarUrl ? [{
          assetId: String(avatarAssetId || `avatar_${draftAvatar?.name || "selected"}`),
          role: "ACTOR_REFERENCE",
          alias: draftAvatar?.name || "selected_avatar",
          groupId: null,
          storageKey: draftAvatar?.storageKey || null,
          url: avatarUrl,
          analysisRevision: draftAvatar?.analysisRevision || null,
          analysis: { confirmed: true, identityName: draftAvatar?.name || "selected_avatar" }
        }] : []),
        ...primaryAssets.map(({ preview, id, ...asset }) => asset),
        ...uploadedImages.map(({ preview, id, ...asset }) => asset)
      ]
    };
  };

  // The browser only knows whether its draft still matches a server quote. It
  // never calculates a price. Any material composer edit requires a new quote.
  const canonicalRequest = buildCanonicalRequest();
  const canonicalRequestKey = canonicalRequest ? JSON.stringify(canonicalRequest) : "";
  const quoteIsCurrent = Boolean(canonicalRequestKey && preparedQuote && preparedQuoteRequest === canonicalRequestKey);
  const quoteUnavailable = Boolean(canonicalRequestKey && quoteUnavailableRequest === canonicalRequestKey);
  const quotedCredits = quoteIsCurrent ? Number(preparedQuote.quote?.costs?.totalCredits) : null;
  const hasInsufficientQuotedCredits = quotedCredits !== null && Number(displayedCredits ?? 0) < quotedCredits;
  const requiredInputReasons = [
    ...(isLoadingModels ? ["Loading the available AI models…"] : []),
    ...(modelLoadError ? [modelLoadError] : []),
    ...(!isLoadingModels && !modelLoadError && (unavailableDraftModelId || !selectedModelIsCompatible) ? [unavailableDraftModelId
      ? `Your saved model “${unavailableDraftModelId}” is no longer available. Choose a replacement model.`
      : `No compatible AI model is currently available for ${activePreset.name}.`] : []),
    ...(!avatarUrl ? ["Choose an avatar."] : []),
    ...(!spokenScript.trim() ? ["Write the required script."] : []),
    ...(!hasRequiredMedia ? [activeModeId === "product" ? "Upload at least one product image." : "Upload at least one app screenshot."] : []),
    ...(hasUnconfirmedAssets ? ["Confirm the analysis for every uploaded asset."] : [])
  ];
  const requiredInputsMissing = requiredInputReasons.length > 0;

  // CONCURRENT GENERATION SLOTS — advisory mirror of the server rule.
  //
  // Derived from the gallery data already being polled rather than a new
  // endpoint: `creations` is refreshed every 5s while anything is in flight, so
  // this stays current for free and there is no second request to keep in sync.
  //
  // This is a courtesy, NOT the enforcement point. The authority is
  // assertVideoSlotAvailable() inside the submission transaction, which is the
  // only place that can be race-free. The value of computing it here is that the
  // user sees "1 of 1 slots in use" and a disabled button instead of composing a
  // whole generation and being rejected at the last step.
  const videoSlots = useMemo(() => {
    const limit = videoSlotsForPlan(account?.planCode);
    const inFlight = creations.reduce((total, creation) => {
      if (!VIDEO_GENERATION_TYPES.includes(creation.generationType)) return total;
      const active = (creation.variants || []).filter((variant) =>
        IN_FLIGHT_VARIANT_STATUSES.includes(String(variant.status || "").toUpperCase())
      ).length;
      return total + active;
    }, 0);
    return { limit, inFlight, available: Math.max(0, limit - inFlight) };
  }, [creations, account?.planCode]);

  const requestedOutputCount = Number(numVideos) || 1;
  const modelOutputLimit = Math.max(1, Number(selectedModel?.outputCount?.max) || 1);
  const generationOutputLimit = Math.min(videoSlots.limit, modelOutputLimit);
  const slotsUnavailable = requestedOutputCount > generationOutputLimit || videoSlots.inFlight + requestedOutputCount > videoSlots.limit;
  // Two genuinely different problems, and telling them apart matters: waiting is
  // temporary and resolves itself, whereas asking for more videos at once than
  // either the model or plan allows needs the user to change the request.
  const exceedsSlotCeiling = requestedOutputCount > generationOutputLimit;
  const slotLimitMessage = !slotsUnavailable
    ? null
    : exceedsSlotCeiling
      ? generationOutputLimit < videoSlots.limit
        ? `${selectedModel?.name || "This model"} generates up to ${generationOutputLimit} ${generationOutputLimit === 1 ? "video" : "videos"} per request. Lower the number of videos to continue.`
        : `Your plan generates ${videoSlots.limit === 1 ? "one video" : `up to ${videoSlots.limit} videos`} at a time. Lower the number of videos${videoSlots.limit === 1 ? "" : " or upgrade"} to continue.`
      : videoSlots.limit === 1
        ? "One video is already generating. It will appear in your library when it is done, then you can start the next one."
        : `All ${videoSlots.limit} generation slots are in use. As soon as one finishes and appears in your library, a slot frees up.`;

  // A restored draft, model change, or downgraded plan can carry a count the
  // current model/plan combination no longer permits. Clamp to the strictest
  // bound instead of sending a request that preflight must reject.
  useEffect(() => {
    if (requestedOutputCount > generationOutputLimit) setNumVideos(generationOutputLimit);
  }, [requestedOutputCount, generationOutputLimit]);

  const submitGeneration = async (quote, idempotencyKey) => {
    try {
      const response = await fetch("/api/generations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ quoteId: quote.id, idempotencyKey })
      });
      const data = await response.json();
      if (!response.ok || !data.success) throw new Error(data.error || "Generation submission failed");
      if (data.creationId) watchedCreationIds.current.add(data.creationId);
      const account = await refreshAccount();
      setDisplayedCredits(account?.credits);
      await fetchCreations();
    } catch (error) {
      throw new Error(error.message || "Generation submission failed");
    }
  };

  const handlePreflight = async () => {
    if (requiredInputsMissing || !canonicalRequestKey) {
      setSubmitError(requiredInputReasons[0] || "Complete the required fields before generating.");
      return;
    }
    setIsSubmitting(true);
    setSubmitError(null);
    try {
      const res = await fetch("/api/preflight", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: canonicalRequestKey
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        if (data.code === "GENERATION_CONFIGURATION_UNPRICED") setQuoteUnavailableRequest(canonicalRequestKey);
        throw new Error(data.error || "Generation could not be prepared");
      }
      setPreparedQuote(data);
      setPreparedQuoteRequest(canonicalRequestKey);
      setQuoteUnavailableRequest(null);
    } catch (error) {
      setSubmitError(error.message || "Generation submission failed");
    } finally {
      setIsSubmitting(false);
    }
  };

  // Quotes are an implementation detail, not a separate customer action. A
  // short debounce prevents typing from issuing a request per keystroke while
  // still keeping the cost in the primary action current.
  useEffect(() => {
    if (requiredInputsMissing || !canonicalRequestKey || isSubmitting || quoteIsCurrent || quoteUnavailable) return undefined;
    const timeout = window.setTimeout(() => { void handlePreflight(); }, 600);
    return () => window.clearTimeout(timeout);
  // canonicalRequestKey is deliberately the invalidation boundary.
  }, [canonicalRequestKey, requiredInputsMissing, isSubmitting, quoteIsCurrent, quoteUnavailable]);

  const confirmPreparedQuote = async () => {
    if (requiredInputsMissing || !canonicalRequestKey) {
      setSubmitError(requiredInputReasons[0] || "Complete the required fields before generating.");
      return;
    }
    if (!quoteIsCurrent || !preparedQuote?.quote) {
      setSubmitError("Your quote is no longer current. Get a new quote before generating.");
      return;
    }
    if (hasInsufficientQuotedCredits) {
      setSubmitError("You do not have enough available credits for this generation.");
      return;
    }
    // Refuse locally so the quote is not spent on a submission the server will
    // reject anyway. If this check is stale the server still refuses, and its
    // message replaces this one.
    if (slotsUnavailable) {
      setSubmitError(slotLimitMessage);
      return;
    }
    setIsSubmitting(true);
    setSubmitError(null);
    try {
      await submitGeneration(preparedQuote.quote, crypto.randomUUID());
      setPreparedQuote(null);
      setPreparedQuoteRequest(null);
    } catch (error) {
      setSubmitError(error.message || "Generation submission failed");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleRetry = async (creation) => {
    if (!creation?.retryRequest) return;
    // A retry is a new generation and occupies a slot like any other, so it is
    // subject to the same ceiling.
    if (videoSlots.available < 1) {
      setSubmitError(
        videoSlots.limit === 1
          ? "One video is already generating. Wait for it to finish before restarting this one."
          : `All ${videoSlots.limit} generation slots are in use. Wait for one to finish before restarting this video.`
      );
      return;
    }
    setIsSubmitting(true);
    setSubmitError(null);
    try {
      const res = await fetch("/api/preflight", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(creation.retryRequest),
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || "Unable to restart this video");
      await submitGeneration(data.quote, crypto.randomUUID());
    } catch (error) {
      setSubmitError(error.message || "Unable to restart this video");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleCancelGeneration = async (event, creation) => {
    event.stopPropagation();
    if (!window.confirm("Cancel this generation? It can only be cancelled before it reaches the provider.")) return;
    setCancellingCreationIds((ids) => new Set(ids).add(creation.id));
    try {
      const response = await fetch(`/api/generations/${creation.id}/cancel`, { method: "POST" });
      const data = await response.json();
      if (response.status === 409) {
        toast("This generation has already started with the provider and can no longer be cancelled safely.");
      } else if (!response.ok) {
        throw new Error(data.error || "Could not cancel this generation");
      } else {
        toast.success("Generation cancelled. Any unsubmitted credits were released.");
        await Promise.all([fetchCreations(), refreshAccount().then((account) => setDisplayedCredits(account?.credits))]);
      }
    } catch (error) {
      toast.error(error.message || "Could not cancel this generation");
    } finally {
      setCancellingCreationIds((ids) => {
        const next = new Set(ids);
        next.delete(creation.id);
        return next;
      });
    }
  };

  const handleRecreate = (creation) => {
    if (!creation) return;

    if (creation.generationType === "APP_STUDIO" || creation.presetId === "app") {
      switchStudio("app");
    } else if (creation.generationType === "PRODUCT_STUDIO" || creation.presetId === "product") {
      switchStudio("product");
    } else {
      switchStudio("video_maker");
    }

    if (creation.spokenScript || creation.prompt) setSpokenScript(creation.spokenScript || creation.prompt);
    if (creation.duration) setDuration(creation.duration);
    if (creation.resolution) setResolution(creation.resolution);
    if (creation.aspectRatio) setAspectRatio(creation.aspectRatio);
    if (creation.additionalInstructions) setAdditionalInstructions(creation.additionalInstructions);

  };

  const creationCards = useMemo(() => creations.flatMap((creation) => {
    const outputs = Array.isArray(creation.outputs) ? creation.outputs.filter((output) => output?.url) : [];
    if (!outputs.length) return [creation];
    return outputs.map((output, index) => ({
      ...creation,
      url: output.url,
      mediaType: output.mediaType || creation.mediaType,
      outputId: output.id || `${creation.id}-${index}`,
      outputPosition: index + 1,
      deliveredOutputCount: outputs.length,
    }));
  }), [creations]);

  const isDelivered = (status) => ["completed", "partial_completed"].includes(String(status || "").toLowerCase());
  const isPlayable = (creation) => isDelivered(creation?.status) && Boolean(creation?.url);
  const isCancelled = (status) => String(status || "").toLowerCase() === "cancelled";
  const isInProgress = (status) => !isDelivered(status) && !["failed", "quarantined", "timed_out", "cancelled"].includes(String(status || "").toLowerCase());
  const stageLabel = (stage) => String(stage || "queued").replace(/[_-]+/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
  const elapsedLabel = (creation) => {
    const started = creation.createdAt;
    const elapsedSeconds = started ? Math.max(0, Math.floor((Date.now() - new Date(started).getTime()) / 1000)) : 0;
    return elapsedSeconds < 60 ? "Just started" : `${Math.floor(elapsedSeconds / 60)}m elapsed`;
  };

  return (
    <div className="flex h-full w-full flex-col overflow-y-auto bg-[#FAF8ED] text-[#111111] md:flex-row md:overflow-hidden">
      {/* LEFT CONTROL PANEL / DRAWER WITH INTERACTIVE DRAGGABLE RESIZER */}
      <aside
        style={{ width: isMobileViewport ? "100%" : `${sidebarWidth}px` }}
        className="studio-sidebar relative flex min-h-0 w-full shrink-0 flex-col border-b border-[#111111]/15 bg-white select-none md:h-full md:border-b-0 md:border-r md:transition-[width] md:duration-75 md:ease-out"
      >
        {/* Interactive Drag Resizer Bar */}
        <div
          onMouseDown={startResizing}
          className={`absolute right-0 top-0 bottom-0 hidden w-3 cursor-col-resize hover:bg-[#111111]/15 active:bg-[#111111]/30 z-30 group items-center justify-center transition-colors md:flex ${
            isResizing ? "bg-[#111111]/20" : ""
          }`}
          title="Click and drag left or right to resize panel width"
        >
          <div className="w-1 h-10 rounded-full bg-[#111111]/30 group-hover:bg-[#111111] group-hover:scale-y-125 transition-all shadow-sm" />
        </div>

        {/* Scrollable Form Content */}
        <div className="studio-sidebar-content flex-1 overflow-y-auto p-4 sm:p-5 space-y-4 scrollbar-subtle">
          <PresetHeaderCard
            preset={activePreset}
            onChangeClick={() => setIsPresetModalOpen(true)}
          />
          {draftSaveStatus && (
            <p className={`-mt-2 text-right text-[11px] font-medium ${draftSaveStatus === "Draft could not be saved" ? "text-amber-700" : "text-[#77746D]"}`} aria-live="polite">
              {draftSaveStatus}
            </p>
          )}

          {activeModeId === "video_maker" && (
            <VideoMakerForm
              sceneMotion={sceneMotion}
              setSceneMotion={setSceneMotion}
              additionalInstructions={additionalInstructions}
              setAdditionalInstructions={setAdditionalInstructions}
              spokenScript={spokenScript}
              setSpokenScript={setSpokenScript}
              selectedModel={selectedModel}
              setSelectedModel={selectModel}
              duration={duration}
              setDuration={setDuration}
              resolution={resolution}
              setResolution={setResolution}
              aspectRatio={aspectRatio}
              setAspectRatio={setAspectRatio}
              numVideos={numVideos}
              maxVideos={generationOutputLimit}
              setNumVideos={setNumVideos}
              selectedActor={draftAvatar}
              onOpenActorModal={onOpenAvatarModal}
              uploadedImages={uploadedImages}
              onImageUpload={handleImageUpload}
              onChooseLibraryReference={(asset) => addLibraryAsset("reference", asset)}
              onRemoveImage={handleRemoveImage}
              audioSource={audioSource}
              setAudioSource={setAudioSource}
              modelsList={pickerModels}
            />
          )}

          {activeModeId === "product" && (
            <ProductAdForm
              productImages={productImages}
              productGroupName={productGroupName}
              setProductGroupName={setProductGroupName}
              onProductUpload={handleProductUpload}
              onChooseLibraryProduct={(asset) => addLibraryAsset("product", asset)}
              selectedActor={draftAvatar}
              onOpenActorModal={onOpenAvatarModal}
              spokenScript={spokenScript}
              setSpokenScript={setSpokenScript}
              additionalInstructions={additionalInstructions}
              setAdditionalInstructions={setAdditionalInstructions}
              uploadedImages={uploadedImages}
              onImageUpload={handleImageUpload}
              onChooseLibraryReference={(asset) => addLibraryAsset("reference", asset)}
              onRemoveImage={handleRemoveImage}
              duration={duration}
              setDuration={setDuration}
              resolution={resolution}
              setResolution={setResolution}
              aspectRatio={aspectRatio}
              setAspectRatio={setAspectRatio}
              numVideos={numVideos}
              maxVideos={generationOutputLimit}
              setNumVideos={setNumVideos}
              selectedModel={selectedModel}
              setSelectedModel={selectModel}
              modelsList={pickerModels}
            />
          )}

          {activeModeId === "app" && (
            <AppStudioForm
              appImages={appImages}
              onAppUpload={handleAppUpload}
              onChooseLibraryApp={(asset) => addLibraryAsset("app", asset)}
              selectedActor={draftAvatar}
              onOpenActorModal={onOpenAvatarModal}
              spokenScript={spokenScript}
              setSpokenScript={setSpokenScript}
              additionalInstructions={additionalInstructions}
              setAdditionalInstructions={setAdditionalInstructions}
              uploadedImages={uploadedImages}
              onImageUpload={handleImageUpload}
              onChooseLibraryReference={(asset) => addLibraryAsset("reference", asset)}
              onRemoveImage={handleRemoveImage}
              duration={duration}
              setDuration={setDuration}
              resolution={resolution}
              setResolution={setResolution}
              aspectRatio={aspectRatio}
              setAspectRatio={setAspectRatio}
              numVideos={numVideos}
              maxVideos={generationOutputLimit}
              setNumVideos={setNumVideos}
              selectedModel={selectedModel}
              setSelectedModel={selectModel}
              modelsList={pickerModels}
            />
          )}

          {assetsNeedingReview.length > 0 && (
            <div className="space-y-2 border-t border-[#111111]/10 pt-4">
              <div>
                <h3 className="text-sm font-bold">Asset analysis & confirmation</h3>
                <p className="text-xs text-[#66635D]">Review what the model understood. Generation stays blocked until every asset is confirmed.</p>
              </div>
              {assetsNeedingReview.map((asset) => (
                <div key={`analysis-${asset.assetId}`} className="rounded-xl border border-[#111111]/10 bg-[#FAF8ED] p-3 space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-semibold truncate">{asset.originalFileName || asset.alias}</span>
                    <span className={`text-[10px] font-bold px-2 py-1 rounded-full ${asset.analysisConfirmed ? "bg-green-100 text-green-800" : asset.analysisStatus === "FAILED" ? "bg-red-100 text-red-700" : "bg-[#E6D9FF]"}`}>
                      {asset.analysisConfirmed ? "CONFIRMED" : asset.analysisStatus || "PENDING"}
                    </span>
                  </div>
                  {asset.analysisStatus === "COMPLETED" && !asset.analysisConfirmed && (
                    <>
                      <input
                        value={asset.analysis?.suggestedName || ""}
                        onChange={(event) => updateUploadedAsset(asset.assetId, { analysis: { ...asset.analysis, suggestedName: event.target.value } })}
                        placeholder="Confirmed asset name"
                        className="w-full bg-white p-2 text-xs border border-[#111111]/15 rounded-lg"
                      />
                      {asset.role === "APP_PRIMARY_SCREEN" && (
                        <select
                          value={asset.analysis?.deviceType || "unknown"}
                          onChange={(event) => updateUploadedAsset(asset.assetId, { analysis: { ...asset.analysis, deviceType: event.target.value } })}
                          className="w-full bg-white p-2 text-xs border border-[#111111]/15 rounded-lg"
                        >
                          {["mobile", "tablet", "desktop", "browser", "mixed", "unknown"].map((value) => <option key={value} value={value}>{value}</option>)}
                        </select>
                      )}
                      {asset.analysis?.peoplePresent > 0 && asset.role === "STYLE_REFERENCE" && (
                        <p className="text-[11px] text-amber-800">Contains a person. This file will be labeled as style/composition only; its identity and voice are forbidden.</p>
                      )}
                      <button type="button" onClick={() => confirmAssetAnalysis(asset)} className="w-full py-2 rounded-lg bg-white border border-[#111111] text-xs font-bold">Confirm this analysis</button>
                    </>
                  )}
                  {(!asset.analysisStatus || asset.analysisStatus === "PENDING") && (
                    <button type="button" onClick={() => void beginAssetAnalysis(asset)} className="w-full py-2 rounded-lg bg-[#E6D9FF] border border-[#111111] text-xs font-bold">Analyze this asset (1 credit)</button>
                  )}
                  {asset.analysisError && <p className="text-[11px] text-red-700">{asset.analysisError}</p>}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* STICKY BOTTOM GENERATE BUTTON */}
        <div className="studio-generate-bar p-4 border-t border-[#111111]/10 bg-white shrink-0 space-y-2">
          {requiredInputsMissing && (
            <div role="alert" className="p-2.5 bg-amber-50 border border-amber-300 rounded-xl text-xs text-amber-900">
              <p className="font-semibold">Complete these required fields:</p>
              <ul className="mt-1 list-disc space-y-0.5 pl-4">
                {requiredInputReasons.map((reason) => <li key={reason}>{reason}</li>)}
              </ul>
              {modelLoadError && (
                <button
                  type="button"
                  onClick={() => setModelReloadToken((value) => value + 1)}
                  className="mt-2 rounded-full border border-amber-500 bg-white px-3 py-1 font-semibold text-amber-950 hover:bg-amber-100"
                >
                  Retry model loading
                </button>
              )}
              {unavailableDraftModelId && activeModels.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {activeModels.map((model) => (
                    <button
                      key={model.id}
                      type="button"
                      onClick={() => selectModel(model)}
                      className="rounded-full border border-amber-500 bg-white px-2.5 py-1 font-semibold text-amber-950 hover:bg-amber-100"
                    >
                      Use {model.name}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
          {submitError && (
            <div className="p-2.5 bg-red-50 border border-red-200 rounded-xl text-xs text-red-600">
              {submitError}
            </div>
          )}
          {/* Concurrency is stated before the user commits, not after. Shown only
              while something is actually generating or the request cannot fit, so
              it never becomes permanent chrome the eye learns to skip. */}
          {(videoSlots.inFlight > 0 || slotsUnavailable) && (
            <div className={`p-2.5 rounded-xl text-xs border ${slotsUnavailable ? "bg-[#E6D9FF]/50 border-[#111111]/25 text-[#111111]" : "bg-[#F2EFE5] border-[#111111]/10 text-[#55534E]"}`}>
              <span className="font-semibold">{videoSlots.inFlight} of {videoSlots.limit} {videoSlots.limit === 1 ? "slot" : "slots"} in use</span>
              {slotLimitMessage ? <> — {slotLimitMessage}</> : " — you can start another generation."}
            </div>
          )}
          <button
            type="button"
            disabled={requiredInputsMissing || isSubmitting || quoteUnavailable || slotsUnavailable || hasInsufficientQuotedCredits}
            onClick={quoteIsCurrent ? confirmPreparedQuote : handlePreflight}
            className="studio-generate-button w-full py-3.5 px-6 bg-[#E6D9FF] hover:bg-[#DBCBFF] hover:scale-[1.01] text-[#111111] rounded-full font-semibold text-sm border-[1.5px] border-[#111111] shadow-sm transition-all active:scale-[0.98] flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50"
          >
            <FiZap size={16} />
            <span>{requiredInputsMissing
              ? modelSelectionRequired ? isLoadingModels ? "Loading models…" : "Choose a model" : "Complete required fields"
              : isSubmitting
              ? "Calculating…"
              : slotsUnavailable
                ? exceedsSlotCeiling ? `Maximum ${generationOutputLimit} at a time` : "Waiting for a free slot"
              : quoteIsCurrent
                ? `Generate Video · ${quotedCredits} credits`
                : quoteUnavailable
                  ? "Unavailable"
                : preparedQuote
                  ? "Calculating…"
                  : "Generate"}</span>
          </button>
          {!quoteIsCurrent && preparedQuote && <p className="text-xs text-center text-[#77746D] font-medium">Updating your generation cost…</p>}
          {quoteIsCurrent && hasInsufficientQuotedCredits && (
            <p className="text-xs text-center text-red-700 font-medium">Insufficient credits: {displayedCredits ?? 0} available, {quotedCredits} required.</p>
          )}
          {quoteUnavailable && (
            <p className="text-xs text-center text-amber-700 font-medium">This configuration is unavailable until Doolphin has an approved provider cost. No credits were reserved.</p>
          )}
          <p className="text-xs text-center text-[#77746D] font-medium">
            Typical run takes ~3 min
          </p>
        </div>
      </aside>


      {/* RIGHT MAIN CONTENT VIEW */}
      <main className="min-h-0 flex-1 overflow-y-auto bg-[#FAF8ED] p-4 scrollbar-subtle md:h-full md:p-6 space-y-5">


        {/* 4-COLUMN CREATIONS HISTORY GRID */}
        {isLoadingCreations ? (
          <div className="flex-1 flex flex-col items-center justify-center py-20 gap-3">
            <FiClock className="text-3xl text-[#111111] animate-spin" />
            <span className="text-xs text-[#55534E] animate-pulse">Loading creations...</span>
          </div>
        ) : creationLoadError && creations.length === 0 ? (
          <div role="alert" className="flex-1 flex flex-col items-center justify-center py-20 gap-3 text-center">
            <FiAlertCircle className="text-3xl text-red-700" />
            <h3 className="text-sm font-semibold text-[#111111]">Creation history could not be loaded</h3>
            <p className="text-xs text-[#55534E] max-w-sm">{creationLoadError}</p>
            <button type="button" onClick={() => void fetchCreations()} className="rounded-full border border-[#111111] bg-white px-4 py-2 text-xs font-bold">Try again</button>
          </div>
        ) : creations.length === 0 ? (
          <div className="flex-1 flex flex-col items-center justify-center py-20 gap-3 text-center">
            <div className="w-16 h-16 rounded-2xl bg-white flex items-center justify-center text-[#55534E] border border-[#111111]/15 mb-2 shadow-sm">
              <FiVideo size={28} />
            </div>
            <h3 className="text-sm font-semibold text-[#111111]">No creations yet</h3>
            <p className="text-xs text-[#55534E] max-w-sm">Generate your first video using the studio on the left.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3.5">
            {creationCards.map((item) => (
              <div
                key={`${item.id}:${item.outputId || "summary"}`}
                onClick={() => item.mediaType === "video" && isPlayable(item) && setSelectedVideo(item)}
                className={`group relative ${item.mediaType === "image" ? "aspect-square" : "aspect-[9/16]"} rounded-2xl overflow-hidden bg-white border border-[#111111]/15 shadow-sm transition-all ${
                  item.mediaType === "video" && isPlayable(item) ? "cursor-pointer hover:border-[#111111]/30" : ""
                }`}
              >
                {item.deliveredOutputCount > 1 && (
                  <span className="absolute left-2 top-2 z-20 rounded-full bg-black/75 px-2 py-1 text-[10px] font-bold text-white">
                    Output {item.outputPosition} of {item.deliveredOutputCount}
                  </span>
                )}
                {item.mediaType === "image" && item.url ? (
                  <><img src={item.url} alt={item.prompt || "Generated image"} loading="lazy" className="h-full w-full object-cover" /><div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/75 to-transparent p-3"><p className="line-clamp-2 text-xs font-semibold text-white">{item.prompt || "Generated image"}</p></div></>
                ) : isPlayable(item) ? (
                  <>
                    <LazyVideo
                      src={item.url}
                      className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                      autoPlay
                    />
                    <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-black/20 p-3 flex flex-col justify-between opacity-0 group-hover:opacity-100 transition-opacity">
                      <div className="flex justify-between items-start">
                        <span className="text-[10px] bg-[#064E3B] text-white px-2 py-0.5 rounded-full uppercase font-bold">
                          {String(item.status).toUpperCase() === "PARTIAL_COMPLETED" ? "PARTIAL" : "COMPLETED"}
                        </span>
                        <span className="p-1.5 rounded-full bg-white/90 text-[#111111] h-fit shadow">
                          <FiMaximize2 size={13} />
                        </span>
                      </div>
                      <div>
                        <p className="text-white text-xs font-semibold leading-snug line-clamp-2">{item.prompt}</p>
                      </div>
                    </div>
                  </>
                ) : ["failed", "quarantined", "timed_out"].includes(item.status?.toLowerCase()) ? (
                  <div className="w-full h-full flex flex-col items-center justify-center p-5 gap-3 text-center bg-[#FAF8ED]">
                    <div className="w-10 h-10 rounded-full bg-[#FBE6E6] text-[#A52A2A] flex items-center justify-center"><FiAlertCircle size={20} /></div>
                    <p className="text-xs font-semibold leading-relaxed text-[#33312C]">{item.error || "Model servers are busy right now. Your credits were returned."}</p>
                    <button
                      type="button"
                      disabled={isSubmitting || !item.retryRequest}
                      onClick={(event) => { event.stopPropagation(); void handleRetry(item); }}
                      className="px-3 py-1.5 rounded-full bg-[#E6D9FF] border border-[#111111] text-[11px] font-bold disabled:opacity-50"
                    >
                      Try again
                    </button>
                  </div>
                ) : isDelivered(item.status) ? (
                  <div className="w-full h-full flex flex-col items-center justify-center p-4 gap-2 text-center bg-amber-50">
                    <FiAlertCircle className="text-amber-700 text-2xl" />
                    <span className="text-[10px] bg-amber-700 text-white px-2 py-0.5 rounded-full uppercase font-bold">Preview unavailable</span>
                  </div>
                ) : isCancelled(item.status) ? (
                  <div className="w-full h-full flex flex-col items-center justify-center p-5 gap-3 text-center bg-[#FAF8ED]">
                    <FiXCircle className="text-2xl text-[#77746D]" />
                    <span className="text-[10px] bg-[#EFECE1] text-[#55534E] px-2 py-0.5 rounded-full uppercase font-bold border border-[#111111]/20">Cancelled</span>
                    <p className="text-[11px] text-[#77746D]">This generation was stopped before provider submission.</p>
                  </div>
                ) : (
                  <div className="w-full h-full flex flex-col items-center justify-center gap-3 p-4 text-center bg-[#FAF8ED]">
                    <FiClock className="text-2xl text-[#111111] animate-spin" />
                    <span className="text-[10px] bg-[#EFECE1] text-[#111111] px-2 py-0.5 rounded-full uppercase font-bold border border-[#111111]/20">
                      {stageLabel(item.currentStage)}
                    </span>
                    <div className="w-full max-w-[160px] space-y-1.5" aria-label={`${Math.round(Number(item.progressValue) || 0)}% complete`}>
                      <div className="h-1.5 overflow-hidden rounded-full bg-[#111111]/10">
                        <div className="h-full rounded-full bg-[#064E3B] transition-[width] duration-500" style={{ width: `${Math.min(100, Math.max(3, Number(item.progressValue) || 0))}%` }} />
                      </div>
                      <p className="text-[11px] font-semibold text-[#33312C]">{Math.round(Number(item.progressValue) || 0)}% · {elapsedLabel(item)}</p>
                    </div>
                    <span className="text-[11px] text-[#77746D]">This keeps running if you leave this page.</span>
                    {isInProgress(item.status) && (
                      <div className="flex flex-wrap items-center justify-center gap-2">
                        <button
                          type="button"
                          disabled={cancellingCreationIds.has(item.id)}
                          onClick={(event) => void handleCancelGeneration(event, item)}
                          className="rounded-full border border-red-200 bg-white px-2.5 py-1.5 text-[10px] font-bold text-red-700 hover:bg-red-50 disabled:opacity-50"
                        >
                          {cancellingCreationIds.has(item.id) ? "Cancelling…" : "Cancel"}
                        </button>
                      </div>
                    )}
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
          <div className="fixed inset-0 z-[1000] flex items-center justify-center p-4 bg-[#111111]/40 backdrop-blur-md">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="w-full max-w-2xl bg-white border border-[#111111]/20 rounded-3xl p-6 shadow-2xl space-y-5 text-[#111111]"
            >
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-base font-serif font-bold text-[#111111]">Choose Preset Studio</h3>
                  <p className="text-xs text-[#55534E]">Select a creative workflow preset for your video</p>
                </div>
                <button
                  onClick={() => setIsPresetModalOpen(false)}
                  className="w-8 h-8 rounded-full bg-[#EFECE1] hover:bg-[#EAE6D8] text-[#111111] flex items-center justify-center cursor-pointer transition-colors"
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
                      switchStudio(mode.id);
                      setIsPresetModalOpen(false);
                    }}
                    className={`p-4 rounded-2xl border text-left transition-all cursor-pointer flex flex-col justify-end h-40 relative overflow-hidden group ${
                      activeModeId === mode.id
                        ? "border-[#111111] ring-2 ring-[#111111]"
                        : "border-[#111111]/15 hover:border-[#111111]/30"
                    }`}
                  >
                    <img
                      src={mode.image}
                      alt={mode.name}
                      className="absolute inset-0 w-full h-full object-cover opacity-80 group-hover:scale-105 transition-transform duration-300 pointer-events-none"
                    />
                    <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/30 to-transparent pointer-events-none" />

                    <div className="relative z-10 flex items-center justify-between w-full">
                      <h4 className="text-base font-serif font-bold text-white tracking-wide">
                        {mode.name}
                      </h4>
                      {activeModeId === mode.id && (
                        <span className="w-6 h-6 rounded-full bg-[#064E3B] text-white flex items-center justify-center shadow-md shrink-0">
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
