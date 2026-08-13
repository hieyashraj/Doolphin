"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { FiCheck, FiChevronDown, FiImage, FiLoader, FiPlus, FiSearch, FiX } from "react-icons/fi";

const compatible = (value, values) => values.includes(value) ? value : values[0];

function normalize(model, draft) {
  const caps = model.productCapabilities;
  return {
    ...draft,
    modelId: model.id,
    aspectRatio: caps.aspectRatio.visible ? compatible(draft.aspectRatio, caps.aspectRatio.values) : undefined,
    outputResolution: caps.outputResolution.visible ? compatible(draft.outputResolution, caps.outputResolution.values) : undefined,
    requestedOutputCount: caps.requestedOutputCount.visible ? compatible(draft.requestedOutputCount, caps.requestedOutputCount.values) : undefined,
    referenceAssetIds: caps.referenceImages.visible ? draft.referenceAssetIds.slice(0, caps.referenceImages.max) : [],
  };
}

function Control({ children, className = "", ...props }) {
  return <button type="button" className={`inline-flex min-h-10 items-center gap-2 rounded-full border border-[#111111]/15 bg-white px-3.5 text-sm font-medium text-[#33312C] shadow-sm transition-colors hover:bg-[#EFECE1] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#111111] ${className}`} {...props}>{children}</button>;
}

