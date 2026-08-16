"use client";

import Link from "next/link";
import { useSearchParams, useRouter, usePathname } from "next/navigation";
import { useState, useEffect, Suspense } from "react";
import { 
  FiCompass, 
  FiLayers, 
  FiSettings, 
  FiKey, 
  FiCheck, 
  FiX, 
  FiTrash2,
  FiUser,
  FiZap,
  FiCreditCard,
  FiCopy,
  FiExternalLink,
  FiAlertTriangle,
  FiCpu,
  FiImage,
  FiSidebar,
  FiLogOut,
  FiBox,
  FiSmartphone,
  FiFolder
} from "react-icons/fi";
import toast from "react-hot-toast";
import { createClient } from "@/lib/supabase/browser";
import { useAppAccount } from "@/components/AppAccountProvider";
import {
  APP_NAV_DESTINATIONS,
  getActiveAppDestination,
  getAppDestinationHref,
  navigateAppView,
  navigateToAppDestination
} from "@/lib/app/app-navigation";
import { PLAN_BY_CODE } from "@/lib/entitlements/plan-catalog";

function SidebarContent() {
  const { account, setAccount } = useAppAccount();
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  
  const activeDestination = getActiveAppDestination({ 
    pathname, 
    tab: searchParams.get("tab"),
    studio: searchParams.get("studio") 
  });
  const [isSettingsModalOpen, setIsSettingsModalOpen] = useState(false);
  const [activeSettingsTab, setActiveSettingsTab] = useState("profile");
  const [isCollapsedManual, setIsCollapsedManual] = useState(true);
  const [isMobileViewport, setIsMobileViewport] = useState(false);

  useEffect(() => {
    const savedState = localStorage.getItem("doolphin_sidebar_collapsed");
    if (savedState !== null) {
      setIsCollapsedManual(savedState === "true");
    }
  }, []);

  useEffect(() => {
    const mediaQuery = window.matchMedia("(max-width: 639px)");
    const updateViewport = () => setIsMobileViewport(mediaQuery.matches);
    updateViewport();
    mediaQuery.addEventListener("change", updateViewport);
    return () => mediaQuery.removeEventListener("change", updateViewport);
  }, []);

  const toggleSidebar = () => {
    setIsCollapsedManual((prev) => {
      const next = !prev;
      localStorage.setItem("doolphin_sidebar_collapsed", String(next));
      return next;
    });
  };

  const isCollapsed = isCollapsedManual || isMobileViewport;

  // User Profile States
  const [profileName, setProfileName] = useState("Doolphin Creator");
  const [profileEmail, setProfileEmail] = useState("");
  useEffect(() => { if (account) { setProfileName(account.name); setProfileEmail(account.email); } }, [account]);

  const [savingSettings, setSavingSettings] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const activePlan = PLAN_BY_CODE[account?.planCode] || null;

  const handleSignOut = async () => {
    if (signingOut) return;
    setSigningOut(true);
    try {
      const { error } = await createClient().auth.signOut();
      if (error) throw error;
      setAccount(null);
      router.replace("/sign-in");
    } catch {
      toast.error("Unable to sign out. Please try again.");
      setSigningOut(false);
    }
  };

  const handleSaveAllSettings = async (e) => {
    if (e) e.preventDefault();
    setSavingSettings(true);
    try {
      setAccount((previous) => ({ ...(previous || {}), name: profileName.trim(), email: profileEmail.trim() }));
      toast.success("Profile preferences updated on this device.");
      setIsSettingsModalOpen(false);
    } catch (err) {
      console.error(err);
      toast.error(err.message || "Failed to save settings");
    } finally {
      setSavingSettings(false);
    }
  };

  const copyToClipboard = (text, label) => {
    navigator.clipboard.writeText(text);
    toast.success(`${label} copied to clipboard!`);
  };

  const navIcons = {
    explore: FiCompass,
    video: FiZap,
    product: FiBox,
    app_studio: FiSmartphone,
    images: FiImage,
    avatars: FiUser,
    assets: FiFolder,
    library: FiLayers
  };

  const navigateToDestination = (destination) => {
    if (destination.type === "route") {
      router.push(destination.href);
      return;
    }
    if (pathname !== "/app") {
      router.push(getAppDestinationHref(destination.id));
      return;
    }
    navigateToAppDestination(destination.id, { router });
  };

  return (
    <>
      {/* Wispr Flow Signature Floating Sidebar Rail */}
      <aside 
        className={`h-full min-h-0 max-h-full overflow-hidden bg-[#FAF8ED] border border-[#111111] flex flex-col justify-between p-3.5 flex-shrink-0 z-40 select-none rounded-[28px] transition-all duration-300 ease-in-out shadow-sm ${
          isCollapsed ? "w-[76px]" : "w-64 shadow-lg"
        }`}
      >
        <div className="flex min-h-0 w-full flex-1 flex-col gap-6 overflow-y-auto overscroll-contain">
          {/* Logo Mark & Header */}
          {isCollapsed ? (
            <div className="flex flex-col items-center gap-3 pt-1">
              <button
                onClick={toggleSidebar}
                className="w-10 h-10 rounded-full flex items-center justify-center text-[#44423D] hover:text-[#111111] hover:bg-[#EFECE1] transition-all cursor-pointer bg-[#EFECE1] border border-[#111111] shadow-sm group"
                title="Expand Navigation"
              >
                <FiSidebar size={18} className="group-hover:scale-110 transition-transform text-[#111111]" />
              </button>
              <Link 
                href={getAppDestinationHref("explore")} onClick={(event) => { event.preventDefault(); navigateToAppDestination("explore"); }}
                className="w-10 h-10 rounded-xl bg-white border border-[#111111]/20 flex items-center justify-center p-1.5 shadow-sm hover:scale-105 transition-transform"
                title="Doolphin Studio"
              >
                <img src="/favicon.svg" alt="Doolphin" className="w-full h-full object-contain" />
              </Link>
            </div>
          ) : (
            <div className="flex items-center justify-between px-2 pt-1">
              <Link 
                href={getAppDestinationHref("explore")} onClick={(event) => { event.preventDefault(); navigateToAppDestination("explore"); }}
                className="flex items-center gap-3 group truncate"
              >
                <div className="w-10 h-10 rounded-xl bg-white border border-[#111111]/20 flex items-center justify-center p-1.5 shadow-sm shrink-0 group-hover:scale-105 transition-transform">
                  <img src="/favicon.svg" alt="Doolphin" className="w-full h-full object-contain" />
                </div>
                <div className="truncate">
                  <h2 className="text-2xl font-bold text-[#111111] tracking-tight font-serif leading-tight truncate">Doolphin</h2>
                  <p className="text-[10px] text-[#77746D] font-bold tracking-widest uppercase">AI UGC Studio</p>
                </div>
              </Link>

              <button
                onClick={toggleSidebar}
                className="w-8 h-8 rounded-full flex items-center justify-center text-[#44423D] hover:text-[#111111] hover:bg-[#EFECE1] border border-[#111111] transition-colors cursor-pointer shrink-0 bg-white"
                title="Collapse Sidebar"
              >
                <FiSidebar size={17} />
              </button>
            </div>
          )}

          {/* Navigation Items (Wispr Flow Capsule Tabs with text-sm & text-base font-semibold typography scale) */}
          <nav className="flex flex-col gap-2 w-full">
            {APP_NAV_DESTINATIONS.map((item) => {
              const isActive = activeDestination === item.id;
              const Icon = navIcons[item.id];
              
              return (
                <button
                  key={item.id}
                  onClick={() => navigateToDestination(item)}
                  title={item.name}
                  className={`group flex items-center gap-3 px-4 py-3 rounded-full transition-all duration-150 cursor-pointer ${
                    isCollapsed ? "justify-center px-0" : ""
                  } ${
                    isActive 
                      ? "bg-white text-[#111111] text-base font-semibold border border-[#111111] shadow-sm" 
                      : "text-[#44423D] hover:text-[#111111] hover:bg-[#EFECE1] text-sm font-medium border border-transparent"
                  }`}
                >
                  <Icon size={20} className={`shrink-0 transition-colors ${isActive ? "text-[#111111]" : "text-[#66635C] group-hover:text-[#111111]"}`} />
                  {!isCollapsed && <span className="truncate tracking-tight">{item.name}</span>}
                </button>
              );
            })}
          </nav>
        </div>

        {/* Bottom Wispr Flow Control Bar */}
        <div className="mt-4 w-full shrink-0 border-t border-[#111111] pt-4">
          {!isCollapsed ? (
            <div className="flex w-full flex-col gap-2">
              <button
                onClick={() => setIsSettingsModalOpen(true)}
                title="Settings"
                className="flex min-h-10 w-full items-center justify-center gap-2 rounded-full border border-[#111111] bg-white px-3 text-sm font-semibold text-[#111111] shadow-sm transition-all hover:bg-[#F2EFE5]"
              >
                <FiSettings size={18} className="text-[#44423D] hover:text-[#111111]" />
                <span>Settings</span>
              </button>
              <button onClick={handleSignOut} disabled={signingOut} title="Sign out" aria-busy={signingOut} className="flex min-h-10 w-full items-center justify-center gap-2 rounded-full border border-[#111111] bg-white px-3 text-sm font-semibold text-[#111111] shadow-sm transition-all hover:bg-[#F2EFE5] disabled:cursor-not-allowed disabled:opacity-60"><FiLogOut size={18} /><span>{signingOut ? "Signing out…" : "Sign out"}</span></button>
            </div>
          ) : (
            <div className="flex flex-col gap-2.5 items-center">
              <button
                onClick={() => setIsSettingsModalOpen(true)}
                title="Settings"
                className="w-11 h-11 rounded-full flex items-center justify-center text-[#44423D] hover:text-[#111111] hover:bg-[#EFECE1] transition-all cursor-pointer bg-white border border-[#111111]"
              >
                <FiSettings size={20} />
              </button>
              <button onClick={handleSignOut} disabled={signingOut} title={signingOut ? "Signing out…" : "Sign out"} aria-busy={signingOut} className="w-11 h-11 rounded-full flex items-center justify-center text-[#111111] hover:bg-[#EFECE1] transition-all cursor-pointer relative bg-white border border-[#111111] disabled:cursor-not-allowed disabled:opacity-60"><FiLogOut size={20} /><span className="sr-only">{signingOut ? "Signing out…" : "Sign out"}</span></button>
            </div>
          )}
        </div>
      </aside>

      {/* WISPR FLOW LIGHT SETTINGS MODAL WITH WARM CREAM CARDS & FAANG-GRADE DESIGN */}
      {isSettingsModalOpen && (
        <div className="fixed inset-0 z-[1000] flex items-center justify-center p-4 md:p-6">
          <div 
            onClick={() => setIsSettingsModalOpen(false)}
            className="absolute inset-0 bg-[#111111]/40 backdrop-blur-md"
          />
          <div className="relative w-full max-w-3xl h-[85vh] bg-[#FAF8ED] rounded-3xl p-6 md:p-8 shadow-2xl flex flex-col overflow-hidden text-[#111111] z-10 border-2 border-[#111111]">
            
            {/* Modal Header */}
            <div className="pb-4 border-b border-[#111111] flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-full bg-[#111111] flex items-center justify-center text-white">
                  <FiSettings size={16} />
                </div>
                <h3 className="text-xl font-bold text-[#111111] font-serif tracking-tight">Settings & Workspace</h3>
              </div>
              <button
                onClick={() => setIsSettingsModalOpen(false)}
                className="p-2 text-[#111111] hover:bg-[#EFECE1] border border-[#111111] transition-colors cursor-pointer rounded-full bg-white shadow-sm"
              >
                <FiX size={18} />
              </button>
            </div>

            {/* Settings Segmented Pill Navigation (Wispr Flow Tabs) */}
            <div className="flex border border-[#111111] gap-2 py-2 px-2 overflow-x-auto scrollbar-subtle bg-[#EFECE1] rounded-full my-4 shrink-0">
              {[
                { id: "profile", label: "Profile", icon: FiUser },
                { id: "billing", label: "Plan & Billing", icon: FiCreditCard }
              ].map((tab) => {
                const Icon = tab.icon;
                const isActive = activeSettingsTab === tab.id;
                return (
                  <button
                    key={tab.id}
                    onClick={() => setActiveSettingsTab(tab.id)}
                    className={`px-4 py-2 rounded-full text-xs md:text-sm font-semibold flex items-center gap-2 transition-all cursor-pointer whitespace-nowrap ${
                      isActive 
                        ? "bg-white text-[#111111] border border-[#111111] shadow-sm" 
                        : "text-[#44423D] hover:text-[#111111] hover:bg-white/60 border border-transparent"
                    }`}
                  >
                    <Icon size={16} />
                    <span>{tab.label}</span>
                  </button>
                );
              })}
            </div>

            {/* Settings Tab Contents */}
            <div className="flex-1 py-2 overflow-y-auto scrollbar-subtle space-y-5">
              
              {/* TAB 1: PROFILE */}
              {activeSettingsTab === "profile" && (
                <div className="space-y-5">
                  <div className="bg-[#FAF8ED] p-6 rounded-2xl space-y-5 border border-[#111111] shadow-sm">
                    <h4 className="text-xs font-bold uppercase text-[#44423D] tracking-wider">User Information</h4>
                    <div className="space-y-4">
                      <div className="space-y-1.5">
                        <label className="block text-xs font-bold text-[#111111]">Name</label>
                        <input
                          type="text"
                          value={profileName}
                          onChange={(e) => setProfileName(e.target.value)}
                          className="w-full bg-[#F2EFE5] border border-[#111111] rounded-xl px-4 py-2.5 text-sm text-[#111111] font-medium"
                        />
                      </div>
                      <div className="space-y-1.5">
                        <label className="block text-xs font-bold text-[#111111]">Email Address</label>
                        <input
                          type="email"
                          value={profileEmail}
                          onChange={(e) => setProfileEmail(e.target.value)}
                          className="w-full bg-[#F2EFE5] border border-[#111111] rounded-xl px-4 py-2.5 text-sm text-[#111111] font-medium"
                        />
                      </div>
                    </div>
                    <button
                      onClick={handleSaveAllSettings}
                      disabled={savingSettings}
                      aria-busy={savingSettings}
                      className="bg-[#E6D9FF] hover:bg-[#DBCBFF] text-[#111111] border border-[#111111] rounded-full px-6 py-2.5 text-xs md:text-sm font-semibold shadow-sm cursor-pointer transition-all disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {savingSettings ? "Saving…" : "Save Profile"}
                    </button>
                  </div>

                  {/* Account Security Info */}
                  <div className="bg-white p-6 rounded-2xl space-y-3 border border-[#111111] shadow-sm">
                    <div className="flex items-center gap-2 text-[#44423D]">
                      <FiAlertTriangle size={18} />
                      <h4 className="text-xs font-bold uppercase tracking-wider">Account Data & Security</h4>
                    </div>
                    <p className="text-xs text-[#44423D] font-medium leading-relaxed">
                      Your workspace account and billing data are protected by Supabase authentication and strict encrypted database policies.
                    </p>
                  </div>
                </div>
              )}

              {/* TAB 2: PLAN & BILLING */}
              {activeSettingsTab === "billing" && (
                <div className="space-y-5">
                  <div className="bg-[#FAF8ED] p-6 rounded-2xl space-y-5 border border-[#111111] shadow-sm">
                    <div className="flex items-center justify-between">
                      <div>
                        <span className="bg-[#064E3B] text-white border border-[#111111] px-3.5 py-1 rounded-full text-xs font-semibold">Active Plan</span>
                        <h4 className="text-2xl font-serif font-bold text-[#111111] mt-3">{activePlan?.name || "Doolphin plan"}</h4>
                      </div>
                      <span className="text-2xl font-bold text-[#111111] font-serif">{account?.credits ?? "—"} Credits</span>
                    </div>
                    <p className="text-sm text-[#44423D] font-medium leading-relaxed">
                      {activePlan ? `${activePlan.credits.toLocaleString()} credits ${activePlan.interval === "ONE_TIME" ? "included" : "granted monthly"}. Credits roll over.` : "Your active entitlement is being verified."}
                    </p>
                    <div className="flex items-center gap-3 pt-2">
                      <button
                        onClick={() => {
                          setIsSettingsModalOpen(false);
                          router.push("/app?upgrade=1");
                        }}
                        className="bg-[#E6D9FF] hover:bg-[#DBCBFF] text-[#111111] border border-[#111111] rounded-full px-6 py-2.5 text-xs md:text-sm font-semibold shadow-sm cursor-pointer transition-all"
                      >
                        Upgrade Plan
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>

          </div>
        </div>
      )}
    </>
  );
}

export default function Sidebar() {
  return (
    <Suspense fallback={<aside aria-label="Loading navigation" className="h-full w-[76px] shrink-0 rounded-[28px] border border-[#111111] bg-[#FAF8ED]" />}>
      <SidebarContent />
    </Suspense>
  );
}
