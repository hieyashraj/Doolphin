"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  FiCheck,
  FiChevronDown,
  FiImage,
  FiLoader,
  FiPlus,
  FiSearch,
  FiUploadCloud,
  FiX
} from "react-icons/fi";
import StudioSelect from "@/components/studio/StudioSelect";
import { useAppAccount } from "@/components/AppAccountProvider";

const compatible = (value, values) => values.includes(value) ? value : values[0];

function normalize(model, draft) {
  const caps = model.productCapabilities;
  return {
    ...draft,
    modelId: model.id,
    aspectRatio: caps.aspectRatio.visible ? compatible(draft.aspectRatio, caps.aspectRatio.values) : undefined,
    outputResolution: caps.outputResolution.visible ? compatible(draft.outputResolution, caps.outputResolution.values) : undefined,
    requestedOutputCount: caps.requestedOutputCount.visible
      ? compatible(draft.requestedOutputCount, caps.requestedOutputCount.values)
      : undefined,
    referenceAssetIds: caps.referenceImages.visible
      ? draft.referenceAssetIds.slice(0, caps.referenceImages.max)
      : []
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
  const [draft, setDraft] = useState({ prompt: "", referenceAssetIds: [] });
  const [quote, setQuote] = useState(null);
  const [quoteState, setQuoteState] = useState("idle");
  const [quoteAttempt, setQuoteAttempt] = useState(0);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [generation, setGeneration] = useState(null);
  const [modelOpen, setModelOpen] = useState(false);
  const [assetOpen, setAssetOpen] = useState(false);
  const [modelSearch, setModelSearch] = useState("");
  const [uploading, setUploading] = useState(false);
  const input = useRef(null);
  const popover = useRef(null);
  const idempotencyKey = useRef(null);

  const refreshAssets = async () => {
    const response = await fetch("/api/assets");
    const data = await response.json();
    setAssets((data.assets || []).filter((asset) => asset.mimeType?.startsWith("image/")));
  };

  useEffect(() => {
    Promise.all([fetch("/api/image-models").then((response) => response.json()), refreshAssets()])
      .then(([modelData]) => {
        const enabled = (modelData.models || []).filter((item) => item.available);
        setModels(enabled);
        if (enabled[0]) setDraft((current) => normalize(enabled[0], current));
      })
      .catch(() => setError("Image Studio is temporarily unavailable. Please retry."))
      .finally(() => setLoading(false));
  }, []);

  const model = models.find((item) => item.id === draft.modelId);
  const caps = model?.productCapabilities;
  const selectedAssets = assets.filter((asset) => draft.referenceAssetIds.includes(asset.id));
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
    if (!caps?.referenceImages.visible) return;
    const selected = draft.referenceAssetIds.includes(assetId);
    mutate({
      referenceAssetIds: selected
        ? draft.referenceAssetIds.filter((id) => id !== assetId)
        : [...draft.referenceAssetIds, assetId].slice(0, caps.referenceImages.max)
    });
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
    setQuoteState("calculating");
    const timer = setTimeout(async () => {
      try {
        const response = await fetch("/api/images/preflight", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ version: "image-generation.v1", ...draft })
        });
        const data = await response.json();
        if (!response.ok) {
          setQuote(null);
          setQuoteState(data.code === "INSUFFICIENT_CREDITS" ? "insufficient" : "unavailable");
          setError(data.error || (data.code === "INSUFFICIENT_CREDITS"
            ? "Add credits to generate this image."
            : "Pricing is temporarily unavailable."));
          return;
        }
        setQuote(data.quote);
        setQuoteState("ready");
      } catch {
        setQuoteState("unavailable");
        setError("Pricing is temporarily unavailable. Please retry.");
      }
    }, 450);
    return () => clearTimeout(timer);
  }, [draft, model, quoteAttempt]);

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
      mutate({ referenceAssetIds: [...draft.referenceAssetIds, data.asset.assetId].slice(0, caps.referenceImages.max) });
      setAssetOpen(true);
    } catch (uploadError) {
      setError(uploadError.message || "Upload failed. Try again.");
    } finally {
      setUploading(false);
    }
  };

  const generate = async () => {
    if (!quote || quoteState !== "ready" || generation) return;
    setQuoteState("submitting");
    idempotencyKey.current ||= crypto.randomUUID();
    try {
      const response = await fetch("/api/images/generations", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ quoteId: quote.id, idempotencyKey: idempotencyKey.current })
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Generation could not start.");
      setGeneration({ id: data.creationId, status: data.status || "PROCESSING" });
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

  useEffect(() => {
    if (!generation?.id || ["COMPLETED", "FAILED"].includes(generation.status)) return undefined;
    let active = true;
    const poll = async () => {
      try {
        const response = await fetch(`/api/images/generations/${generation.id}/result`, { method: "POST" });
        const data = await response.json();
        if (!response.ok) {
          if (response.status === 404) {
            setGeneration((current) => current?.id === generation.id
              ? { ...current, status: "FAILED", message: "This generation is no longer available." }
              : current);
          }
          return;
        }
        const next = { ...data };
        if (data.status === "COMPLETED") {
          const images = await fetch("/api/my-images").then((result) => result.json());
          next.url = images.items?.find((item) => item.creationId === generation.id)?.url;
        }
        if (active) setGeneration((current) => current?.id === generation.id ? { ...current, ...next } : current);
      } catch {
        // Keep the persisted job in its current state and retry on the next interval.
      }
    };
    void poll();
    const timer = setInterval(() => void poll(), 5000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [generation?.id, generation?.status]);

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
    <div className="flex h-full min-h-0 w-full overflow-hidden rounded-[26px] border border-[#111111]/15 bg-[#FAF8ED] text-[#111111] shadow-sm">
      <aside className="flex w-full shrink-0 flex-col overflow-y-auto border-r border-[#111111]/15 bg-white p-4 sm:w-[380px] sm:p-5">
        <div className="mb-6">
          <p className="text-xs font-bold tracking-[0.16em] text-[#77746D]">IMAGE STUDIO</p>
          <h1 className="mt-1 font-serif text-2xl font-bold">Create an image</h1>
          <p className="mt-1 text-sm text-[#66635C]">Your balance: {account?.credits ?? "—"} credits</p>
        </div>
        {loading ? (
          <div className="space-y-3"><div className="h-24 animate-pulse rounded-2xl bg-[#EFECE1]" /><div className="h-10 animate-pulse rounded-xl bg-[#EFECE1]" /></div>
        ) : (
          <>
            <label className="mb-2 block text-sm font-semibold">Prompt
              <textarea value={draft.prompt} onChange={(event) => mutate({ prompt: event.target.value })} placeholder="Describe the image you want to create" className="mt-2 min-h-32 w-full resize-y rounded-2xl border border-[#111111]/15 bg-[#FAF8ED] p-3 text-sm leading-6 outline-none focus:border-[#111111]" />
            </label>
            {caps?.referenceImages.visible && <div className="mb-4"><p className="mb-2 text-sm font-semibold">Reference images <span className="font-normal text-[#77746D]">{draft.referenceAssetIds.length}/{caps.referenceImages.max}</span></p><div onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); void upload(event.dataTransfer.files); }} className="rounded-2xl border border-dashed border-[#111111]/25 bg-[#FAF8ED] p-3"><div className="flex gap-2"><Control onClick={() => input.current?.click()} disabled={uploading}><FiUploadCloud />{uploading ? "Uploading…" : "Upload new"}</Control><Control onClick={() => setAssetOpen((open) => !open)}><FiPlus />Choose from My Assets</Control></div><input ref={input} type="file" accept="image/png,image/jpeg,image/webp" className="sr-only" onChange={(event) => { void upload(event.target.files); event.target.value = ""; }} />{selectedAssets.length > 0 && <div className="mt-3 flex flex-wrap gap-2">{selectedAssets.map((asset) => <div key={asset.id} className="relative h-12 w-12 overflow-hidden rounded-xl border border-[#111111]/15"><img src={asset.url} alt={asset.originalFileName} className="h-full w-full object-cover" /><button type="button" onClick={() => toggleAsset(asset.id)} aria-label={`Remove ${asset.originalFileName}`} className="absolute right-0.5 top-0.5 rounded-full bg-[#111111] p-1 text-white"><FiX size={11} /></button></div>)}</div>}{assetOpen && <div className="mt-3 grid max-h-40 grid-cols-4 gap-2 overflow-y-auto">{assets.length ? assets.map((asset) => <button type="button" key={asset.id} onClick={() => toggleAsset(asset.id)} aria-pressed={draft.referenceAssetIds.includes(asset.id)} className={`relative aspect-square overflow-hidden rounded-xl border ${draft.referenceAssetIds.includes(asset.id) ? "border-[#111111] ring-2 ring-[#E6D9FF]" : "border-[#111111]/15"}`}><img src={asset.url} alt={asset.originalFileName} className="h-full w-full object-cover" />{draft.referenceAssetIds.includes(asset.id) && <FiCheck className="absolute right-1 top-1 rounded-full bg-white" size={15} />}</button>) : <p className="col-span-4 py-2 text-sm text-[#66635C]">Upload an image above to create your first asset.</p>}</div>}</div></div>}
            <div className="space-y-3 border-t border-[#111111]/10 pt-4"><div ref={popover} className="relative"><p className="mb-2 text-sm font-semibold">Model</p><Control onClick={() => setModelOpen((open) => !open)} aria-expanded={modelOpen} className="w-full justify-between"><span className="truncate">{model?.displayName || "No model available"}</span><FiChevronDown /></Control>{modelOpen && <div className="absolute bottom-12 z-40 w-full rounded-2xl border border-[#111111]/15 bg-white p-2 shadow-xl"><label className="relative block"><FiSearch className="absolute left-3 top-1/2 -translate-y-1/2 text-[#77746D]" /><input autoFocus value={modelSearch} onChange={(event) => setModelSearch(event.target.value)} placeholder="Search models" className="w-full rounded-xl border border-[#111111]/15 bg-[#FAF8ED] py-2 pl-9 pr-3 text-sm outline-none" /></label><div className="mt-1 max-h-56 overflow-y-auto">{filteredModels.map((entry) => <button key={entry.id} type="button" onClick={() => selectModel(entry)} className="flex w-full items-center justify-between rounded-xl px-3 py-2.5 text-left hover:bg-[#EFECE1]"><span><span className="block text-sm font-semibold">{entry.displayName}</span><span className="block text-xs text-[#77746D]">{entry.productCapabilities.referenceImages.visible ? "Image reference supported" : "Text to image"}{entry.productCapabilities.outputResolution.visible ? ` · ${entry.productCapabilities.outputResolution.values.join(", ")}` : ""}</span></span>{entry.id === model?.id && <FiCheck />}</button>)}</div></div>}</div><div className="flex flex-wrap gap-2">{caps?.aspectRatio.visible && <StudioSelect label="Aspect ratio" value={draft.aspectRatio} values={caps.aspectRatio.values} onChange={(aspectRatio) => mutate({ aspectRatio })} />}{caps?.outputResolution.visible && <StudioSelect label="Resolution" value={draft.outputResolution} values={caps.outputResolution.values} onChange={(outputResolution) => mutate({ outputResolution})} />}{caps?.requestedOutputCount.visible && <StudioSelect label="Output count" value={String(draft.requestedOutputCount)} values={caps.requestedOutputCount.values.map(String)} onChange={(requestedOutputCount) => mutate({ requestedOutputCount: Number(requestedOutputCount) })} />}</div></div>
            <button disabled={!model || !draft.prompt.trim() || quoteState === "calculating" || quoteState === "unavailable" || quoteState === "insufficient" || quoteState === "submitting" || quoteState === "generating"} onClick={generate} className="mt-5 min-h-12 w-full rounded-xl border border-[#111111] bg-[#E6D9FF] px-4 text-sm font-bold shadow-sm transition-colors hover:bg-[#DBCBFF] disabled:cursor-not-allowed disabled:opacity-50">{buttonText}</button>
            {error && <p role="alert" className="mt-3 text-sm text-[#9A2C2C]">{error}</p>}
          </>
        )}
      </aside>
      <section className="hidden min-w-0 flex-1 items-center justify-center overflow-y-auto p-6 sm:flex">
        {generation ? <div className="max-w-md text-center"><FiLoader className={`mx-auto ${generation.status === "COMPLETED" || generation.status === "FAILED" ? "hidden" : "animate-spin"}`} size={32} /><h2 className="mt-4 font-serif text-2xl font-bold">{generation.status === "COMPLETED" ? "Your image is ready" : generation.status === "FAILED" ? "Image generation didn’t complete" : "Creating your image"}</h2>{generation.status === "COMPLETED" && generation.url ? <><img src={generation.url} alt="Generated image" className="mt-5 max-h-[55vh] rounded-2xl border border-[#111111]/15" /><Link href="/app?tab=library" className="mt-4 inline-block font-semibold underline">Open My Library</Link></> : generation.status === "FAILED" ? <><p className="mt-2 text-sm text-[#66635C]">{generation.message || "Please try again. Your credits are handled safely."}</p><Control onClick={retryGeneration} className="mt-4">Try again</Control></> : <p className="mt-2 text-sm text-[#66635C]">You can keep working or return to My Library later.</p>}</div> : <div className="max-w-md text-center"><FiImage className="mx-auto text-[#77746D]" size={38} /><h2 className="mt-4 font-serif text-3xl font-bold">Your workspace</h2><p className="mt-2 text-sm leading-6 text-[#66635C]">Choose a model and describe what you want to create. Your completed work is saved in My Library.</p></div>}
      </section>
    </div>
  );
}