function SelectPill({ label, value, values, onChange }) {
  return <label className="relative inline-flex min-w-0">
    <span className="sr-only">{label}</span>
    <select value={value || ""} onChange={(event) => onChange(event.target.value)} className="h-10 max-w-[132px] appearance-none rounded-full border border-[#111111]/15 bg-white py-0 pl-3.5 pr-8 text-sm font-medium text-[#33312C] shadow-sm outline-none transition-colors hover:bg-[#EFECE1] focus:border-[#111111]">
      {values.map((entry) => <option key={entry} value={entry}>{entry}</option>)}
    </select>
    <FiChevronDown aria-hidden="true" className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[#66635C]" size={15} />
  </label>;
}

export default function ImageStudio() {
  const [models, setModels] = useState([]);
  const [assets, setAssets] = useState([]);
  const [draft, setDraft] = useState({ prompt: "", referenceAssetIds: [] });
  const [quote, setQuote] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [generation, setGeneration] = useState(null);
  const [modelOpen, setModelOpen] = useState(false);
  const [assetOpen, setAssetOpen] = useState(false);
  const [modelSearch, setModelSearch] = useState("");
  const modelPopover = useRef(null);

  useEffect(() => {
    const close = (event) => { if (modelPopover.current && !modelPopover.current.contains(event.target)) setModelOpen(false); };
    window.addEventListener("pointerdown", close);
    return () => window.removeEventListener("pointerdown", close);
  }, []);

  useEffect(() => {
    Promise.all([fetch("/api/image-models").then((response) => response.json()), fetch("/api/assets").then((response) => response.json())])
      .then(([modelData, assetData]) => {
        const enabled = (modelData.models || []).filter((model) => model.available);
        setModels(enabled);
        setAssets((assetData.assets || []).filter((asset) => asset.mimeType?.startsWith("image/")));
        if (enabled[0]) setDraft((current) => normalize(enabled[0], { ...current, aspectRatio: enabled[0].productCapabilities.aspectRatio.values[0], outputResolution: enabled[0].productCapabilities.outputResolution.values[0], requestedOutputCount: enabled[0].productCapabilities.requestedOutputCount.values[0] }));
      })
      .catch(() => setError("Image Studio is temporarily unavailable."))
      .finally(() => setLoading(false));
  }, []);

  const model = models.find((item) => item.id === draft.modelId);
  const caps = model?.productCapabilities;
  const selectedAssets = assets.filter((asset) => draft.referenceAssetIds.includes(asset.id));
  const filteredModels = useMemo(() => models.filter((item) => item.displayName.toLowerCase().includes(modelSearch.toLowerCase())), [models, modelSearch]);

  const mutate = (next) => { setQuote(null); setError(""); setDraft((current) => ({ ...current, ...next })); };
  const selectModel = (next) => { setQuote(null); setModelOpen(false); setModelSearch(""); setDraft((current) => normalize(next, current)); };
  const toggleAsset = (assetId) => {
    if (!caps) return;
    const selected = draft.referenceAssetIds.includes(assetId);
    mutate({ referenceAssetIds: selected ? draft.referenceAssetIds.filter((id) => id !== assetId) : [...draft.referenceAssetIds, assetId].slice(0, caps.referenceImages.max) });
  };
  const quoteDraft = async () => {
    setError(""); setQuote(null);
    const response = await fetch("/api/images/preflight", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ version: "image-generation.v1", ...draft }) });
    const data = await response.json();
    if (!response.ok) return setError(data.error || data.code || "Unable to quote this image.");
    setQuote(data.quote);
  };
  const generate = async () => {
    if (!quote) return quoteDraft();
    const response = await fetch("/api/images/generations", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ quoteId: quote.id, idempotencyKey: crypto.randomUUID() }) });
    const data = await response.json();
    if (!response.ok) return setError(data.error || data.code || "Generation could not start.");
    setGeneration({ id: data.creationId, status: data.status });
  };

  return <div className="flex h-full min-h-0 w-full flex-col overflow-hidden bg-[#FAF8ED] text-[#111111]">
    <section className="flex min-h-0 flex-1 items-center justify-center overflow-y-auto px-4 py-8 sm:px-8 md:px-12">
      {generation ? <div className="w-full max-w-xl rounded-3xl border border-[#111111]/15 bg-white p-6 text-center shadow-sm"><div className="mx-auto mb-4 grid h-12 w-12 place-items-center rounded-2xl bg-[#E6D9FF]"><FiLoader className="animate-spin" size={22} /></div><h1 className="font-serif text-2xl font-bold">Your image is being created</h1><p className="mt-2 text-sm text-[#55534E]">Keep this page open or return to My Images shortly.</p></div> : <div className="max-w-md text-center"><div className="mx-auto mb-4 grid h-12 w-12 place-items-center rounded-2xl border border-[#111111]/15 bg-white text-[#55534E] shadow-sm"><FiImage size={21} /></div><h1 className="font-serif text-2xl font-bold tracking-tight sm:text-3xl">Create your next image</h1><p className="mt-2 text-sm leading-6 text-[#66635C]">Describe a scene, product, character, or visual idea below.</p></div>}
    </section>

    <section className="shrink-0 px-3 pb-3 sm:px-5 sm:pb-5">
      <div className="mx-auto max-w-5xl rounded-[26px] border border-[#111111] bg-white p-3 shadow-[0_12px_36px_rgba(17,17,17,0.12)] sm:p-4">
        {selectedAssets.length > 0 && <div className="mb-3 flex flex-wrap gap-2">{selectedAssets.map((asset) => <div key={asset.id} className="group relative h-12 w-12 overflow-hidden rounded-xl border border-[#111111]/15 bg-[#EFECE1]"><img src={asset.url} alt="Selected reference" className="h-full w-full object-cover" /><button type="button" aria-label={`Remove ${asset.originalFileName}`} onClick={() => toggleAsset(asset.id)} className="absolute right-0.5 top-0.5 grid h-5 w-5 place-items-center rounded-full bg-[#111111] text-white opacity-90"><FiX size={12} /></button></div>)}</div>}
        <textarea value={draft.prompt} onChange={(event) => mutate({ prompt: event.target.value })} placeholder="Describe the scene you imagine" className="min-h-[88px] w-full resize-none rounded-2xl border border-transparent bg-[#FAF8ED] px-4 py-3 text-base leading-6 text-[#111111] outline-none placeholder:text-[#77746D] focus:border-[#111111]/20" />
        <div className="mt-3 flex flex-col gap-3 border-t border-[#111111]/10 pt-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            {caps?.referenceImages.visible && <Control onClick={() => setAssetOpen((open) => !open)} aria-expanded={assetOpen}><FiPlus size={17} /> Add image{draft.referenceAssetIds.length > 0 && <span className="text-xs text-[#66635C]">{draft.referenceAssetIds.length}/{caps.referenceImages.max}</span>}</Control>}
            <div className="relative" ref={modelPopover}>
              <Control onClick={() => setModelOpen((open) => !open)} aria-expanded={modelOpen} className="max-w-[190px]"><span className="truncate">{loading ? "Loading models…" : model?.displayName || "No model available"}</span><FiChevronDown size={15} /></Control>
              {modelOpen && <div className="absolute bottom-12 left-0 z-30 w-[min(320px,calc(100vw-3rem))] overflow-hidden rounded-2xl border border-[#111111]/15 bg-white p-2 shadow-xl"><label className="relative mb-2 block"><FiSearch className="absolute left-3 top-1/2 -translate-y-1/2 text-[#77746D]" size={15} /><input autoFocus value={modelSearch} onChange={(event) => setModelSearch(event.target.value)} placeholder="Search models" className="w-full rounded-xl border border-[#111111]/15 bg-[#FAF8ED] py-2 pl-9 pr-3 text-sm outline-none focus:border-[#111111]" /></label><div className="max-h-56 overflow-y-auto">{filteredModels.map((entry) => <button key={entry.id} type="button" onClick={() => selectModel(entry)} className="flex w-full items-center justify-between rounded-xl px-3 py-2.5 text-left hover:bg-[#EFECE1]"><span><span className="block text-sm font-semibold">{entry.displayName}</span><span className="block text-xs text-[#77746D]">MuAPI image generation</span></span>{entry.id === model?.id && <FiCheck size={17} />}</button>)}</div></div>}
            </div>
            {caps?.aspectRatio.visible && <SelectPill label="Aspect ratio" value={draft.aspectRatio} values={caps.aspectRatio.values} onChange={(aspectRatio) => mutate({ aspectRatio })} />}
            {caps?.outputResolution.visible && <SelectPill label="Resolution" value={draft.outputResolution} values={caps.outputResolution.values} onChange={(outputResolution) => mutate({ outputResolution })} />}
            {caps?.requestedOutputCount.visible && <SelectPill label="Output count" value={draft.requestedOutputCount} values={caps.requestedOutputCount.values} onChange={(requestedOutputCount) => mutate({ requestedOutputCount: Number(requestedOutputCount) })} />}
          </div>
          <button disabled={!model || !draft.prompt.trim()} onClick={generate} className="inline-flex min-h-11 shrink-0 items-center justify-center rounded-full border border-[#111111] bg-[#E6D9FF] px-5 text-sm font-semibold text-[#111111] shadow-sm transition-colors hover:bg-[#DBCBFF] disabled:cursor-not-allowed disabled:opacity-45">{quote ? `Generate · ${quote.credits} credits` : "Get quote"}</button>
        </div>
        {assetOpen && caps?.referenceImages.visible && <div className="mt-3 rounded-2xl border border-[#111111]/15 bg-[#FAF8ED] p-3"><div className="mb-2 flex items-center justify-between"><p className="text-sm font-semibold">Choose from My Assets</p><button type="button" onClick={() => setAssetOpen(false)} className="rounded-full p-1 hover:bg-white"><FiX /></button></div>{assets.length ? <div className="grid max-h-36 grid-cols-4 gap-2 overflow-y-auto sm:grid-cols-6">{assets.map((asset) => { const selected = draft.referenceAssetIds.includes(asset.id); return <button key={asset.id} type="button" onClick={() => toggleAsset(asset.id)} className={`relative aspect-square overflow-hidden rounded-xl border ${selected ? "border-[#111111] ring-2 ring-[#E6D9FF]" : "border-[#111111]/15"}`}><img src={asset.url} alt={asset.originalFileName} className="h-full w-full object-cover" />{selected && <span className="absolute right-1 top-1 grid h-5 w-5 place-items-center rounded-full bg-[#111111] text-white"><FiCheck size={12} /></span>}</button>; })}</div> : <p className="py-3 text-sm text-[#66635C]">No validated image assets yet.</p>}</div>}
        {error && <p role="alert" className="mt-3 text-sm font-medium text-[#9A2C2C]">{error}</p>}
        {!error && quote && <p className="mt-3 text-xs text-[#66635C]">Quote locked for 15 minutes.</p>}
      </div>
    </section>
  </div>;
}
