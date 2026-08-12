"use client";

import { createContext, useCallback, useContext, useMemo, useState } from "react";

const AppAccountContext = createContext({ account: null, refreshAccount: async () => null, setAccount: () => {} });

export function AppAccountProvider({ initialAccount, children }) {
  const [account, setAccount] = useState(initialAccount || null);

  // This is deliberately a targeted, authoritative refresh. Components share
  // the result instead of each issuing their own account/ledger request.
  const refreshAccount = useCallback(async () => {
    const response = await fetch("/api/account", { cache: "no-store" });
    if (!response.ok) throw new Error("Account is unavailable");
    const payload = await response.json();
    setAccount(payload.user || null);
    return payload.user || null;
  }, []);

  const value = useMemo(() => ({ account, setAccount, refreshAccount }), [account, refreshAccount]);
  return <AppAccountContext.Provider value={value}>{children}</AppAccountContext.Provider>;
}

export function useAppAccount() {
  return useContext(AppAccountContext);
}
