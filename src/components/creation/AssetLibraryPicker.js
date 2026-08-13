"use client";

import { useEffect, useMemo, useState } from "react";
import { FiFolder, FiSearch, FiX, FiVideo } from "react-icons/fi";
import LazyVideo from "@/components/LazyVideo";

/** A small, self-contained picker so all studios reuse the user's saved input media. */
export default function AssetLibraryPicker({ accept = ["image/"], onSelect, selectedAssetIds = [], label = "My Assets" }) {
  const [open, setOpen] = useState(false);
  const [assets, setAssets] = useState([]);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open || assets.length || loading) return;
    setLoading(true);
    setError("");
    fetch("/api/assets")
      .then(async (response) => {
        const body = await response.json();
        if (!response.ok) throw new Error(body.error || "Could not load your assets");
        setAssets(Array.isArray(body.assets) ? body.assets : []);
      })
      .catch((requestError) => setError(requestError.message || "Could not load your assets"))
      .finally(() => setLoading(false));
  }, [open, assets.length, loading]);

  useEffect(() => {
    const onKeyDown = (event) => { if (event.key === "Escape") setOpen(false); };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const available = useMemo(() => assets.filter((asset) => {
    const supported = accept.some((prefix) => asset.mimeType?.startsWith(prefix));
    const text = `${asset.originalFileName} ${asset.analysis?.suggestedName || ""}`.toLowerCase();
    return supported && text.includes(query.trim().toLowerCase());
  }), [assets, accept, query]);

  const choose = (asset) => {
    if (selectedAssetIds.includes(asset.assetId)) return;
    onSelect(asset);
    setOpen(false);
  };

  return <>
    <button type="button" onClick={() => setOpen(true)} className="asset-library-trigger h-10 px-3 rounded-xl border border-[#111111]/20 bg-white hover:bg-[#F2EFE5] text-xs font-semibold text-[#33312D] inline-flex items-center gap-1.5">
      <FiFolder size={15} /> {label}
    </button>
    {open && <div className="fixed inset-0 z-[80] bg-black/45 p-4 flex items-center justify-center" role="dialog" aria-modal="true" aria-label="Choose from My Assets">
      <div className="w-full max-w-2xl max-h-[80vh] overflow-hidden rounded-2xl bg-[#FFFEF8] shadow-2xl border border-[#111111]/15">
        <div className="p-4 border-b border-[#111111]/10 flex items-center gap-3">
          <div className="font-bold text-[#111111] flex-1">Choose from My Assets</div>
          <button type="button" aria-label="Close My Assets" onClick={() => setOpen(false)} className="p-1.5 rounded-lg hover:bg-black/5"><FiX /></button>
        </div>
        <div className="p-4 border-b border-[#111111]/10 relative">
          <FiSearch className="absolute left-7 top-1/2 -translate-y-1/2 text-[#77746D]" size={16} />
          <input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search recent assets" className="w-full pl-9 pr-3 py-2.5 rounded-xl border border-[#111111]/15 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-[#111111]" />
        </div>
        <div className="p-4 overflow-y-auto max-h-[55vh]">
          {loading && <p className="text-sm text-[#66635D]">Loading your assets…</p>}
          {error && <p className="text-sm text-red-700">{error}</p>}
          {!loading && !error && available.length === 0 && <p className="text-sm text-[#66635D]">No compatible saved assets yet. Use the Upload button in this Studio to add one now, then return here to reuse it.</p>}
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            {available.map((asset) => {
              const selected = selectedAssetIds.includes(asset.assetId);
              return <button key={asset.assetId} type="button" disabled={selected} onClick={() => choose(asset)} className={`text-left overflow-hidden rounded-xl border transition-colors ${selected ? "opacity-45 border-[#111111]/10 cursor-not-allowed" : "border-[#111111]/15 hover:border-[#111111] bg-white"}`}>
                <div className="h-24 bg-[#F2EFE5] relative">
                  {asset.mimeType?.startsWith("video/") ? <LazyVideo src={asset.url} className="w-full h-full object-cover" /> : <img src={asset.url} alt="" loading="lazy" decoding="async" className="w-full h-full object-cover" />}
                  {asset.mimeType?.startsWith("video/") && <FiVideo className="absolute top-2 right-2 text-white drop-shadow" />}
                </div>
                <div className="p-2">
                  <p className="truncate text-xs font-semibold text-[#111111]">{asset.analysis?.suggestedName || asset.originalFileName}</p>
                  <p className="truncate text-[10px] text-[#77746D]">{selected ? "Already added" : asset.mimeType}</p>
                </div>
              </button>;
            })}
          </div>
        </div>
      </div>
    </div>}
  </>;
}
