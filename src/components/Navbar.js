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
  const [isHovered, setIsHovered] = useState(false);
  const [isCollapsedManual, setIsCollapsedManual] = useState(false);
  const [isSettingsModalOpen, setIsSettingsModalOpen] = useState(false);
  const [activeSettingsTab, setActiveSettingsTab] = useState("profile"); // profile, billing, notifications, apikeys, mcp

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", "dark");
  }, []);

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

  // Nav Items: Presets removed from left nav, Script Studio removed entirely
  const mainNavItems = [
    {
      id: "explore",
      name: "Explore",
      icon: FiCompass,
      action: () => router.push("/?tab=explore")
    },
    {
      id: "video",
      name: "Video",
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
      {/* Riverside-Grade Production Navigation Sidebar */}
      <aside 
        onMouseEnter={() => !isCollapsedManual && setIsHovered(true)}
        onMouseLeave={() => !isCollapsedManual && setIsHovered(false)}
        className={`glass-rail flex flex-col justify-between p-4 h-full flex-shrink-0 z-40 select-none rounded-[24px] transition-all duration-200 ease-out ${
          (isHovered || !isCollapsedManual) ? "w-60 shadow-2xl" : "w-[72px]"
        }`}
      >
        <div className="w-full flex flex-col gap-6">
          {/* Riverside Logo Mark & Header */}
          <div className="flex items-center justify-between px-1 pt-1">
            <Link 
              href="/" 
              className="flex items-center gap-3 group"
            >
              <div className="w-8 h-8 rounded-lg bg-white text-black flex items-center justify-center font-black text-lg shadow-md group-hover:scale-105 transition-transform">
                <span>D</span>
              </div>
              {(isHovered || !isCollapsedManual) && (
                <div className="truncate">
                  <h2 className="text-sm font-extrabold text-white tracking-[0.14em] uppercase truncate">Doolphin</h2>
                  <p className="text-[10px] text-white/50 tracking-[0.18em] font-semibold uppercase">Studio</p>
                </div>
              )}
            </Link>

            {(isHovered || !isCollapsedManual) && (
              <button
                onClick={() => setIsCollapsedManual(!isCollapsedManual)}
                className="w-7 h-7 rounded-lg flex items-center justify-center text-white/40 hover:text-white hover:bg-white/10 transition-colors cursor-pointer"
                title="Toggle Sidebar"
              >
                <FiSidebar size={16} />
              </button>
            )}
          </div>

          {/* Navigation Items - Riverside Exact Spacing & Bold Typography */}
          <nav className="flex flex-col gap-1.5 w-full">
            {mainNavItems.map((item) => {
              const isActive = currentTab === item.id;
              const Icon = item.icon;
              
              return (
                <button
                  key={item.id}
                  onClick={item.action}
                  title={item.name}
                  className={`group flex items-center gap-3.5 px-3.5 py-2.5 rounded-xl text-sm transition-all duration-150 cursor-pointer ${
                    isActive 
                      ? "bg-white/[0.09] text-white font-semibold border border-white/10 shadow-sm" 
                      : "text-[#a1a1aa] hover:text-white hover:bg-white/[0.04]"
                  }`}
                >
                  <Icon size={20} className={`shrink-0 transition-colors ${isActive ? "text-white" : "text-[#a1a1aa] group-hover:text-white"}`} />
                  {(isHovered || !isCollapsedManual) && <span className="font-semibold truncate tracking-wide">{item.name}</span>}
                </button>
              );
            })}
          </nav>
        </div>

        {/* Bottom Configuration Controls - Riverside Action Pills */}
        <div className="w-full pt-4 border-t glass-divider flex flex-col gap-2.5">
          {(isHovered || !isCollapsedManual) ? (
            <>
              <div className="flex items-center gap-2 w-full">
                <button
                  onClick={() => router.push("/?tab=video")}
                  className="flex-1 bg-[#1c1c20] hover:bg-[#27272c] text-white font-semibold text-xs px-3.5 py-2.5 rounded-full border border-white/10 flex items-center justify-center gap-2 shadow-sm transition-all active:scale-95 cursor-pointer"
                >
                  <FiZap size={14} className="text-[#1687f8]" />
                  <span>Open Studio</span>
                </button>

                <button
                  onClick={() => setIsSettingsModalOpen(false) || setIsSettingsModalOpen(true)}
                  title="Settings"
                  className="w-9 h-9 rounded-full bg-[#1c1c20] hover:bg-[#27272c] border border-white/10 flex items-center justify-center text-white relative shadow-sm cursor-pointer transition-all shrink-0"
                >
                  <FiSettings size={18} className="text-[#a1a1aa] group-hover:text-white transition-colors" />
                  {isApiKeyActive ? (
                    <span 
                      title="API Keys Live (Dev Mode)"
                      className="absolute -top-0.5 -right-0.5 w-2.5 h-2.5 bg-[#2cbd59] rounded-full border-2 border-black/80 shadow-sm"
                    />
                  ) : (
                    <span 
                      title="API Keys Missing (Dev Mode)"
                      className="absolute -top-0.5 -right-0.5 flex h-2.5 w-2.5"
                    >
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#ff4238] opacity-75" />
                      <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-[#ff4238] border-2 border-black/80" />
                    </span>
                  )}
                </button>
              </div>

            </>
          ) : (
            <div className="flex flex-col gap-2 items-center">

              <button
                onClick={() => setIsSettingsModalOpen(true)}
                title="Settings"
                className="w-10 h-10 rounded-xl flex items-center justify-center text-[#a1a1aa] hover:text-white hover:bg-white/10 transition-all cursor-pointer relative"
              >
                <FiSettings size={20} />
                {isApiKeyActive ? (
                  <span className="absolute top-1 right-1 w-2.5 h-2.5 bg-[#2cbd59] rounded-full border-2 border-black/80 shadow-sm" />
                ) : (
                  <span className="absolute top-1 right-1 flex h-2.5 w-2.5">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#ff4238] opacity-75" />
                    <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-[#ff4238] border-2 border-black/80" />
                  </span>
                )}
              </button>
            </div>
          )}
        </div>
      </aside>

      {/* COMPREHENSIVE SETTINGS MODAL (FAANG STANDARD) */}
      {isSettingsModalOpen && (
        <div className="fixed inset-0 z-[1000] flex items-center justify-center p-4">
          <div 
            onClick={() => setIsSettingsModalOpen(false)}
            className="absolute inset-0 bg-black/75 backdrop-blur-xl"
          />
          <div className="relative w-full max-w-3xl h-[80vh] glass-panel p-6 shadow-2xl flex flex-col overflow-hidden text-white z-10 border border-white/10 bg-[#0d0d12]/90">
            
            {/* Modal Header */}
            <div className="pb-4 border-b glass-divider flex items-center justify-between">
              <div className="flex items-center gap-2">
                <FiSettings size={18} className="text-[#0070f3]" />
                <h3 className="text-sm font-bold text-white tracking-wide">Settings & Workspace</h3>
              </div>
              <button
                onClick={() => setIsSettingsModalOpen(false)}
                className="p-1.5 text-slate-400 hover:text-white transition-colors cursor-pointer rounded-lg hover:bg-white/10"
              >
                <FiX size={18} />
              </button>
            </div>

            {/* Settings Tab Navigation */}
            <div className="flex border-b glass-divider gap-1.5 py-2.5 overflow-x-auto scrollbar-subtle">
              {[
                { id: "profile", label: "Profile", icon: FiUser },
                { id: "billing", label: "Plan & Billing", icon: FiCreditCard },
                { id: "notifications", label: "Notifications", icon: FiBell },
                { id: "apikeys", label: "API Keys", icon: FiKey },
                { id: "mcp", label: "MCP Protocol", icon: FiCpu }
              ].map((tab) => {
                const Icon = tab.icon;
                const isActive = activeSettingsTab === tab.id;
                return (
                  <button
                    key={tab.id}
                    onClick={() => setActiveSettingsTab(tab.id)}
                    className={`px-3.5 py-2 rounded-xl text-xs font-semibold flex items-center gap-2 transition-all cursor-pointer whitespace-nowrap ${
                      isActive 
                        ? "bg-[#0070f3]/20 text-[#38bdf8] border border-[#0070f3]/40 shadow-sm backdrop-blur-md" 
                        : "text-slate-400 hover:text-white hover:bg-white/5"
                    }`}
                  >
                    <Icon size={14} />
                    <span>{tab.label}</span>
                  </button>
                );
              })}
            </div>

            {/* Settings Tab Contents */}
            <div className="flex-1 py-5 overflow-y-auto scrollbar-subtle space-y-5">
              
              {/* TAB 1: PROFILE */}
              {activeSettingsTab === "profile" && (
                <div className="space-y-5">
                  <div className="glass-card p-5 space-y-4 border border-white/10">
                    <h4 className="text-xs font-semibold uppercase text-slate-400 tracking-wider">User Information</h4>
                    <div className="space-y-3">
                      <div className="space-y-1">
                        <label className="block text-xs font-semibold text-slate-300">Name</label>
                        <input
                          type="text"
                          value={profileName}
                          onChange={(e) => setProfileName(e.target.value)}
                          className="w-full glass-control px-3.5 py-2.5 text-xs text-white placeholder-slate-500"
                        />
                      </div>
                      <div className="space-y-1">
                        <label className="block text-xs font-semibold text-slate-300">Email Address</label>
                        <input
                          type="email"
                          value={profileEmail}
                          onChange={(e) => setProfileEmail(e.target.value)}
                          className="w-full glass-control px-3.5 py-2.5 text-xs text-white placeholder-slate-500"
                        />
                      </div>
                    </div>
                    <button
                      onClick={handleSaveAllSettings}
                      disabled={savingSettings}
                      className="glass-btn-primary px-4 py-2 text-xs cursor-pointer"
                    >
                      Save Profile
                    </button>
                  </div>

                  {/* Danger Zone */}
                  <div className="glass-card p-5 space-y-3 border-red-500/30 bg-red-500/5">
                    <div className="flex items-center gap-2 text-red-400">
                      <FiAlertTriangle size={16} />
                      <h4 className="text-xs font-semibold uppercase tracking-wider">Danger Zone</h4>
                    </div>
                    <p className="text-xs text-slate-400">Deleting your account will remove all saved videos, configurations, and history permanently.</p>
                    <button
                      onClick={handleDeleteAccount}
                      disabled={savingSettings}
                      className="glass-chip-red px-4 py-2 text-xs font-semibold flex items-center gap-2 cursor-pointer hover:bg-red-500/20"
                    >
                      <FiTrash2 size={14} />
                      <span>Delete Account</span>
                    </button>
                  </div>
                </div>
              )}

              {/* TAB 2: PLAN & BILLING */}
              {activeSettingsTab === "billing" && (
                <div className="space-y-5">
                  <div className="glass-card p-5 space-y-4 border border-white/10">
                    <div className="flex items-center justify-between">
                      <div>
                        <span className="glass-chip-blue px-2.5 py-0.5 text-[10px]">Active Plan</span>
                        <h4 className="text-lg font-bold text-white mt-1">Doolphin Pro</h4>
                      </div>
                      <span className="text-2xl font-bold text-[#38bdf8]">{session?.user?.credits ?? "9,999"} Credits</span>
                    </div>
                    <p className="text-xs text-slate-400">High-volume video generation enabled. Auto-topup available.</p>
                    <div className="flex items-center gap-3 pt-2">
                      <button
                        onClick={() => {
                          setIsSettingsModalOpen(false);
                          router.push("/?tab=video");
                        }}
                        className="glass-btn-primary px-4 py-2 text-xs cursor-pointer"
                      >
                        Upgrade Plan
                      </button>
                      <a
                        href="mailto:support@doolphin.ai"
                        target="_blank"
                        rel="noreferrer"
                        className="text-xs text-[#38bdf8] font-semibold hover:underline flex items-center gap-1"
                      >
                        <span>Need help with billing?</span>
                        <FiExternalLink size={12} />
                      </a>
                    </div>
                  </div>
                </div>
              )}

              {/* TAB 3: NOTIFICATIONS */}
              {activeSettingsTab === "notifications" && (
                <div className="glass-card p-5 space-y-4 border border-white/10">
                  <div>
                    <h4 className="text-sm font-semibold text-white">Email Notifications</h4>
                    <p className="text-xs text-slate-400 mt-1">Control the emails Doolphin sends you about your generations.</p>
                  </div>

                  <div className="border-t glass-divider pt-4 flex items-start justify-between gap-4">
                    <div className="space-y-1">
                      <h5 className="text-xs font-semibold text-white">Generation completion emails</h5>
                      <p className="text-xs text-slate-400 leading-relaxed">
                        Get an email each time one of your generations finishes, with a link to open it in Doolphin.
                      </p>
                    </div>
                    <button
                      onClick={() => {
                        setCompletionEmailEnabled(!completionEmailEnabled);
                        toast.success(completionEmailEnabled ? "Completion emails disabled" : "Completion emails enabled");
                      }}
                      className={`w-11 h-6 rounded-full transition-colors flex items-center p-1 cursor-pointer ${
                        completionEmailEnabled ? "bg-[#0070f3]" : "bg-slate-700"
                      }`}
                    >
                      <div className={`w-4 h-4 rounded-full bg-white transition-transform ${completionEmailEnabled ? "translate-x-5" : "translate-x-0"}`} />
                    </button>
                  </div>
                </div>
              )}

              {/* TAB 4: FAANG SMART MULTI-KEY PROVIDER MANAGER */}
              {activeSettingsTab === "apikeys" && (
                <div className="space-y-4">
                  <div className="glass-card p-4 border border-white/10">
                    <h4 className="text-xs font-semibold text-white">Custom Provider Keys</h4>
                    <p className="text-xs text-slate-400 mt-1">Connect your individual provider keys to generate videos directly from your accounts.</p>
                  </div>

                  {/* MuAPI Key */}
                  <div className="glass-card p-4 space-y-2 border border-white/10">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-semibold text-white">MuAPI Key</span>
                      <span className={muApiKey ? "glass-chip-green px-2 py-0.5 text-[10px]" : "glass-chip-blue px-2 py-0.5 text-[10px]"}>
                        {muApiKey ? "Active" : "Not Configured"}
                      </span>
                    </div>
                    <div className="flex gap-2">
                      <input
                        type={showMuKey ? "text" : "password"}
                        value={muApiKey}
                        onChange={(e) => setMuApiKey(e.target.value)}
                        placeholder="mu_..."
                        className="flex-1 glass-control px-3 py-2 text-xs text-white"
                      />
                      <button
                        onClick={() => setShowMuKey(!showMuKey)}
                        className="glass-btn-secondary px-3 py-2 text-xs cursor-pointer"
                      >
                        {showMuKey ? "Hide" : "Show"}
                      </button>
                    </div>
                  </div>

                  {/* Fal.ai API Key */}
                  <div className="glass-card p-4 space-y-2 border border-white/10">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-semibold text-white">Fal.ai API Key</span>
                      <span className={falKey ? "glass-chip-green px-2 py-0.5 text-[10px]" : "glass-chip-blue px-2 py-0.5 text-[10px]"}>
                        {falKey ? "Active" : "Not Configured"}
                      </span>
                    </div>
                    <div className="flex gap-2">
                      <input
                        type={showFalKey ? "text" : "password"}
                        value={falKey}
                        onChange={(e) => setFalKey(e.target.value)}
                        placeholder="Key..."
                        className="flex-1 glass-control px-3 py-2 text-xs text-white"
                      />
                      <button
                        onClick={() => setShowFalKey(!showFalKey)}
                        className="glass-btn-secondary px-3 py-2 text-xs cursor-pointer"
                      >
                        {showFalKey ? "Hide" : "Show"}
                      </button>
                    </div>
                  </div>

                  {/* ElevenLabs API Key */}
                  <div className="glass-card p-4 space-y-2 border border-white/10">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-semibold text-white">ElevenLabs API Key</span>
                      <span className={elevenLabsKey ? "glass-chip-green px-2 py-0.5 text-[10px]" : "glass-chip-blue px-2 py-0.5 text-[10px]"}>
                        {elevenLabsKey ? "Active" : "Not Configured"}
                      </span>
                    </div>
                    <div className="flex gap-2">
                      <input
                        type={showElevenKey ? "text" : "password"}
                        value={elevenLabsKey}
                        onChange={(e) => setElevenLabsKey(e.target.value)}
                        placeholder="el_..."
                        className="flex-1 glass-control px-3 py-2 text-xs text-white"
                      />
                      <button
                        onClick={() => setShowElevenKey(!showElevenKey)}
                        className="glass-btn-secondary px-3 py-2 text-xs cursor-pointer"
                      >
                        {showElevenKey ? "Hide" : "Show"}
                      </button>
                    </div>
                  </div>

                  {/* OpenAI API Key */}
                  <div className="glass-card p-4 space-y-2 border border-white/10">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-semibold text-white">OpenAI API Key</span>
                      <span className={openAiKey ? "glass-chip-green px-2 py-0.5 text-[10px]" : "glass-chip-blue px-2 py-0.5 text-[10px]"}>
                        {openAiKey ? "Active" : "Not Configured"}
                      </span>
                    </div>
                    <div className="flex gap-2">
                      <input
                        type={showOpenAiKey ? "text" : "password"}
                        value={openAiKey}
                        onChange={(e) => setOpenAiKey(e.target.value)}
                        placeholder="sk-..."
                        className="flex-1 glass-control px-3 py-2 text-xs text-white"
                      />
                      <button
                        onClick={() => setShowOpenAiKey(!showOpenAiKey)}
                        className="glass-btn-secondary px-3 py-2 text-xs cursor-pointer"
                      >
                        {showOpenAiKey ? "Hide" : "Show"}
                      </button>
                    </div>
                  </div>

                  <div className="pt-2">
                    <button
                      onClick={handleSaveAllSettings}
                      disabled={savingSettings}
                      className="glass-btn-primary px-5 py-2.5 text-xs cursor-pointer w-full"
                    >
                      Save API Keys
                    </button>
                  </div>
                </div>
              )}

              {/* TAB 5: MCP (MODEL CONTEXT PROTOCOL) */}
              {activeSettingsTab === "mcp" && (
                <div className="space-y-4">
                  <div className="glass-card p-5 space-y-2 border border-white/10">
                    <div className="flex items-center gap-2">
                      <FiCpu className="text-[#0070f3]" size={18} />
                      <h4 className="text-sm font-semibold text-white">Model Context Protocol (MCP)</h4>
                    </div>
                    <p className="text-xs text-slate-400 leading-relaxed">
                      Connect Doolphin to Claude, Cursor & other AI tools to generate images & videos, check status, and pull assets programmatically — from your own account and credits.
                    </p>
                  </div>

                  <div className="glass-card p-4 space-y-2 border border-white/10">
                    <label className="block text-xs font-semibold text-slate-400">MCP Endpoint URL</label>
                    <div className="flex gap-2">
                      <input
                        type="text"
                        readOnly
                        value="https://doolphin.ai/api/mcp"
                        className="flex-1 glass-control px-3 py-2 text-xs font-mono text-[#38bdf8]"
                      />
                      <button
                        onClick={() => copyToClipboard("https://doolphin.ai/api/mcp", "MCP Endpoint URL")}
                        className="glass-btn-secondary px-3 py-2 text-xs flex items-center gap-1 cursor-pointer"
                      >
                        <FiCopy size={13} />
                        <span>Copy</span>
                      </button>
                    </div>
                  </div>

                  <div className="glass-card p-4 space-y-2 border border-white/10">
                    <label className="block text-xs font-semibold text-slate-400">Claude / Cursor Config (`claude_desktop_config.json`)</label>
                    <pre className="glass-control p-3 text-[11px] font-mono leading-relaxed text-slate-300 overflow-x-auto bg-black/50 border border-white/10">
{`{
  "mcpServers": {
    "doolphin": {
      "url": "https://doolphin.ai/api/mcp",
      "headers": {
        "Authorization": "Bearer doolphin_mcp_token"
      }
    }
  }
}`}
                    </pre>
                    <button
                      onClick={() => copyToClipboard(`{\n  "mcpServers": {\n    "doolphin": {\n      "url": "https://doolphin.ai/api/mcp"\n    }\n  }\n}`, "MCP Config")}
                      className="glass-btn-secondary px-3.5 py-1.5 text-xs flex items-center gap-1.5 cursor-pointer mt-2"
                    >
                      <FiCopy size={13} />
                      <span>Copy Config JSON</span>
                    </button>
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
    <Suspense fallback={<aside className="w-16 glass-rail flex flex-col items-center py-5 h-full flex-shrink-0 my-3 ml-3 rounded-[24px]" />}>
      <SidebarContent />
    </Suspense>
  );
}
