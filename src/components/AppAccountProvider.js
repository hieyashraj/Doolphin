"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";

const AppAccountContext = createContext({
  account: null,
  refreshAccount: async () => null,
  setAccount: () => {},
  creditsAreStale: false,
});

/**
 * Minimum gap between balance fetches, in ms.
 *
 * Credits change server-side (a webhook settles a generation, the reconciler
 * refunds a timeout), so the browser cannot know a change happened without
 * asking. Asking too eagerly is not free: this deployment is on a metered
 * serverless CPU budget, and a permanent interval on every mounted tab is the
 * kind of background cost that quietly consumes it.
 *
 * The compromise is event-driven revalidation with a floor: refresh when
 * something plausibly changed (tab regained focus, a generation settled, the
 * user acted) and never more often than this.
 */
const MIN_REFRESH_INTERVAL_MS = 3_000;

export function AppAccountProvider({ initialAccount, children }) {
  const [account, setAccount] = useState(initialAccount || null);
  const [creditsAreStale, setCreditsAreStale] = useState(false);
  const lastFetchedAtRef = useRef(0);
  const inFlightRef = useRef(null);
  const accountRef = useRef(initialAccount || null);
  accountRef.current = account;

  /**
   * Authoritative balance refresh. Components share the result instead of each
   * issuing their own request.
   *
   * Concurrent callers are coalesced onto one in-flight request: a generation
   * settling while the tab regains focus would otherwise fire two identical
   * fetches and, worse, could apply the older response last and display a stale
   * balance.
   */
  const refreshAccount = useCallback(async ({ force = false } = {}) => {
    if (!force) {
      if (inFlightRef.current) return inFlightRef.current;
      if (Date.now() - lastFetchedAtRef.current < MIN_REFRESH_INTERVAL_MS) {
        // Too soon to ask again, but record that the displayed number may lag.
        setCreditsAreStale(true);
        // Read through a ref rather than closing over `account`: this callback is
        // a dependency of polling effects, so if its identity changed whenever the
        // balance changed, every balance update would tear down and restart those
        // polls.
        return accountRef.current;
      }
    }

    const request = (async () => {
      try {
        const response = await fetch("/api/account", { cache: "no-store" });
        if (!response.ok) throw new Error("Account is unavailable");
        const payload = await response.json();
        lastFetchedAtRef.current = Date.now();
        setAccount(payload.user || null);
        setCreditsAreStale(false);
        return payload.user || null;
      } finally {
        inFlightRef.current = null;
      }
    })();

    inFlightRef.current = request;
    return request;
  }, []);

  /*
   * Revalidate when the tab becomes visible again.
   *
   * This is the case that previously left a wrong number on screen indefinitely:
   * a generation completes (or is refunded) while the tab is backgrounded or
   * while the user is on another page, the balance changes server-side, and
   * nothing in the browser ever asked again. Costs one request per return to the
   * tab rather than a standing poll.
   */
  useEffect(() => {
    if (typeof document === "undefined") return undefined;

    const revalidate = () => {
      if (document.visibilityState !== "visible") return;
      void refreshAccount().catch(() => setCreditsAreStale(true));
    };

    document.addEventListener("visibilitychange", revalidate);
    window.addEventListener("focus", revalidate);
    return () => {
      document.removeEventListener("visibilitychange", revalidate);
      window.removeEventListener("focus", revalidate);
    };
  }, [refreshAccount]);

  const value = useMemo(
    () => ({ account, setAccount, refreshAccount, creditsAreStale }),
    [account, refreshAccount, creditsAreStale],
  );
  return <AppAccountContext.Provider value={value}>{children}</AppAccountContext.Provider>;
}

export function useAppAccount() {
  return useContext(AppAccountContext);
}
