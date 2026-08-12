"use client";

import { useEffect } from "react";

export function Providers({ children }) {
  useEffect(() => {
    if (typeof window !== "undefined") {
      document.documentElement.setAttribute("data-theme", "dark");
    }
  }, []);

  return children;
}
