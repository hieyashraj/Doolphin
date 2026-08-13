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
  FiSmartphone
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
  const [isDeleteConfirmationOpen, setIsDeleteConfirmationOpen] = useState(false);
  const [deleteConfirmation, setDeleteConfirmation] = useState("");
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

  // The desktop expansion preference is retained, but a wide rail must never
  // consume most of a phone viewport. The composer can then use the remaining
  // width without horizontal overflow.
  const isCollapsed = isCollapsedManual || isMobileViewport;

  // User Profile States
  const [profileName, setProfileName] = useState("Doolphin Creator");
  const [profileEmail, setProfileEmail] = useState("");
  useEffect(() => { if (account) { setProfileName(account.name); setProfileEmail(account.email); } }, [account]);

  const [savingSettings, setSavingSettings] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  // Legacy inert UI state retained temporarily while the legacy settings markup
  // is removed; it is not navigable and never reaches a provider-key endpoint.
  const [muApiKey, setMuApiKey] = useState("");
  const [falKey, setFalKey] = useState("");
  const [elevenLabsKey] = useState("");
  const [openAiKey] = useState("");
  const [showMuKey, setShowMuKey] = useState(false);
  const [showFalKey, setShowFalKey] = useState(false);
  const activePlan = PLAN_BY_CODE[account?.planCode] || null;
  // The legacy key panel is inert; this only prevents the Navbar render from
  // evaluating an undeclared identifier while that panel is retired.
  const isApiKeyActive = false;

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

  const handleDeleteAccount = () => {
    if (deleteConfirmation !== "DELETE") return;
    // This intentionally has no API call. Permanent deletion needs its own
    // reviewed backend/data-retention checkpoint before it can be enabled.
    toast("Account deletion is not available yet. No account data was changed.", { icon: "ℹ️" });
    setDeleteConfirmation("");
    setIsDeleteConfirmationOpen(false);
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
    navigateToAppDestination(destination.id);
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
                className="relative flex min-h-10 w-full items-center justify-center gap-2 rounded-full border border-[#111111] bg-white px-3 text-sm font-semibold text-[#111111] shadow-sm transition-all hover:bg-[#F2EFE5]"
              >
                <FiSettings size={18} className="text-[#44423D] hover:text-[#111111]" />
                <span>Settings</span>
                {isApiKeyActive ? (
                  <span 
                    title="API Keys Configured"
                    className="absolute -top-0.5 -right-0.5 w-3 h-3 bg-[#064E3B] rounded-full border-2 border-[#111111] shadow-sm"
                  />
                ) : (
                  <span 
                    title="API Keys Missing"
                    className="absolute -top-0.5 -right-0.5 flex h-3 w-3"
                  >
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#B91C1C] opacity-75" />
                    <span className="relative inline-flex rounded-full h-3 w-3 bg-[#B91C1C] border-2 border-[#111111]" />
                  </span>
                )}
              </button>
              <button onClick={handleSignOut} disabled={signingOut} title="Sign out" aria-busy={signingOut} className="flex min-h-10 w-full items-center justify-center gap-2 rounded-full border border-[#111111] bg-white px-3 text-sm font-semibold text-[#111111] shadow-sm transition-all hover:bg-[#F2EFE5] disabled:cursor-not-allowed disabled:opacity-60"><FiLogOut size={18} /><span>{signingOut ? "Signing out…" : "Sign out"}</span></button>
            </div>
          ) : (
            <div className="flex flex-col gap-2.5 items-center">
              <button
                onClick={() => setIsSettingsModalOpen(true)}
                title="Settings"
                className="w-11 h-11 rounded-full flex items-center justify-center text-[#44423D] hover:text-[#111111] hover:bg-[#EFECE1] transition-all cursor-pointer relative bg-white border border-[#111111]"
              >
                <FiSettings size={20} />
                {isApiKeyActive && (
                  <span className="absolute top-0 right-0 w-3 h-3 bg-[#064E3B] rounded-full border-2 border-[#111111] shadow-sm" />
                )}
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

                  {/* Danger Zone */}
                  <div className="bg-white p-6 rounded-2xl space-y-3 border border-[#111111] shadow-sm">
                    <div className="flex items-center gap-2 text-[#44423D]">
                      <FiAlertTriangle size={18} />
                      <h4 className="text-xs font-bold uppercase tracking-wider">Danger Zone</h4>
                    </div>
                    <p className="text-xs text-[#44423D] font-medium leading-relaxed">
                      Account deletion is not available from Settings yet. It will require a dedicated, reviewed data-deletion process.
                    </p>
                    <button
                      onClick={() => setIsDeleteConfirmationOpen(true)}
                      className="bg-[#EFECE1] hover:bg-[#E5E1D5] text-[#111111] border border-[#111111] px-5 py-2.5 text-xs md:text-sm font-semibold rounded-full flex items-center gap-2 cursor-pointer transition-all shadow-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#111111]"
                      aria-haspopup="dialog"
                    >
                      <FiTrash2 size={16} />
                      <span>Review account deletion</span>
                    </button>
                    {isDeleteConfirmationOpen && (
                      <div className="rounded-xl border border-[#111111]/20 bg-[#FAF8ED] p-4 space-y-3" role="dialog" aria-modal="true" aria-labelledby="delete-confirmation-title">
                        <div className="flex items-start justify-between gap-3">
                          <div><h5 id="delete-confirmation-title" className="text-sm font-bold text-[#111111]">Confirm account deletion</h5><p className="mt-1 text-xs leading-relaxed text-[#55534E]">Type <strong>DELETE</strong> to confirm that you understand this action. Nothing will be deleted from this screen.</p></div>
                          <button onClick={() => { setIsDeleteConfirmationOpen(false); setDeleteConfirmation(""); }} className="rounded-full border border-[#111111]/20 bg-white p-1.5 text-[#44423D] hover:bg-[#EFECE1]" aria-label="Close deletion confirmation"><FiX size={15} /></button>
                        </div>
                        <label className="block text-xs font-semibold text-[#111111]" htmlFor="delete-confirmation">Type DELETE to continue<input id="delete-confirmation" value={deleteConfirmation} onChange={(event) => setDeleteConfirmation(event.target.value)} className="mt-1.5 w-full rounded-lg border border-[#111111]/20 bg-white px-3 py-2 text-sm text-[#111111] outline-none focus:border-[#111111] focus:ring-2 focus:ring-[#111111]/15" autoComplete="off" /></label>
                        <button onClick={handleDeleteAccount} disabled={deleteConfirmation !== "DELETE"} className="rounded-full border border-[#111111] bg-[#111111] px-4 py-2 text-xs font-semibold text-white hover:bg-[#33312C] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#111111] disabled:cursor-not-allowed disabled:bg-[#77746D] disabled:text-white">Confirm deletion</button>
                      </div>
                    )}
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
                          navigateAppView({ tab: "video", studio: "video_maker" });
                        }}
                        className="bg-[#E6D9FF] hover:bg-[#DBCBFF] text-[#111111] border border-[#111111] rounded-full px-6 py-2.5 text-xs md:text-sm font-semibold shadow-sm cursor-pointer transition-all"
                      >
                        Upgrade Plan
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {/* TAB 4: API KEYS */}
              {activeSettingsTab === "apikeys" && (
                <div className="space-y-4">
                  <div className="bg-[#FAF8ED] p-5 rounded-2xl border border-[#111111] shadow-sm">
                    <h4 className="text-sm font-bold text-[#111111]">Custom Provider Keys</h4>
                    <p className="text-xs text-[#44423D] font-medium mt-1">Connect your individual provider keys to generate videos directly from your accounts.</p>
                  </div>

                  {/* MuAPI Key */}
                  <div className="bg-white p-5 rounded-2xl space-y-3 border border-[#111111] shadow-sm">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-bold text-[#111111]">MuAPI Key</span>
                      <span className={muApiKey ? "bg-[#064E3B] text-white border border-[#111111] px-3 py-0.5 rounded-full text-xs font-semibold" : "bg-[#EFECE1] text-[#44423D] border border-[#111111] px-3 py-0.5 rounded-full text-xs font-semibold"}>
                        {muApiKey ? "Active" : "Not Configured"}
                      </span>
                    </div>
                    <div className="flex gap-2.5">
                      <input
                        type={showMuKey ? "text" : "password"}
                        value={muApiKey}
                        onChange={(e) => setMuApiKey(e.target.value)}
                        placeholder="mu_..."
                        className="flex-1 bg-[#F2EFE5] border border-[#111111] rounded-xl px-4 py-2.5 text-xs md:text-sm text-[#111111] font-medium"
                      />
                      <button
                        onClick={() => setShowMuKey(!showMuKey)}
                        className="bg-white border border-[#111111] px-4 py-2.5 text-xs font-semibold rounded-xl cursor-pointer hover:bg-[#F2EFE5] text-[#111111]"
                      >
                        {showMuKey ? "Hide" : "Show"}
                      </button>
                    </div>
                  </div>

                  {/* Fal.ai Key */}
                  <div className="bg-white p-5 rounded-2xl space-y-3 border border-[#111111] shadow-sm">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-bold text-[#111111]">Fal.ai API Key</span>
                      <span className={falKey ? "bg-[#064E3B] text-white border border-[#111111] px-3 py-0.5 rounded-full text-xs font-semibold" : "bg-[#EFECE1] text-[#44423D] border border-[#111111] px-3 py-0.5 rounded-full text-xs font-semibold"}>
                        {falKey ? "Active" : "Not Configured"}
                      </span>
                    </div>
                    <div className="flex gap-2.5">
                      <input
                        type={showFalKey ? "text" : "password"}
                        value={falKey}
                        onChange={(e) => setFalKey(e.target.value)}
                        placeholder="Key..."
                        className="flex-1 bg-[#F2EFE5] border border-[#111111] rounded-xl px-4 py-2.5 text-xs md:text-sm text-[#111111] font-medium"
                      />
                      <button
                        onClick={() => setShowFalKey(!showFalKey)}
                        className="bg-white border border-[#111111] px-4 py-2.5 text-xs font-semibold rounded-xl cursor-pointer hover:bg-[#F2EFE5] text-[#111111]"
                      >
                        {showFalKey ? "Hide" : "Show"}
                      </button>
                    </div>
                  </div>

                  <div className="pt-2">
                    <button
                      onClick={handleSaveAllSettings}
                      disabled={savingSettings}
                      className="bg-[#E6D9FF] hover:bg-[#DBCBFF] text-[#111111] border border-[#111111] px-6 py-3 text-xs md:text-sm font-semibold rounded-full cursor-pointer w-full shadow-sm transition-all"
                    >
                      Save API Keys
                    </button>
                  </div>
                </div>
              )}

              {/* TAB 5: MCP PROTOCOL */}
              {activeSettingsTab === "mcp" && (
                <div className="space-y-4">
                  <div className="bg-[#FAF8ED] p-6 rounded-2xl space-y-2 border border-[#111111] shadow-sm">
                    <div className="flex items-center gap-2.5">
                      <div className="w-8 h-8 rounded-full bg-[#111111] flex items-center justify-center text-white">
                        <FiCpu size={16} />
                      </div>
                      <h4 className="text-base font-serif font-bold text-[#111111]">Model Context Protocol (MCP)</h4>
                    </div>
                    <p className="text-xs text-[#44423D] font-medium leading-relaxed">
                      Connect Doolphin to Claude, Cursor & other AI tools to generate images & videos programmatically.
                    </p>
                  </div>

                  <div className="bg-white p-5 rounded-2xl space-y-3 border border-[#111111] shadow-sm">
                    <label className="block text-xs font-bold text-[#111111]">MCP Endpoint URL</label>
                    <div className="flex gap-2.5">
                      <input
                        type="text"
                        readOnly
                        value="https://doolphin.ai/api/mcp"
                        className="flex-1 bg-[#F2EFE5] border border-[#111111] rounded-xl px-4 py-2.5 text-xs md:text-sm font-mono text-[#111111]"
                      />
                      <button
                        onClick={() => copyToClipboard("https://doolphin.ai/api/mcp", "MCP Endpoint URL")}
                        className="bg-white border border-[#111111] hover:bg-[#F2EFE5] rounded-xl px-4 py-2.5 text-xs font-semibold flex items-center gap-1.5 cursor-pointer text-[#111111]"
                      >
                        <FiCopy size={15} />
                        <span>Copy</span>
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
