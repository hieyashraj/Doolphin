"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  FiCheck,
  FiChevronDown,
  FiCompass,
  FiGrid,
  FiImage,
  FiLoader,
  FiPlus,
  FiSearch,
  FiUploadCloud,
  FiX
} from "react-icons/fi";
import StudioSelect from "@/components/studio/StudioSelect";
import { useAppAccount } from "@/components/AppAccountProvider";
import ExploreGallery from "@/components/image-studio/ExploreGallery";
import { EXPLORE_IMAGES, getExploreImageById } from "@/lib/explore-images-data";

const compatible = (value, values) => (values.includes(value) ? value : values[0]);

function apiErrorMessage(data, fallback) {
  const validationMessages = Array.isArray(data?.errors)
    ? data.errors.map((entry) => (typeof entry === "string" ? entry : entry?.message)).filter(Boolean)
    : [];
  return validationMessages.join(" ") || data?.error || data?.message || fallback;
}

async function readApiJson(response, fallback) {
  const contentType = response.headers.get("content-type") || "";
  if (!contentType.toLowerCase().includes("application/json")) {
    throw new Error(`${fallback} The server returned an unexpected response (${response.status}).`);
  }
  const data = await response.json();
  if (!response.ok) throw new Error(apiErrorMessage(data, `${fallback} (${response.status}).`));
  return data;
}

function hasValidCapabilities(model) {
  const caps = model?.productCapabilities;
  const references = caps?.referenceImages;
  const validOptions = (control, valueType) =>
    control &&
    typeof control.visible === "boolean" &&
    Array.isArray(control.values) &&
    (!control.visible || (control.values.length > 0 && control.values.every((value) => typeof value === valueType)));

  return Boolean(
    model &&
      typeof model.id === "string" &&
      model.id &&
      typeof model.displayName === "string" &&
      references &&
      typeof references.visible === "boolean" &&
      Number.isInteger(references.min) &&
      Number.isInteger(references.max) &&
      references.min >= 0 &&
      references.max >= references.min &&
      validOptions(caps.aspectRatio, "string") &&
      validOptions(caps.outputResolution, "string") &&
      validOptions(caps.requestedOutputCount, "number") &&
      caps.requestedOutputCount.values.every((value) => Number.isInteger(value) && value > 0)
  );
}

function referenceMinimumMessage(minimum) {
  return `This model requires at least ${minimum} reference image${minimum === 1 ? "" : "s"}. Add one from Explore or My Assets.`;
}

async function loadDeliveredImages(creationId, expectedCount) {
  const delivered = [];
  for (let page = 0; page < 100; page += 1) {
    const response = await fetch(`/api/my-images?page=${page}`);
    const data = await readApiJson(response, "Generated images could not be loaded yet.");
    if (!Array.isArray(data.items)) throw new Error("Generated images could not be loaded because the API response was invalid.");
    const matches = data.items.filter(
      (item) => item?.creationId === creationId && typeof item.url === "string" && item.url
    );
    delivered.push(...matches);
    if ((expectedCount > 0 && delivered.length >= expectedCount) || !data.hasMore) break;
    if (delivered.length > 0 && matches.length === 0) break;
    if (page === 99) throw new Error("Generated images could not be located in the library yet.");
  }
  return delivered.sort((left, right) => (left.outputIndex ?? 0) - (right.outputIndex ?? 0));
}

function normalize(model, draft) {
  const caps = model.productCapabilities;
  const refVisible = Boolean(caps?.referenceImages?.visible);
  const maxRef = caps?.referenceImages?.max || 0;

  const exploreIds = refVisible ? (draft.exploreImageIds || []).slice(0, maxRef) : [];
  const remainingForAssets = Math.max(0, maxRef - exploreIds.length);
  const assetIds = refVisible ? (draft.referenceAssetIds || []).slice(0, remainingForAssets) : [];

  return {
    ...draft,
    modelId: model.id,
    aspectRatio: caps.aspectRatio.visible ? compatible(draft.aspectRatio, caps.aspectRatio.values) : undefined,
    outputResolution: caps.outputResolution.visible ? compatible(draft.outputResolution, caps.outputResolution.values) : undefined,
    requestedOutputCount: caps.requestedOutputCount.visible
      ? compatible(draft.requestedOutputCount, caps.requestedOutputCount.values)
      : undefined,
    exploreImageIds: exploreIds,
    referenceAssetIds: assetIds
  };
}

