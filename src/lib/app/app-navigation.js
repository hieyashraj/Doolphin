"use client";

// Tab and studio selection are local /app view state.  Using the browser
// history API keeps shareable URLs and Back/Forward while avoiding an App
// Router RSC navigation that would re-run protected server layout work.
export function navigateAppView({ tab = "explore", studio, replace = false } = {}) {
  const url = new URL(window.location.href);
  url.pathname = "/app";
  url.search = "";
  url.searchParams.set("tab", tab);
  if (studio) url.searchParams.set("studio", studio);
  window.history[replace ? "replaceState" : "pushState"](null, "", url);
  // Next synchronizes useSearchParams with native history updates. The event
  // also makes this work consistently in browsers where the update is async.
  window.dispatchEvent(new PopStateEvent("popstate"));
}
