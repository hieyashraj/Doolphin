"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { FiCheck, FiChevronDown, FiClock, FiFilm, FiLayers, FiSearch, FiZap } from "react-icons/fi";

/**
 * Grouped, badged model selector.
 *
 * Structure follows the reference design: a featured section, family group
 * headers, per-model capability badges, and NEW tags. The palette is the app's
 * existing light theme rather than the reference's dark one, because a dark
 * dropdown dropped into a light studio reads as a rendering bug.
 *
 * Rows that cannot be generated with are rendered but disabled, with the reason
 * stated. Hiding them entirely would make the catalogue look thin and invite
 * "where is Seedance 2.5 Spicy?"; showing them as clickable and failing is worse.
 */

/** One capability badge. Icon is chosen from the badge kind, not the text. */
function Badge({ kind, label }) {
  const Icon = kind === "resolution" ? FiFilm : kind === "duration" ? FiClock : FiLayers;
  return (
    <span className="inline-flex items-center gap-1 rounded-md bg-[#111111]/[0.06] px-1.5 py-0.5 text-[10px] font-medium text-[#4A4843]">
      <Icon className="h-2.5 w-2.5" aria-hidden="true" />
      {label}
    </span>
  );
}

function NewTag() {
  return (
    <span className="rounded-md bg-[#D9F24B] px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-[#111111]">
      New
    </span>
  );
}

function StatusTag({ children }) {
  return (
    <span className="rounded-md border border-[#111111]/15 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-[#77746D]">
      {children}
    </span>
  );
}

