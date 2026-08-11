"use client";

import { useEffect } from "react";
import { SessionProvider } from "next-auth/react";

export function Providers({ children }) {
  useEffect(() => {
    if (typeof window !== "undefined") {
      document.documentElement.setAttribute("data-theme", "dark");
    }
  }, []);

  // Retained only while legacy identity records are being reconciled. Server access
  // decisions use Supabase exclusively.
  return <SessionProvider>{children}</SessionProvider>;
}