function Control({ children, className = "", ...props }) {
  return (
    <button
      type="button"
      className={`inline-flex min-h-10 items-center gap-2 rounded-xl border border-[#111111]/15 bg-white px-3 text-sm font-medium shadow-sm transition-colors hover:bg-[#EFECE1] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#111111] disabled:cursor-not-allowed disabled:opacity-50 ${className}`}
      {...props}
    >
      {children}
    </button>
  );
}

export default function ImageStudio() {
  const { account } = useAppAccount();
  const [models, setModels] = useState([]);
  const [assets, setAssets] = useState([]);
  const [draft, setDraft] = useState({ prompt: "", referenceAssetIds: [], exploreImageIds: [] });
  const [quote, setQuote] = useState(null);
  const [quoteState, setQuoteState] = useState("idle");
  const [quoteAttempt, setQuoteAttempt] = useState(0);
  const [error, setError] = useState("");
  const [assetLoadError, setAssetLoadError] = useState("");
  const [loading, setLoading] = useState(true);
  const [modelReloadToken, setModelReloadToken] = useState(0);
  const [generation, setGeneration] = useState(null);
  const [modelOpen, setModelOpen] = useState(false);
  const [assetOpen, setAssetOpen] = useState(false);
  const [modelSearch, setModelSearch] = useState("");
  const [uploading, setUploading] = useState(false);
  const [workspaceView, setWorkspaceView] = useState("explore"); // 'explore' | 'result'
  const [mobileTab, setMobileTab] = useState("composer"); // 'composer' | 'explore'

  const input = useRef(null);
  const popover = useRef(null);
  const idempotencyKey = useRef(null);

  const refreshAssets = async (signal) => {
    try {
      const response = await fetch("/api/assets", { signal });
      const data = await readApiJson(response, "Your image assets could not be loaded.");
      if (!Array.isArray(data.assets)) throw new Error("Your image assets could not be loaded because the API response was invalid.");
      if (signal?.aborted) return;
      setAssets(data.assets.filter((asset) => asset?.mimeType?.startsWith("image/")));
      setAssetLoadError("");
    } catch (assetError) {
      if (assetError.name === "AbortError" || signal?.aborted) throw assetError;
      setAssetLoadError(assetError.message || "My Assets could not be loaded. Explore references and text-to-image remain available.");
      throw assetError;
    }
  };

  useEffect(() => {
    const controller = new AbortController();
    const loadStudio = async () => {
      setLoading(true);
      setError("");
      // Asset discovery is non-blocking: a temporary library failure must not
      // prevent text-to-image or curated Explore reference generation.
      void refreshAssets(controller.signal).catch(() => {});
      try {
        const response = await fetch("/api/image-models", { signal: controller.signal });
        const modelData = await readApiJson(response, "Image models could not be loaded.");
        if (!Array.isArray(modelData.models)) throw new Error("Image models could not be loaded because the API response was invalid.");
        const invalid = modelData.models.find((item) => item?.available && !hasValidCapabilities(item));
        if (invalid) throw new Error(`Image model ${invalid.displayName || invalid.id || "configuration"} has invalid capabilities. Please retry or contact support.`);
        const enabled = modelData.models.filter((item) => item.available);
        if (!enabled.length) throw new Error("No image models are currently enabled. Please retry later or contact support.");
        if (!controller.signal.aborted) {
          setModels(enabled);
          setDraft((current) => normalize(enabled[0], current));
        }
      } catch (discoveryError) {
        if (discoveryError.name !== "AbortError" && !controller.signal.aborted) {
          setModels([]);
          setError(discoveryError.message || "Image Studio is temporarily unavailable. Please retry.");
        }
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    };
    void loadStudio();
    return () => controller.abort();
  }, [modelReloadToken]);

  const model = models.find((item) => item.id === draft.modelId);
  const caps = model?.productCapabilities;
  const totalAttachedReferences = (draft.referenceAssetIds?.length || 0) + (draft.exploreImageIds?.length || 0);
  const minimumReferences = caps?.referenceImages?.visible ? caps.referenceImages.min : 0;
  const missingRequiredReferences = totalAttachedReferences < minimumReferences;
  const selectedAssets = assets.filter((asset) => (draft.referenceAssetIds || []).includes(asset.id));
  const selectedExploreItems = (draft.exploreImageIds || []).map((id) => getExploreImageById(id)).filter(Boolean);

  const filteredModels = useMemo(
    () => models.filter((entry) => `${entry.displayName} ${entry.id}`.toLowerCase().includes(modelSearch.toLowerCase())),
    [models, modelSearch]
  );

  const invalidateQuote = () => {
    setQuote(null);
    setQuoteState("idle");
  };

  const mutate = (next) => {
    invalidateQuote();
    setError("");
    setDraft((current) => ({ ...current, ...next }));
  };

  const selectModel = (next) => {
    invalidateQuote();
    setError("");
    setModelOpen(false);
    setModelSearch("");
    setDraft((current) => normalize(next, current));
  };

  const toggleAsset = (assetId) => {
    if (!caps?.referenceImages?.visible) return;
    const currentAssets = draft.referenceAssetIds || [];
    const currentExplore = draft.exploreImageIds || [];
    const isSelected = currentAssets.includes(assetId);
    const maxRef = caps.referenceImages.max || 0;

    if (isSelected) {
      mutate({ referenceAssetIds: currentAssets.filter((id) => id !== assetId) });
    } else {
      if (currentAssets.length + currentExplore.length >= maxRef) return;
      mutate({ referenceAssetIds: [...currentAssets, assetId] });
    }
  };

  const toggleExploreReference = (exploreId) => {
    if (!caps?.referenceImages?.visible) return;
    const currentAssets = draft.referenceAssetIds || [];
    const currentExplore = draft.exploreImageIds || [];
    const isSelected = currentExplore.includes(exploreId);
    const maxRef = caps.referenceImages.max || 0;

    if (isSelected) {
      mutate({ exploreImageIds: currentExplore.filter((id) => id !== exploreId) });
    } else {
      if (currentAssets.length + currentExplore.length >= maxRef) return;
      mutate({ exploreImageIds: [...currentExplore, exploreId] });
      // If on mobile, switch to composer tab to see attached reference
      if (typeof window !== "undefined" && window.innerWidth < 768) {
        setMobileTab("composer");
      }
    }
  };

  useEffect(() => {
    const close = (event) => {
      if (event.key === "Escape") {
        setModelOpen(false);
        setAssetOpen(false);
      }
      if (event.type === "pointerdown" && popover.current && !popover.current.contains(event.target)) {
        setModelOpen(false);
      }
    };
    window.addEventListener("keydown", close);
    window.addEventListener("pointerdown", close);
    return () => {
      window.removeEventListener("keydown", close);
      window.removeEventListener("pointerdown", close);
    };
  }, []);

  useEffect(() => {
    if (!model || !draft.prompt.trim()) return undefined;
    if (missingRequiredReferences) {
      setQuote(null);
      setQuoteState("idle");
      setError(referenceMinimumMessage(minimumReferences));
      return undefined;
    }
    setQuoteState("calculating");
    const timer = setTimeout(async () => {
      try {
        const response = await fetch("/api/images/preflight", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ version: "image-generation.v1", ...draft })
        });
        const contentType = response.headers.get("content-type") || "";
        if (!contentType.toLowerCase().includes("application/json")) {
          throw new Error(`Pricing could not be calculated because the server returned an unexpected response (${response.status}).`);
        }
        const data = await response.json();
        if (!response.ok) {
          setQuote(null);
          setQuoteState(data.code === "INSUFFICIENT_CREDITS" ? "insufficient" : "unavailable");
          setError(
            apiErrorMessage(
              data,
              data.code === "INSUFFICIENT_CREDITS"
                ? "Add credits to generate this image."
                : "Pricing is temporarily unavailable."
            )
          );
          return;
        }
        setError("");
        setQuote(data.quote);
        setQuoteState("ready");
      } catch (preflightError) {
        setQuote(null);
        setQuoteState("unavailable");
        setError(preflightError.message || "Pricing is temporarily unavailable. Please retry.");
      }
    }, 450);
    return () => clearTimeout(timer);
  }, [draft, model, quoteAttempt, missingRequiredReferences, minimumReferences]);

  const upload = async (files) => {
    const file = files?.[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setError("Choose a PNG, JPEG, or WebP image.");
      return;
    }
    if (file.size > 15 * 1024 * 1024) {
      setError("Images must be 15 MB or smaller.");
      return;
    }

    setUploading(true);
    setError("");
    try {
      const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
      const checksumSha256 = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
      const prep = await fetch("/api/uploads/presign", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ filename: file.name, contentType: file.type, fileSizeBytes: file.size, checksumSha256 })
      });
      const presign = await prep.json();
      if (!prep.ok) throw new Error(presign.error || "Upload could not start.");
      if (!presign.alreadyUploaded) {
        const put = await fetch(presign.uploadUrl, { method: "PUT", headers: presign.requiredHeaders, body: file });
        if (!put.ok) throw new Error("Upload could not be completed.");
      }
      const complete = await fetch("/api/uploads/complete", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ assetId: presign.assetId })
      });
      const data = await complete.json();
      if (!complete.ok) throw new Error(data.error || "Image validation failed.");
      await refreshAssets();
      
      const currentExplore = draft.exploreImageIds || [];
      const currentAssets = draft.referenceAssetIds || [];
      const maxRef = caps?.referenceImages?.max || 0;
      if (currentAssets.length + currentExplore.length < maxRef) {
        mutate({ referenceAssetIds: [...currentAssets, data.asset.assetId] });
      }
      setAssetOpen(true);
    } catch (uploadError) {
      setError(uploadError.message || "Upload failed. Try again.");
    } finally {
      setUploading(false);
    }
  };

  const generate = async () => {
    if (missingRequiredReferences) {
      setError(referenceMinimumMessage(minimumReferences));
      return;
    }
    if (!quote || quoteState !== "ready" || generation) return;
    setQuoteState("submitting");
    setWorkspaceView("result");
    idempotencyKey.current ||= crypto.randomUUID();
    try {
      const response = await fetch("/api/images/generations", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ quoteId: quote.id, idempotencyKey: idempotencyKey.current })
      });
      const contentType = response.headers.get("content-type") || "";
      if (!contentType.toLowerCase().includes("application/json")) {
        throw new Error(`Generation could not start because the server returned an unexpected response (${response.status}).`);
      }
      const data = await response.json();
      if (!response.ok) throw new Error(apiErrorMessage(data, "Generation could not start."));
      setGeneration({ id: data.creationId, status: data.status || "PROCESSING", urls: [] });
      setQuoteState("generating");
    } catch (generationError) {
      idempotencyKey.current = null;
      setQuoteState("ready");
      setError(generationError.message || "Generation could not start. Try again.");
    }
  };

  const retryGeneration = () => {
    idempotencyKey.current = null;
    setGeneration(null);
    setError("");
    invalidateQuote();
    setQuoteAttempt((attempt) => attempt + 1);
  };

  const createAnother = () => {
    idempotencyKey.current = null;
    setGeneration(null);
    setError("");
    setWorkspaceView("explore");
    setMobileTab("composer");
    invalidateQuote();
    setQuoteAttempt((attempt) => attempt + 1);
  };

  useEffect(() => {
    if (
      !generation?.id ||
      generation.status === "FAILED" ||
      (generation.status === "COMPLETED" && generation.urls?.length)
    ) return undefined;
    let active = true;
    const poll = async () => {
      try {
        const response = await fetch(`/api/images/generations/${generation.id}/result`, { method: "POST" });
        const contentType = response.headers.get("content-type") || "";
        if (!contentType.toLowerCase().includes("application/json")) {
          throw new Error(`Generation status returned an unexpected response (${response.status}).`);
        }
        const data = await response.json();
        if (!response.ok) {
          if (response.status === 404) {
            setGeneration((current) =>
              current?.id === generation.id
                ? { ...current, status: "FAILED", message: "This generation is no longer available." }
                : current
            );
          } else if (active) {
            setGeneration((current) =>
              current?.id === generation.id
                ? { ...current, message: apiErrorMessage(data, "Generation status is temporarily unavailable; retrying.") }
                : current
            );
          }
          return;
        }
        const next = { ...data };
        if (data.status === "COMPLETED") {
          next.status = "FINALIZING";
          next.message = "Generation is complete. Finalizing delivery of your image files…";
          try {
            const delivered = await loadDeliveredImages(generation.id, Number(data.artifactCount) || 0);
            if (delivered.length) {
              next.status = "COMPLETED";
              next.urls = delivered.map((item) => item.url);
              next.message = "";
            }
          } catch (deliveryError) {
            next.message = `${deliveryError.message || "Generated images could not be loaded yet."} Finalizing delivery and retrying…`;
          }
        }
        if (active) setGeneration((current) => (current?.id === generation.id ? { ...current, ...next } : current));
      } catch (pollError) {
        if (active) {
          setGeneration((current) =>
            current?.id === generation.id
              ? { ...current, message: pollError.message || "Generation status is temporarily unavailable; retrying." }
              : current
          );
        }
      }
    };
    void poll();
    const timer = setInterval(() => void poll(), 5000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [generation?.id, generation?.status, generation?.urls?.length]);

  const buttonText = !draft.prompt.trim()
    ? "Generate"
    : quoteState === "calculating"
    ? "Calculating…"
    : quoteState === "insufficient"
    ? "Insufficient credits"
    : quoteState === "unavailable"
    ? "Unavailable"
    : quoteState === "submitting"
    ? "Submitting…"
    : quoteState === "generating"
    ? "Generating…"
    : quote
    ? `Generate · ${quote.credits} credits`
    : "Generate";

  return (
    <div className="flex h-full min-h-0 w-full flex-col overflow-hidden rounded-[26px] border border-[#111111]/15 bg-[#FAF8ED] text-[#111111] shadow-sm md:flex-row">
      {/* Mobile Tab Switcher */}
      <div className="flex border-b border-[#111111]/15 bg-white md:hidden">
        <button
          type="button"
          onClick={() => setMobileTab("composer")}
          className={`flex flex-1 items-center justify-center gap-2 py-3 text-xs font-bold ${
            mobileTab === "composer"
              ? "border-b-2 border-[#111111] text-[#111111]"
              : "text-[#77746D] hover:text-[#111111]"
          }`}
        >
          <FiImage size={15} /> Compose Draft
        </button>
        <button
          type="button"
          onClick={() => setMobileTab("explore")}
          className={`flex flex-1 items-center justify-center gap-2 py-3 text-xs font-bold ${
            mobileTab === "explore"
              ? "border-b-2 border-[#111111] text-[#111111]"
              : "text-[#77746D] hover:text-[#111111]"
          }`}
        >
          <FiCompass size={15} /> Explore Images {totalAttachedReferences > 0 && `(${totalAttachedReferences})`}
        </button>
      </div>

      {/* Composer Sidebar */}
      <aside
        className={`flex w-full shrink-0 flex-col overflow-y-auto border-r border-[#111111]/15 bg-white p-4 md:w-[440px] max-w-[480px] sm:p-5 ${
          mobileTab === "composer" ? "flex" : "hidden md:flex"
        }`}
      >
        <div className="mb-5 flex items-center justify-between">
          <div>
            <h1 className="font-serif text-2xl font-bold">Create an image</h1>
            <p className="mt-0.5 text-xs text-[#66635C]">Your balance: {account?.credits ?? "—"} credits</p>
          </div>
          {generation && workspaceView !== "explore" && (
            <button
              type="button"
              onClick={() => setWorkspaceView("explore")}
              className="inline-flex items-center gap-1 rounded-xl border border-[#111111]/15 bg-[#FAF8ED] px-2.5 py-1.5 text-xs font-semibold text-[#111111] hover:bg-[#EFECE1]"
            >
              <FiCompass size={14} /> Explore gallery
            </button>
          )}
        </div>

        {loading ? (
          <div className="space-y-3">
            <div className="h-24 animate-pulse rounded-2xl bg-[#EFECE1]" />
            <div className="h-10 animate-pulse rounded-xl bg-[#EFECE1]" />
          </div>
        ) : (
          <>
            <label className="mb-2 block text-sm font-semibold">
              Prompt
              <textarea
                value={draft.prompt}
                onChange={(event) => mutate({ prompt: event.target.value })}
                placeholder="Describe the image you want to create"
                className="mt-2 min-h-28 w-full resize-y rounded-2xl border border-[#111111]/15 bg-[#FAF8ED] p-3 text-sm leading-6 outline-none focus:border-[#111111]"
              />
            </label>

            {/* Reference Images Section */}
            {caps?.referenceImages.visible && (
              <div className="mb-4">
                <div className="mb-2 flex items-center justify-between">
                  <p className="text-sm font-semibold">
                    Reference images{" "}
                    <span className="font-normal text-[#77746D]">
                      {totalAttachedReferences}/{caps.referenceImages.max}
                      {minimumReferences > 0 ? ` · minimum ${minimumReferences}` : ""}
                    </span>
                  </p>
                </div>
                {assetLoadError && (
                  <div role="status" className="mb-2 flex items-center justify-between gap-3 rounded-xl bg-[#FFF6D9] px-3 py-2 text-xs text-[#6F5310]">
                    <span>{assetLoadError} Explore references are still available.</span>
                    <button type="button" className="shrink-0 font-bold underline" onClick={() => void refreshAssets().catch(() => {})}>
                      Retry
                    </button>
                  </div>
                )}

                <div
                  onDragOver={(event) => event.preventDefault()}
                  onDrop={(event) => {
                    event.preventDefault();
                    void upload(event.dataTransfer.files);
                  }}
                  className="rounded-2xl border border-dashed border-[#111111]/25 bg-[#FAF8ED] p-3"
                >
                  <div className="flex flex-wrap gap-2">
                    <Control onClick={() => input.current?.click()} disabled={uploading}>
                      <FiUploadCloud />
                      {uploading ? "Uploading…" : "Upload new"}
                    </Control>
                    <Control onClick={() => setAssetOpen((open) => !open)}>
                      <FiPlus />
                      My Assets
                    </Control>
                  </div>

                  <input
                    ref={input}
                    type="file"
                    accept="image/png,image/jpeg,image/webp"
                    className="sr-only"
                    onChange={(event) => {
                      void upload(event.target.files);
                      event.target.value = "";
                    }}
                  />

                  {/* Attached References Strip */}
                  {(selectedAssets.length > 0 || selectedExploreItems.length > 0) && (
                    <div className="mt-3 flex flex-wrap gap-2.5">
                      {/* Curated Explore References */}
                      {selectedExploreItems.map((item) => (
                        <div
                          key={`explore-${item.id}`}
                          className="group relative h-14 w-14 overflow-hidden rounded-xl border border-[#111111]/20 bg-white shadow-sm"
                        >
                          <img src={item.thumbUrl} alt={item.title} className="h-full w-full object-cover" />
                          <span className="absolute bottom-0 inset-x-0 bg-[#111111]/80 py-0.5 text-[8px] font-bold text-white text-center tracking-tighter">
                            CURATED
                          </span>
                          <button
                            type="button"
                            onClick={() => toggleExploreReference(item.id)}
                            aria-label={`Remove ${item.title}`}
                            className="absolute right-0.5 top-0.5 rounded-full bg-[#111111] p-1 text-white shadow-md hover:bg-black"
                          >
                            <FiX size={10} />
                          </button>
                        </div>
                      ))}

                      {/* User Assets References */}
                      {selectedAssets.map((asset) => (
                        <div
                          key={`asset-${asset.id}`}
                          className="group relative h-14 w-14 overflow-hidden rounded-xl border border-[#111111]/20 bg-white shadow-sm"
                        >
                          <img src={asset.url} alt={asset.originalFileName} className="h-full w-full object-cover" />
                          <span className="absolute bottom-0 inset-x-0 bg-[#111111]/70 py-0.5 text-[8px] font-bold text-white text-center tracking-tighter">
                            MY ASSET
                          </span>
                          <button
                            type="button"
                            onClick={() => toggleAsset(asset.id)}
                            aria-label={`Remove ${asset.originalFileName}`}
                            className="absolute right-0.5 top-0.5 rounded-full bg-[#111111] p-1 text-white shadow-md hover:bg-black"
                          >
                            <FiX size={10} />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* My Assets Picker Drawer */}
                  {assetOpen && (
                    <div className="mt-3 grid max-h-40 grid-cols-4 gap-2 overflow-y-auto border-t border-[#111111]/10 pt-3">
                      {assets.length ? (
                        assets.map((asset) => {
                          const isSelected = (draft.referenceAssetIds || []).includes(asset.id);
                          return (
                            <button
                              type="button"
                              key={asset.id}
                              onClick={() => toggleAsset(asset.id)}
                              aria-pressed={isSelected}
                              className={`relative aspect-square overflow-hidden rounded-xl border ${
                                isSelected ? "border-[#111111] ring-2 ring-[#E6D9FF]" : "border-[#111111]/15"
                              }`}
                            >
                              <img src={asset.url} alt={asset.originalFileName} className="h-full w-full object-cover" />
                              {isSelected && <FiCheck className="absolute right-1 top-1 rounded-full bg-white text-[#111111]" size={14} />}
                            </button>
                          );
                        })
                      ) : (
                        <p className="col-span-4 py-2 text-xs text-[#66635C]">
                          No uploaded assets yet. Upload an image above to add your first asset.
                        </p>
                      )}
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Model & Configuration Controls */}
            <div className="space-y-3 border-t border-[#111111]/10 pt-4">
              <div ref={popover} className="relative">
                <p className="mb-2 text-sm font-semibold">Model</p>
                <Control onClick={() => setModelOpen((open) => !open)} aria-expanded={modelOpen} className="w-full justify-between">
                  <span className="truncate">{model?.displayName || "No model available"}</span>
                  <FiChevronDown />
                </Control>
                {modelOpen && (
                  <div className="absolute bottom-12 z-40 w-full rounded-2xl border border-[#111111]/15 bg-white p-2 shadow-xl">
                    <label className="relative block">
                      <FiSearch className="absolute left-3 top-1/2 -translate-y-1/2 text-[#77746D]" />
                      <input
                        autoFocus
                        value={modelSearch}
                        onChange={(event) => setModelSearch(event.target.value)}
                        placeholder="Search models"
                        className="w-full rounded-xl border border-[#111111]/15 bg-[#FAF8ED] py-2 pl-9 pr-3 text-xs outline-none"
                      />
                    </label>
                    <div className="mt-1 max-h-56 overflow-y-auto">
                      {filteredModels.map((entry) => (
                        <button
                          key={entry.id}
                          type="button"
                          onClick={() => selectModel(entry)}
                          className="flex w-full items-center justify-between rounded-xl px-3 py-2.5 text-left hover:bg-[#EFECE1]"
                        >
                          <span>
                            <span className="block text-xs font-semibold">{entry.displayName}</span>
                            <span className="block text-[11px] text-[#77746D]">
                              {entry.productCapabilities.referenceImages.visible ? "Image reference supported" : "Text to image"}
                              {entry.productCapabilities.outputResolution.visible
                                ? ` · ${entry.productCapabilities.outputResolution.values.join(", ")}`
                                : ""}
                            </span>
                          </span>
                          {entry.id === model?.id && <FiCheck />}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              <div className="flex flex-wrap gap-2">
                {caps?.aspectRatio.visible && (
                  <StudioSelect
                    label="Aspect ratio"
                    value={draft.aspectRatio}
                    values={caps.aspectRatio.values}
                    onChange={(aspectRatio) => mutate({ aspectRatio })}
                  />
                )}
                {caps?.outputResolution.visible && (
                  <StudioSelect
                    label="Resolution"
                    value={draft.outputResolution}
                    values={caps.outputResolution.values}
                    onChange={(outputResolution) => mutate({ outputResolution })}
                  />
                )}
                {caps?.requestedOutputCount.visible && (
                  <StudioSelect
                    label="Output count"
                    value={String(draft.requestedOutputCount)}
                    values={caps.requestedOutputCount.values.map(String)}
                    onChange={(requestedOutputCount) => mutate({ requestedOutputCount: Number(requestedOutputCount) })}
                  />
                )}
              </div>
            </div>

            <button
              disabled={
                !model ||
                !draft.prompt.trim() ||
                missingRequiredReferences ||
                quoteState === "calculating" ||
                quoteState === "unavailable" ||
                quoteState === "insufficient" ||
                quoteState === "submitting" ||
                quoteState === "generating"
              }
              onClick={generate}
              className="mt-5 min-h-12 w-full rounded-xl border border-[#111111] bg-[#E6D9FF] px-4 text-sm font-bold shadow-sm transition-colors hover:bg-[#DBCBFF] disabled:cursor-not-allowed disabled:opacity-50"
            >
              {buttonText}
            </button>
            {error && <p role="alert" className="mt-3 text-xs text-[#9A2C2C]">{error}</p>}
            {!models.length && (
              <Control onClick={() => setModelReloadToken((token) => token + 1)} className="mt-3">
                Retry loading image models
              </Control>
            )}
          </>
        )}
      </aside>

      {/* Main Workspace Area (Desktop Flex-1 / Mobile Tab) */}
      <section
        className={`min-w-0 flex-1 flex-col overflow-hidden ${
          mobileTab === "explore" ? "flex" : "hidden md:flex"
        }`}
      >
        {generation && workspaceView === "result" ? (
          <div className="flex h-full flex-col items-center justify-center p-6 text-center overflow-y-auto">
            <FiLoader
              className={`mx-auto ${
                generation.status === "COMPLETED" || generation.status === "FAILED" ? "hidden" : "animate-spin"
              }`}
              size={32}
            />
            <h2 className="mt-4 font-serif text-2xl font-bold">
              {generation.status === "COMPLETED"
                ? generation.urls?.length > 1 ? "Your images are ready" : "Your image is ready"
                : generation.status === "FAILED"
                ? "Image generation didn’t complete"
                : generation.status === "FINALIZING"
                ? "Finalizing delivery"
                : "Creating your image"}
            </h2>

            {generation.status === "COMPLETED" && generation.urls?.length ? (
              <>
                <div className={`mt-5 grid w-full max-w-5xl gap-4 ${generation.urls.length > 1 ? "sm:grid-cols-2" : "grid-cols-1"}`}>
                  {generation.urls.map((url, index) => (
                    <img
                      key={`${url}-${index}`}
                      src={url}
                      alt={generation.urls.length > 1 ? `Generated image ${index + 1}` : "Generated image"}
                      className="mx-auto max-h-[55vh] max-w-full rounded-2xl border border-[#111111]/15 object-contain shadow-md"
                    />
                  ))}
                </div>
                <div className="mt-5 flex flex-wrap items-center justify-center gap-3">
                  <Control onClick={createAnother}>
                    <FiPlus size={14} /> Create another
                  </Control>
                  <Link href="/app?tab=library" className="inline-flex items-center gap-2 rounded-xl border border-[#111111]/15 bg-white px-4 py-2 text-xs font-bold shadow-sm hover:bg-[#EFECE1]">
                    Open My Library
                  </Link>
                  <button
                    type="button"
                    onClick={() => setWorkspaceView("explore")}
                    className="inline-flex items-center gap-2 rounded-xl border border-[#111111] bg-[#E6D9FF] px-4 py-2 text-xs font-bold shadow-sm hover:bg-[#DBCBFF]"
                  >
                    <FiCompass size={14} /> Browse Explore images
                  </button>
                </div>
              </>
            ) : generation.status === "FAILED" ? (
              <>
                <p className="mt-2 text-xs text-[#66635C]">
                  {generation.message || "Please try again. Your credits are handled safely."}
                </p>
                <Control onClick={retryGeneration} className="mt-4">
                  Try again
                </Control>
              </>
            ) : (
              <p className="mt-2 text-xs text-[#66635C]">
                {generation.message || "You can keep working or return to My Library later."}
              </p>
            )}
          </div>
        ) : (
          <ExploreGallery
            selectedModel={model}
            selectedExploreIds={draft.exploreImageIds || []}
            selectedAssetIds={draft.referenceAssetIds || []}
            onToggleExploreReference={toggleExploreReference}
          />
        )}
      </section>
    </div>
  );
}
