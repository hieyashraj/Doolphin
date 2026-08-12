"use client";

import { useEffect } from "react";
import { AppAccountProvider } from "@/components/AppAccountProvider";

export function Providers({ children, initialAccount }) {
  useEffect(() => {
    if (typeof window !== "undefined") {
      document.documentElement.setAttribute("data-theme", "dark");
    }
  }, []);

  return <AppAccountProvider initialAccount={initialAccount}>{children}</AppAccountProvider>;
}
