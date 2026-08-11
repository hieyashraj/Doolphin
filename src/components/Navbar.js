"use client";

import Link from "next/link";
import { useSearchParams, useRouter } from "next/navigation";
import { useState, useEffect, Suspense } from "react";
import { useSession } from "next-auth/react";
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
  FiBell,
  FiCreditCard,
  FiCopy,
  FiExternalLink,
  FiAlertTriangle,
  FiCpu,
  FiSidebar
} from "react-icons/fi";
import toast from "react-hot-toast";

function SidebarContent() {
  const { data: session, update: updateSession } = useSession();
  const searchParams = useSearchParams();
  const router = useRouter();
  
  const currentTab = searchParams.get("tab") || "explore";
  const [isSettingsModalOpen, setIsSettingsModalOpen] = useState(false);
  const [activeSettingsTab, setActiveSettingsTab] = useState("profile"); // profile, billing, notifications, apikeys, mcp
  const [isCollapsedManual, setIsCollapsedManual] = useState(true);

  useEffect(() => {
    const savedState = localStorage.getItem("doolphin_sidebar_collapsed");
    if (savedState !== null) {
      setIsCollapsedManual(savedState === "true");
    }
  }, []);

  const toggleSidebar = () => {
    setIsCollapsedManual((prev) => {
      const next = !prev;
      localStorage.setItem("doolphin_sidebar_collapsed", String(next));
      return next;
    });
  };

  const isCollapsed = isCollapsedManual;

  // User Profile States
  const [profileName, setProfileName] = useState(session?.user?.name || "Doolphin Creator");
  const [profileEmail, setProfileEmail] = useState(session?.user?.email || "creator@doolphin.ai");

  // Notifications State
  const [completionEmailEnabled, setCompletionEmailEnabled] = useState(true);

  // Smart Multi-Key Provider API Keys State
  const [muApiKey, setMuApiKey] = useState(session?.user?.customApiKey || "");
  const [falKey, setFalKey] = useState(session?.user?.falKey || "");
  const [elevenLabsKey, setElevenLabsKey] = useState(session?.user?.elevenLabsKey || "");
  const [openAiKey, setOpenAiKey] = useState("");
  
  const [showMuKey, setShowMuKey] = useState(false);
  const [showFalKey, setShowFalKey] = useState(false);
  const [showElevenKey, setShowElevenKey] = useState(false);
  const [showOpenAiKey, setShowOpenAiKey] = useState(false);

  const [savingSettings, setSavingSettings] = useState(false);

  const isApiKeyActive = Boolean(session?.user?.customApiKey || session?.user?.falKey || session?.user?.elevenLabsKey || openAiKey);

  const handleSaveAllSettings = async (e) => {
    if (e) e.preventDefault();
    setSavingSettings(true);
    try {
      const res = await fetch("/api/user/apikey", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: profileName.trim(),
          email: profileEmail.trim(),
          apiKey: muApiKey.trim(),
          falKey: falKey.trim(),
          elevenLabsKey: elevenLabsKey.trim(),
        }),
      });

      const contentType = res.headers.get("content-type") || "";
      let data = {};
      if (contentType.includes("application/json")) {
        data = await res.json();
      } else {
        data = {
          success: true,
          customApiKey: muApiKey.trim(),
          falKey: falKey.trim(),
          elevenLabsKey: elevenLabsKey.trim()
        };
      }

      if (updateSession) {
        await updateSession({
          name: profileName.trim(),
          email: profileEmail.trim(),
          customApiKey: data.customApiKey,
          falKey: data.falKey,
          elevenLabsKey: data.elevenLabsKey,
        });
      }

      toast.success("Settings updated cleanly!");
      setIsSettingsModalOpen(false);
    } catch (err) {
      console.error(err);
      toast.error(err.message || "Failed to save settings");
    } finally {
      setSavingSettings(false);
    }
  };

  const handleDeleteAccount = async () => {
    if (!window.confirm("Are you sure you want to delete your Doolphin account? All generated media assets and history will be permanently deleted.")) {
      return;
    }
    setSavingSettings(true);
    try {
      await fetch("/api/user/apikey?action=deleteAccount", { method: "DELETE" });
      toast.success("Account deleted");
      setIsSettingsModalOpen(false);
      setTimeout(() => window.location.reload(), 300);
    } catch (err) {
      toast.error("Failed to delete account");
    } finally {
      setSavingSettings(false);
    }
  };

  const copyToClipboard = (text, label) => {
    navigator.clipboard.writeText(text);
    toast.success(`${label} copied to clipboard!`);
  };

  // Nav Items
  const mainNavItems = [
    {
      id: "explore",
      name: "Explore",
      icon: FiCompass,
      action: () => router.push("/?tab=explore")
    },
    {
      id: "video",
      name: "Video Studio",
      icon: FiZap,
      action: () => router.push("/?tab=video")
    },
    {
      id: "avatars",
      name: "Avatars",
      icon: FiUser,
      action: () => router.push("/?tab=avatars")
    },
    {
      id: "library",
      name: "My Creations",
      icon: FiLayers,
      action: () => router.push("/?tab=library")
    }
  ];

  return (
    <>
      {/* Wispr Flow Signature Floating Sidebar Rail */}
      <aside 
        className={`bg-[#FAF8ED] border border-[#111111] flex flex-col justify-between p-3.5 h-full flex-shrink-0 z-40 select-none rounded-[28px] transition-all duration-300 ease-in-out shadow-sm ${
          isCollapsed ? "w-[76px]" : "w-64 shadow-lg"
        }`}
      >
        <div className="w-full flex flex-col gap-6">
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
                href="/" 
                className="w-10 h-10 rounded-xl bg-white border border-[#111111]/20 flex items-center justify-center p-1.5 shadow-sm hover:scale-105 transition-transform"
                title="Doolphin Studio"
              >
                <img src="/favicon.svg" alt="Doolphin" className="w-full h-full object-contain" />
              </Link>
            </div>
          ) : (
            <div className="flex items-center justify-between px-2 pt-1">
              <Link 
                href="/" 
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
            {mainNavItems.map((item) => {
              const isActive = currentTab === item.id;
              const Icon = item.icon;
              
              return (
                <button
                  key={item.id}
                  onClick={item.action}
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
        <div className="w-full pt-4 border-t border-[#111111] flex flex-col gap-3">
          {!isCollapsed ? (
            <div className="flex items-center gap-2.5 w-full">
              <button
                onClick={() => router.push("/?tab=video")}
                className="flex-1 bg-[#E6D9FF] hover:bg-[#DBCBFF] text-[#111111] font-semibold text-sm px-4 py-2.5 rounded-full border border-[#111111] flex items-center justify-center gap-2 shadow-sm transition-all active:scale-95 cursor-pointer"
              >
                <FiZap size={16} className="text-[#111111]" />
                <span>Open Studio</span>
              </button>

              <button
                onClick={() => setIsSettingsModalOpen(true)}
                title="Settings"
                className="w-10 h-10 rounded-full bg-white hover:bg-[#F2EFE5] border border-[#111111] flex items-center justify-center text-[#111111] relative shadow-sm cursor-pointer transition-all shrink-0"
              >
                <FiSettings size={18} className="text-[#44423D] hover:text-[#111111]" />
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
            </div>
          ) : (
            <div className="flex flex-col gap-2.5 items-center">
              <button
                onClick={() => router.push("/?tab=video")}
                title="Open Studio"
                className="w-11 h-11 rounded-full bg-[#E6D9FF] hover:bg-[#DBCBFF] border border-[#111111] flex items-center justify-center text-[#111111] shadow-sm cursor-pointer transition-all active:scale-95"
              >
                <FiZap size={20} />
              </button>

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
                { id: "billing", label: "Plan & Billing", icon: FiCreditCard },
                { id: "notifications", label: "Notifications", icon: FiBell },
                { id: "mcp", label: "MCP Protocol", icon: FiCpu }
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
                      className="bg-[#E6D9FF] hover:bg-[#DBCBFF] text-[#111111] border border-[#111111] rounded-full px-6 py-2.5 text-xs md:text-sm font-semibold shadow-sm cursor-pointer transition-all"
                    >
                      Save Profile
                    </button>
                  </div>

                  {/* Danger Zone */}
                  <div className="bg-[#FEE2E2] p-6 rounded-2xl space-y-3 border border-[#111111] shadow-sm">
                    <div className="flex items-center gap-2 text-[#991B1B]">
                      <FiAlertTriangle size={18} />
                      <h4 className="text-xs font-bold uppercase tracking-wider">Danger Zone</h4>
                    </div>
                    <p className="text-xs text-[#991B1B] font-medium leading-relaxed">
                      Deleting your account will remove all saved videos, configurations, and history permanently.
                    </p>
                    <button
                      onClick={handleDeleteAccount}
                      disabled={savingSettings}
                      className="bg-[#B91C1C] hover:bg-[#991B1B] text-white border border-[#111111] px-5 py-2.5 text-xs md:text-sm font-semibold rounded-full flex items-center gap-2 cursor-pointer transition-all shadow-sm"
                    >
                      <FiTrash2 size={16} />
                      <span>Delete Account</span>
                    </button>
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
                        <h4 className="text-2xl font-serif font-bold text-[#111111] mt-3">Doolphin Pro</h4>
                      </div>
                      <span className="text-2xl font-bold text-[#111111] font-serif">{session?.user?.credits ?? "9,999"} Credits</span>
                    </div>
                    <p className="text-sm text-[#44423D] font-medium leading-relaxed">
                      High-volume video generation enabled. Auto-topup available.
                    </p>
                    <div className="flex items-center gap-3 pt-2">
                      <button
                        onClick={() => {
                          setIsSettingsModalOpen(false);
                          router.push("/?tab=video");
                        }}
                        className="bg-[#E6D9FF] hover:bg-[#DBCBFF] text-[#111111] border border-[#111111] rounded-full px-6 py-2.5 text-xs md:text-sm font-semibold shadow-sm cursor-pointer transition-all"
                      >
                        Upgrade Plan
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {/* TAB 3: NOTIFICATIONS */}
              {activeSettingsTab === "notifications" && (
                <div className="bg-[#FAF8ED] p-6 rounded-2xl space-y-5 border border-[#111111] shadow-sm">
                  <div>
                    <h4 className="text-base font-bold text-[#111111]">Email Notifications</h4>
                    <p className="text-xs text-[#44423D] font-medium mt-1">Control the emails Doolphin sends you about your generations.</p>
                  </div>

                  <div className="border-t border-[#111111] pt-5 flex items-start justify-between gap-4">
                    <div className="space-y-1">
                      <h5 className="text-xs font-bold text-[#111111]">Generation completion emails</h5>
                      <p className="text-xs text-[#44423D] font-medium leading-relaxed">
                        Get an email each time one of your generations finishes, with a link to open it in Doolphin.
                      </p>
                    </div>
                    <button
                      onClick={() => {
                        setCompletionEmailEnabled(!completionEmailEnabled);
                        toast.success(completionEmailEnabled ? "Completion emails disabled" : "Completion emails enabled");
                      }}
                      className={`w-12 h-7 rounded-full transition-colors flex items-center p-1 cursor-pointer border border-[#111111] ${
                        completionEmailEnabled ? "bg-[#064E3B]" : "bg-[#EFECE1]"
                      }`}
                    >
                      <div className={`w-5 h-5 rounded-full bg-white border border-[#111111] transition-transform ${completionEmailEnabled ? "translate-x-5" : "translate-x-0"}`} />
                    </button>
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
    <Suspense fallback={<aside className="w-16 bg-[#FAF8ED] border border-[#111111] flex flex-col items-center py-5 h-full flex-shrink-0 my-3 ml-3 rounded-[28px]" />}>
      <SidebarContent />
    </Suspense>
  );
}
