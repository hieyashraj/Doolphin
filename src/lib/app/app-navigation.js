"use client";

/**
 * The authenticated product has two kinds of destinations:
 *
 * - views rendered inside /app (kept in the URL query string for instant
 *   client-side Back/Forward navigation), and
 * - standalone routes, such as Image Studio.
 *
 * Keep the sidebar, launcher cards, and active-state logic pointed at this
 * list.  This prevents a route and a query tab from independently claiming
 * to be selected.
 */
export const APP_NAV_DESTINATIONS = Object.freeze([
  { id: "explore", name: "Explore", type: "view", tab: "explore" },
  { id: "video", name: "Video Studio", type: "view", tab: "video", studio: "video_maker" },
  { id: "product", name: "Product Studio", type: "view", tab: "video", studio: "product" },
  { id: "app_studio", name: "App Studio", type: "view", tab: "video", studio: "app" },
  { id: "images", name: "Image Studio", type: "route", href: "/app/images" },
  { id: "avatars", name: "Avatars", type: "view", tab: "avatars" },
  { id: "assets", name: "My Assets", type: "view", tab: "assets" },
  { id: "library", name: "My Library", type: "view", tab: "library" }
]);

export const LEGACY_IMAGE_LIBRARY_PATH = "/app/images/library";

const destinationById = new Map(APP_NAV_DESTINATIONS.map((destination) => [destination.id, destination]));
const destinationByTab = new Map(
  APP_NAV_DESTINATIONS
    .filter((destination) => destination.type === "view")
    .map((destination) => [destination.tab, destination])
);

export function getAppDestination(id) {
  return destinationById.get(id) || null;
}

export function getAppDestinationHref(id) {
  const destination = getAppDestination(id);
  if (!destination) return "/app?tab=explore";
  if (destination.type === "route") return destination.href;

  const params = new URLSearchParams({ tab: destination.tab });
  if (destination.studio) params.set("studio", destination.studio);
  return `/app?${params.toString()}`;
}

/**
 * Normalizes raw query parameters so invalid, legacy, or alias query states
 * map safely to canonical view/route parameters and NEVER render a blank page.
 */
export function normalizeAppQueryParams({ tab, studio } = {}) {
  if (tab === "images") {
    return { redirect: "/app/images" };
  }
  if (tab === "product" || studio === "product") {
    return { tab: "video", studio: "product" };
  }
  if (tab === "app" || tab === "app_studio" || studio === "app") {
    return { tab: "video", studio: "app" };
  }
  if (tab === "video" || tab === "video_maker") {
    const validStudio = ["video_maker", "product", "app"].includes(studio) ? studio : "video_maker";
    return { tab: "video", studio: validStudio };
  }
  if (tab === "avatars") {
    return { tab: "avatars" };
  }
  if (tab === "assets") {
    return { tab: "assets" };
  }
  if (tab === "library") {
    return { tab: "library" };
  }
  if (tab === "explore") {
    return { tab: "explore" };
  }

  // Failsafe default: any unknown tab or malformed query state falls back to Explore.
  return { tab: "explore" };
}

/**
 * Resolves precisely one primary item. Route destinations win over query
 * state, so stale query parameters cannot make Image Studio and another
 * sidebar item appear active together.
 */
export function getActiveAppDestination({ pathname = "/app", tab, studio } = {}) {
  const normalizedPathname = pathname.length > 1 && pathname.endsWith("/")
    ? pathname.slice(0, -1)
    : pathname;

  if (normalizedPathname === "/app/images") return "images";
  if (normalizedPathname === LEGACY_IMAGE_LIBRARY_PATH) return "library";
  if (normalizedPathname !== "/app") return null;

  const normalized = normalizeAppQueryParams({ tab, studio });
  const currentTab = normalized.tab || "explore";
  if (currentTab === "video") {
    const currentStudio = normalized.studio || "video_maker";
    const matched = APP_NAV_DESTINATIONS.find(
      (d) => d.type === "view" && d.tab === "video" && d.studio === currentStudio
    );
    if (matched) return matched.id;
  }

  return destinationByTab.get(currentTab)?.id || "explore";
}

export function navigateAppView({ tab = "explore", studio, avatarId, router, replace = false } = {}) {
  const normalized = normalizeAppQueryParams({ tab, studio });
  if (normalized.redirect && router && typeof router.push === "function") {
    router.push(normalized.redirect);
    return;
  }

  const targetTab = normalized.tab || "explore";
  const targetStudio = normalized.studio;

  if (router && typeof router.push === "function") {
    const params = new URLSearchParams({ tab: targetTab });
    if (targetStudio) params.set("studio", targetStudio);
    if (avatarId) params.set("avatarId", avatarId);
    const href = `/app?${params.toString()}`;
    if (replace) {
      router.replace(href, { scroll: false });
    } else {
      router.push(href, { scroll: false });
    }
    return;
  }

  if (typeof window !== "undefined") {
    const url = new URL(window.location.href);
    url.pathname = "/app";
    url.search = "";
    const tab = targetTab;
    url.searchParams.set("tab", tab);
    if (targetStudio) url.searchParams.set("studio", targetStudio);
    if (avatarId) url.searchParams.set("avatarId", avatarId);
    window.history[replace ? "replaceState" : "pushState"](null, "", url);
    window.dispatchEvent(new PopStateEvent("popstate"));
  }
}

export function navigateToAppDestination(id, { router, avatarId, replace = false } = {}) {
  const destination = getAppDestination(id);
  if (!destination) {
    navigateAppView({ tab: "explore", router, avatarId, replace });
    return false;
  }

  if (destination.type === "view") {
    navigateAppView({ tab: destination.tab, studio: destination.studio, avatarId, router, replace });
    return true;
  }

  if (destination.type === "route" && router && typeof router.push === "function") {
    if (replace) {
      router.replace(destination.href);
    } else {
      router.push(destination.href);
    }
    return true;
  }

  return false;
}



