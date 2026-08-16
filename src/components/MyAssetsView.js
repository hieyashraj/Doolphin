"use client";

import { useEffect, useState, useRef } from "react";
import { 
  FiFolder, 
  FiSearch, 
  FiUploadCloud, 
  FiImage, 
  FiVideo, 
  FiLoader, 
  FiCheck, 
  FiX, 
  FiClock, 
  FiMaximize2 
} from "react-icons/fi";
import toast from "react-hot-toast";
import LazyVideo from "@/components/LazyVideo";

export default function MyAssetsView() {
  const [assets, setAssets] = useState([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState("all");
  const [selectedAsset, setSelectedAsset] = useState(null);

  const fileInputRef = useRef(null);

  const fetchAssets = async () => {
    try {
      const response = await fetch("/api/assets");
      if (response.ok) {
        const data = await response.json();
        setAssets(Array.isArray(data.assets) ? data.assets : []);
      } else {
        toast.error("Failed to load assets.");
      }
    } catch (err) {
      console.error("Asset load error:", err);
      toast.error("Unable to load asset library.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchAssets();
  }, []);

  const handleUpload = async (files) => {
    const file = files?.[0];
    if (!file) return;

    if (!file.type.startsWith("image/") && !file.type.startsWith("video/")) {
      toast.error("Please upload an image (PNG, JPEG, WebP) or video (MP4, QuickTime).");
      return;
    }
    if (file.size > 50 * 1024 * 1024) {
      toast.error("Uploaded files must be 50 MB or smaller.");
      return;
    }

    setUploading(true);
    try {
      const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
      const checksumSha256 = Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");

      const presignRes = await fetch("/api/uploads/presign", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          filename: file.name,
          contentType: file.type,
          fileSizeBytes: file.size,
          checksumSha256
        })
      });

      const presignData = await presignRes.json();
      if (!presignRes.ok) throw new Error(presignData.error || "Upload preparation failed");

      if (!presignData.alreadyUploaded && presignData.uploadUrl) {
        const putRes = await fetch(presignData.uploadUrl, {
          method: "PUT",
          headers: presignData.requiredHeaders || {},
          body: file
        });
        if (!putRes.ok) throw new Error("Direct file storage upload failed");
      }

      const completeRes = await fetch("/api/uploads/complete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ assetId: presignData.assetId })
      });

      const completeData = await completeRes.json();
      if (!completeRes.ok) throw new Error(completeData.error || "Asset verification failed");

      toast.success("Asset uploaded successfully!");
      await fetchAssets();
    } catch (err) {
      toast.error(err.message || "Asset upload failed");
    } finally {
      setUploading(false);
    }
  };

  const filteredAssets = assets.filter((asset) => {
    const isImage = asset.mimeType?.startsWith("image/");
    const isVideo = asset.mimeType?.startsWith("video/");
    const matchesType = 
      typeFilter === "all" ||
      (typeFilter === "image" && isImage) ||
      (typeFilter === "video" && isVideo);

    const nameStr = `${asset.originalFileName || ""} ${asset.analysis?.suggestedName || ""}`.toLowerCase();
    const matchesSearch = !searchQuery.trim() || nameStr.includes(searchQuery.trim().toLowerCase());

    return matchesType && matchesSearch;
  });

  return (
    <div className="flex-1 overflow-y-auto px-6 py-8 md:px-12 space-y-8 scrollbar-subtle select-none">
      <header className="border-b border-[#111111]/10 pb-5 flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div>
          <span className="text-xs font-bold tracking-[0.2em] uppercase text-[#77746D]">
            SOURCE MEDIA
          </span>
          <h2 className="text-2xl sm:text-3xl font-serif font-bold text-[#111111]">My Assets</h2>
          <p className="text-sm sm:text-base text-[#55534E] mt-0.5">
            Your uploaded photos and video clips for AI generation
          </p>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
            className="bg-[#E6D9FF] hover:bg-[#DBCBFF] text-[#111111] border border-[#111111] px-5 py-2.5 rounded-full text-sm font-semibold flex items-center gap-2 cursor-pointer transition-colors shadow-sm disabled:opacity-50"
          >
            <FiUploadCloud size={18} />
            <span>{uploading ? "Uploading…" : "Upload Asset"}</span>
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/png,image/jpeg,image/webp,video/mp4,video/quicktime"
            className="hidden"
            onChange={(e) => {
              void handleUpload(e.target.files);
              e.target.value = "";
            }}
          />
        </div>
      </header>

      {/* SEARCH AND FILTERS */}
      <div className="flex flex-col sm:flex-row gap-3 items-center justify-between bg-white p-3 rounded-2xl border border-[#111111]/10 shadow-sm">
        <div className="relative flex-1 w-full">
          <FiSearch className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[#77746D]" size={16} />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search uploaded asset names..."
            className="w-full bg-[#FAF8ED] border border-[#111111]/15 rounded-xl py-2 pl-9 pr-3 text-sm text-[#111111] focus:border-[#111111] focus:outline-none"
          />
        </div>

        <div className="flex items-center gap-1.5 w-full sm:w-auto">
          {[
            ["all", "All Assets"],
            ["image", "Images"],
            ["video", "Videos"]
          ].map(([val, label]) => (
            <button
              key={val}
              onClick={() => setTypeFilter(val)}
              className={`px-3.5 py-1.5 rounded-xl text-xs font-semibold border transition-colors ${
                typeFilter === val
                  ? "bg-[#111111] text-white border-[#111111]"
                  : "bg-white text-[#55534E] border-[#111111]/15 hover:bg-[#FAF8ED]"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* ASSET GRID */}
      {loading ? (
        <div className="py-24 flex flex-col items-center justify-center gap-3">
          <FiLoader className="text-3xl text-[#111111] animate-spin" />
          <span className="text-sm text-[#55534E] font-medium">Loading uploaded assets…</span>
        </div>
      ) : assets.length === 0 ? (
        <div className="py-24 flex flex-col items-center justify-center text-center space-y-4">
          <div className="w-16 h-16 rounded-2xl bg-white flex items-center justify-center text-[#55534E] border border-[#111111]/15 shadow-sm">
            <FiFolder size={28} />
          </div>
          <div className="space-y-1">
            <h3 className="text-lg font-serif font-bold text-[#111111]">No uploaded assets yet</h3>
            <p className="text-sm text-[#55534E] max-w-sm">
              Upload product photos, app screenshots, or reference videos to use in your studios.
            </p>
          </div>
          <button
            onClick={() => fileInputRef.current?.click()}
            className="bg-[#E6D9FF] text-[#111111] border border-[#111111] px-6 py-3 rounded-full text-sm font-semibold hover:bg-[#DBCBFF] cursor-pointer shadow-sm transition-colors"
          >
            Upload your first asset
          </button>
        </div>
      ) : filteredAssets.length === 0 ? (
        <div className="py-20 flex flex-col items-center justify-center text-center space-y-3">
          <FiSearch size={28} className="text-[#77746D]" />
          <h3 className="text-lg font-serif font-bold text-[#111111]">No matching assets</h3>
          <p className="text-sm text-[#55534E]">Try adjusting your search query or type filter.</p>
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
          {filteredAssets.map((asset) => {
            const isVideo = asset.mimeType?.startsWith("video/");
            return (
              <div
                key={asset.assetId || asset.id}
                onClick={() => setSelectedAsset(asset)}
                className="bg-white aspect-square overflow-hidden relative cursor-pointer group shadow-sm rounded-2xl border border-[#111111]/15 hover:border-[#111111]/35 hover:shadow-lg transition-all"
              >
                {isVideo ? (
                  <LazyVideo src={asset.url} className="w-full h-full object-cover" />
                ) : (
                  <img
                    src={asset.url}
                    alt={asset.originalFileName}
                    loading="lazy"
                    decoding="async"
                    className="w-full h-full object-cover"
                  />
                )}

                {/* Badge Overlay */}
                <div className="absolute top-2 left-2 z-10">
                  <span className="bg-black/60 backdrop-blur-md text-white text-[10px] font-bold px-2 py-0.5 rounded-full uppercase flex items-center gap-1 border border-white/20">
                    {isVideo ? <FiVideo size={10} /> : <FiImage size={10} />}
                    {isVideo ? "Video" : "Image"}
                  </span>
                </div>

                {/* Hover overlay with title */}
                <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/20 to-transparent opacity-0 group-hover:opacity-100 transition-opacity p-3 flex flex-col justify-end text-white">
                  <p className="text-xs font-bold truncate leading-tight">
                    {asset.analysis?.suggestedName || asset.originalFileName}
                  </p>
                  <p className="text-[10px] text-white/70 truncate mt-0.5">
                    {(asset.fileSizeBytes / (1024 * 1024)).toFixed(2)} MB
                  </p>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* DETAIL MODAL */}
      {selectedAsset && (
        <div className="fixed inset-0 z-[1000] flex items-center justify-center p-4">
          <div
            onClick={() => setSelectedAsset(null)}
            className="absolute inset-0 bg-[#111111]/40 backdrop-blur-md"
          />
          <div className="relative w-full max-w-md bg-white rounded-3xl p-6 shadow-2xl overflow-hidden flex flex-col justify-between text-[#111111] border border-[#111111]/20 z-10">
            <div className="pb-3 border-b border-[#111111]/10 flex items-center justify-between">
              <span className="text-xs font-bold uppercase tracking-wider text-[#77746D]">
                Asset Detail
              </span>
              <button
                onClick={() => setSelectedAsset(null)}
                className="p-1.5 text-[#55534E] hover:text-[#111111] transition-colors rounded-full hover:bg-[#EFECE1]"
              >
                <FiX size={20} />
              </button>
            </div>

            <div className="w-full aspect-square my-4 bg-black rounded-2xl overflow-hidden flex items-center justify-center relative border border-[#111111]/20">
              {selectedAsset.mimeType?.startsWith("video/") ? (
                <video src={selectedAsset.url} controls autoPlay loop className="w-full h-full object-contain" />
              ) : (
                <img src={selectedAsset.url} alt={selectedAsset.originalFileName} className="w-full h-full object-contain" />
              )}
            </div>

            <div className="space-y-2 border-t border-[#111111]/10 pt-3 text-xs">
              <p className="font-bold text-sm text-[#111111] truncate">
                {selectedAsset.analysis?.suggestedName || selectedAsset.originalFileName}
              </p>
              <div className="grid grid-cols-2 gap-2 text-[#55534E]">
                <div><span className="font-semibold text-[#111111]">Format:</span> {selectedAsset.mimeType}</div>
                <div><span className="font-semibold text-[#111111]">Size:</span> {(selectedAsset.fileSizeBytes / (1024 * 1024)).toFixed(2)} MB</div>
                <div><span className="font-semibold text-[#111111]">Status:</span> {selectedAsset.validationStatus}</div>
                <div><span className="font-semibold text-[#111111]">Analysis:</span> {selectedAsset.analysisStatus || "N/A"}</div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
