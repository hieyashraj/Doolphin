"use client";

import { useEffect, useState } from "react";
import Navbar from "./Navbar";
import { useAppAccount } from "./AppAccountProvider";
import { useRouter } from "next/navigation";
import { FiZap, FiCheckCircle } from "react-icons/fi";

export default function AppShell({ children }) {
  const { account } = useAppAccount();
  const router = useRouter();
  const [noticeMsg, setNoticeMsg] = useState("");

  useEffect(() => {
    if (typeof window === "undefined") return;
    const notice = sessionStorage.getItem("doolphin-auth-notice");
    if (notice) {
      sessionStorage.removeItem("doolphin-auth-notice");
      if (notice === "welcome-back") setNoticeMsg("Welcome back");
      else if (notice === "welcome-new") setNoticeMsg("Welcome to Doolphin");

      const timer = setTimeout(() => setNoticeMsg(""), 4000);
      return () => clearTimeout(timer);
    }
  }, []);

  const handleUpgrade = () => {
    router.push("/pricing");
  };

  const handleOpenLibrary = () => {
    router.push("/app?tab=library");
  };

  return (
    <div className="flow-canvas flex h-dvh min-h-dvh w-full gap-2 overflow-hidden bg-[#FAF8ED] p-2 text-[#111111] md:gap-3 md:p-3">
      {noticeMsg && (
        <div role="status" className="fixed top-4 right-4 z-50 flex items-center gap-2 rounded-2xl border border-[#111111]/20 bg-white px-4 py-3 font-semibold text-sm text-[#111111] shadow-lg animate-in fade-in slide-in-from-top-2">
          <FiCheckCircle className="text-emerald-600" size={18} />
          <span>{noticeMsg}</span>
        </div>
      )}
      <Navbar />

      <main className="relative z-10 flex min-w-0 flex-1 flex-col overflow-hidden rounded-[28px] border border-[#111111]/15 bg-[#FAF8ED]">
        {/* PERSISTENT STICKY TOP UTILITY BAR */}
        <header className="sticky top-0 z-30 flex h-14 w-full shrink-0 items-center justify-between border-b border-[#111111]/10 bg-[#FAF8ED]/95 px-4 backdrop-blur-md md:px-6">
          <div className="flex items-center gap-2">
            <span className="text-xs font-bold tracking-[0.16em] uppercase text-[#77746D]">
              Doolphin Studio
            </span>
          </div>

          <div className="flex items-center gap-2.5">
            <button
              onClick={handleUpgrade}
              className="bg-[#E6D9FF] hover:bg-[#DBCBFF] text-[#111111] border border-[#111111] font-semibold text-xs px-3.5 py-1.5 rounded-full flex items-center gap-1.5 shadow-sm transition-all active:scale-95 cursor-pointer sm:text-sm sm:px-4.5 sm:py-2"
            >
              <FiZap size={14} />
              <span>Upgrade</span>
              <span className="hidden bg-[#064E3B] text-white text-[10px] font-bold px-1.5 py-0.5 rounded-full sm:inline-block">
                30% OFF
              </span>
            </button>

            <div className="bg-white border border-[#111111]/15 px-3 py-1.5 rounded-full flex items-center gap-1.5 text-xs font-semibold text-[#111111] shadow-sm sm:text-sm sm:px-4 sm:py-2">
              <span>💎</span>
              <span>{account?.credits ?? "—"} credits</span>
            </div>

            <button
              onClick={handleOpenLibrary}
              className="bg-white hover:bg-[#F2EFE5] border border-[#111111]/15 text-[#55534E] hover:text-[#111111] font-semibold text-xs px-3.5 py-1.5 rounded-full flex items-center gap-1.5 transition-colors cursor-pointer shadow-sm sm:text-sm sm:px-4.5 sm:py-2"
            >
              <span>📜</span>
              <span className="hidden sm:inline">My Library</span>
            </button>
          </div>
        </header>

        {/* MAIN SCROLL CONTAINER */}
        <div className="flex-1 min-h-0 overflow-y-auto relative w-full scrollbar-subtle">
          {children}
        </div>
      </main>
    </div>
  );
}
