"use client";

import { useEffect, useRef, useState } from "react";
import { FiCheck, FiChevronDown } from "react-icons/fi";

// Shared compact selector language for Studio settings. Kept keyboard-native
// without falling back to browser-select styling.
export default function StudioSelect({ label, value, values = [], onChange, className = "", formatLabel = (entry) => entry }) {
  const [open, setOpen] = useState(false);
  const root = useRef(null);
  useEffect(() => {
    const close = (event) => { if (event.key === "Escape") setOpen(false); if (event.type === "pointerdown" && root.current && !root.current.contains(event.target)) setOpen(false); };
    window.addEventListener("keydown", close); window.addEventListener("pointerdown", close);
    return () => { window.removeEventListener("keydown", close); window.removeEventListener("pointerdown", close); };
  }, []);
  return <div className="relative" ref={root}>
    <button type="button" aria-label={label} aria-expanded={open} onClick={() => setOpen((current) => !current)} className={`inline-flex h-10 max-w-[148px] items-center gap-2 rounded-xl border border-[#111111]/15 bg-white px-3 text-sm font-medium shadow-sm transition-colors hover:bg-[#EFECE1] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#111111] ${className}`}>
      <span className="truncate">{formatLabel(value)}</span><FiChevronDown className="shrink-0" size={15} />
    </button>
    {open && <div role="menu" aria-label={label} className="absolute bottom-[calc(100%+0.5rem)] left-0 z-40 min-w-full overflow-hidden rounded-xl border border-[#111111]/15 bg-white p-1 shadow-xl">
      {values.map((entry) => <button key={entry} role="menuitemradio" aria-checked={entry === value} type="button" onClick={() => { onChange(entry); setOpen(false); }} className="flex w-full items-center justify-between gap-4 rounded-lg px-3 py-2 text-left text-sm hover:bg-[#EFECE1] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#111111]">
        <span>{formatLabel(entry)}</span>{entry === value && <FiCheck aria-hidden="true" size={15} />}
      </button>)}
    </div>}
  </div>;
}
