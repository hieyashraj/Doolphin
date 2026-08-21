"use client";

/**
 * ERROR BOUNDARY FOR THE AUTHENTICATED PRODUCT.
 *
 * Before this existed the app had NO error boundary anywhere, so a single
 * unhandled error in any studio component replaced the entire product with the
 * framework's bare dark "This page couldn't load" screen — no branding, no
 * context, and no way to recover except a manual reload.
 *
 * This keeps the user inside Doolphin, offers the two recoveries that actually
 * work (retry the failed render, or return to a known-good view), and surfaces
 * the error digest. The digest is the ID Vercel logs the stack trace under, so a
 * user can quote it and the exact fault can be found instead of guessed at.
 */
export default function AppError({ error, reset }) {
  return (
    <div className="flex h-full min-h-[60vh] w-full items-center justify-center bg-[#FAF8ED] p-6">
      <div className="w-full max-w-md rounded-[28px] border border-[#111111] bg-white p-8 text-center shadow-[6px_6px_0_#111111]">
        <p className="text-xs font-bold uppercase tracking-[.16em] text-[#77746D]">Something interrupted this view</p>
        <h1 className="mt-3 font-serif text-3xl font-bold text-[#111111]">This studio hit a snag.</h1>
        <p className="mt-3 text-sm leading-relaxed text-[#55534E]">
          Nothing was charged and your work is safe. Try again — if it keeps happening, send us the reference below and we
          will fix it.
        </p>

        <div className="mt-6 flex flex-col gap-2">
          <button
            type="button"
            onClick={() => reset()}
            className="min-h-11 w-full rounded-xl border border-[#111111] bg-[#E6D9FF] px-4 text-sm font-bold text-[#111111] shadow-[3px_3px_0_#111111] transition hover:bg-[#DBCBFF]"
          >
            Try again
          </button>
          <a
            href="/app?tab=explore"
            className="min-h-11 w-full rounded-xl border border-[#111111] bg-white px-4 py-3 text-sm font-bold text-[#111111] transition hover:bg-[#F2EFE5]"
          >
            Back to Explore
          </a>
        </div>

        {error?.digest && (
          <p className="mt-5 font-mono text-[11px] text-[#918D82]">Reference: {error.digest}</p>
        )}
      </div>
    </div>
  );
}