function ModelRow({ model, selected, onSelect }) {
  const disabled = !model.selectable;
  const reason = model.comingSoonLabel || model.pendingIntegrationLabel;

  return (
    <button
      type="button"
      role="option"
      aria-selected={selected}
      aria-disabled={disabled}
      disabled={disabled}
      onClick={() => !disabled && onSelect(model)}
      title={disabled ? reason : undefined}
      className={`flex w-full items-start justify-between gap-3 rounded-xl px-3 py-2.5 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#111111] ${
        disabled ? "cursor-not-allowed opacity-55" : "hover:bg-[#EFECE1]"
      }`}
    >
      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-center gap-1.5">
          <span className="truncate text-sm font-semibold text-[#111111]">{model.title}</span>
          {model.isNew && <NewTag />}
          {model.comingSoon && <StatusTag>Coming soon</StatusTag>}
          {model.pendingIntegration && <StatusTag>Setting up</StatusTag>}
        </span>

        {model.badges?.length > 0 && (
          <span className="mt-1.5 flex flex-wrap items-center gap-1">
            {model.badges.map((badge) => (
              <Badge key={`${badge.kind}-${badge.label}`} {...badge} />
            ))}
          </span>
        )}

        {disabled && reason && (
          <span className="mt-1 block text-[11px] text-[#8A867E]">{reason}</span>
        )}

        {/* The cap is a real constraint on what the user can upload, so it is
            surfaced on the row rather than discovered at submit time. */}
        {!disabled && model.inputVideoCapSeconds && (
          <span className="mt-1 block text-[11px] text-[#8A867E]">
            Input clips up to {model.inputVideoCapSeconds}s
          </span>
        )}
      </span>

      <span className="flex shrink-0 flex-col items-end gap-1">
        {model.maxCredits !== null && model.maxCredits !== undefined && (
          <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-[#4A4843]">
            <FiZap className="h-3 w-3" aria-hidden="true" />
            {/* Labelled "up to" because this is the ceiling; preflight can only
                quote the same or less. */}
            up to {model.maxCredits.toLocaleString()}
          </span>
        )}
        {selected && <FiCheck className="h-4 w-4 text-[#111111]" aria-hidden="true" />}
      </span>
    </button>
  );
}

export default function ModelCatalogueSelector({
  groups = [],
  featured = [],
  value,
  onChange,
  label = "Model",
  loading = false,
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const containerRef = useRef(null);

  const allModels = useMemo(() => groups.flatMap((group) => group.models), [groups]);
  const selected = useMemo(
    () => allModels.find((model) => model.providerModelId === value) || null,
    [allModels, value],
  );

  // Close on Escape and on an outside click. Without the outside-click handler the
  // panel stays open behind other controls and swallows the next interaction.
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (event) => {
      if (event.key === "Escape") setOpen(false);
    };
    const onPointerDown = (event) => {
      if (containerRef.current && !containerRef.current.contains(event.target)) setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onPointerDown);
    return () => {
      window.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onPointerDown);
    };
  }, [open]);

  const normalisedQuery = query.trim().toLowerCase();
  const matches = (model) =>
    !normalisedQuery ||
    `${model.title} ${model.providerModelId} ${model.familyLabel} ${model.badges.map((b) => b.label).join(" ")}`
      .toLowerCase()
      .includes(normalisedQuery);

  const visibleGroups = useMemo(
    () =>
      groups
        .map((group) => ({ ...group, models: group.models.filter(matches) }))
        .filter((group) => group.models.length > 0),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [groups, normalisedQuery],
  );

  const showFeatured = !normalisedQuery && featured.length > 0;

  const handleSelect = (model) => {
    onChange(model);
    setOpen(false);
    setQuery("");
  };

  return (
    <div className="relative" ref={containerRef}>
      <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-[#77746D]">
        {label}
      </label>
      <button
        type="button"
        onClick={() => setOpen((state) => !state)}
        aria-haspopup="listbox"
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-2 rounded-xl border border-[#111111]/15 bg-[#F2EFE5] px-3.5 py-3 text-left text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#111111]"
      >
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-1.5">
            <span className="truncate">
              {loading ? "Loading models…" : selected?.title || "Select a model"}
            </span>
            {selected?.isNew && <NewTag />}
          </span>
          {selected?.badges?.length > 0 && (
            <span className="mt-1 flex flex-wrap items-center gap-1">
              {selected.badges.slice(0, 3).map((badge) => (
                <Badge key={`${badge.kind}-${badge.label}`} {...badge} />
              ))}
            </span>
          )}
        </span>
        <FiChevronDown className={`shrink-0 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>

      {open && (
        <div className="absolute left-0 top-[calc(100%+0.5rem)] z-50 w-full overflow-hidden rounded-2xl border border-[#111111]/15 bg-white shadow-xl">
          <div className="border-b border-[#111111]/10 p-2">
            <label className="relative block">
              <FiSearch className="absolute left-3 top-1/2 -translate-y-1/2 text-[#77746D]" />
              <input
                autoFocus
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search models, resolution, duration"
                className="w-full rounded-xl border border-[#111111]/15 bg-[#FAF8ED] py-2 pl-9 pr-3 text-sm outline-none focus:border-[#111111]"
              />
            </label>
          </div>

          <div role="listbox" aria-label={label} className="max-h-[26rem] overflow-y-auto p-2">
            {showFeatured && (
              <div className="mb-1">
                <p className="px-3 pb-1 pt-1 text-[11px] font-bold uppercase tracking-wider text-[#77746D]">
                  Featured
                </p>
                {featured.map((model) => (
                  <ModelRow
                    key={`featured-${model.providerModelId}`}
                    model={model}
                    selected={model.providerModelId === value}
                    onSelect={handleSelect}
                  />
                ))}
                <div className="my-1 border-t border-[#111111]/10" />
              </div>
            )}

            {visibleGroups.map((group) => (
              <div key={group.family} className="mb-1">
                <p className="flex items-center gap-1.5 px-3 pb-1 pt-1 text-[11px] font-bold uppercase tracking-wider text-[#77746D]">
                  {group.familyLabel}
                  {group.isNew && <NewTag />}
                </p>
                {group.models.map((model) => (
                  <ModelRow
                    key={model.providerModelId}
                    model={model}
                    selected={model.providerModelId === value}
                    onSelect={handleSelect}
                  />
                ))}
              </div>
            ))}

            {visibleGroups.length === 0 && (
              <p className="px-3 py-6 text-center text-sm text-[#77746D]">
                No models match “{query}”.
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
