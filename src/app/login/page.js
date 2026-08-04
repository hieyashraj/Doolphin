"use client";

import { signIn, useSession } from "next-auth/react";
import { useEffect, useState, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { FaGoogle, FaKey, FaInfoCircle, FaArrowRight } from "react-icons/fa";
import toast, { Toaster } from "react-hot-toast";

function LoginContent() {
  const { status } = useSession();
  const router = useRouter();
  const searchParams = useSearchParams();
  const next = searchParams.get("callbackUrl") || searchParams.get("next") || "/";

  const [activeTab, setActiveTab] = useState("google");
  const [apiKeyInput, setApiKeyInput] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (status === "authenticated") {
      router.push(next);
    }
  }, [status, router, next]);

  const handleApiKeyLogin = async (e) => {
    e.preventDefault();
    const key = apiKeyInput.trim();
    if (!key) {
      toast.error("Please enter a valid MuAPI key");
      return;
    }
    if (key.length < 5) {
      toast.error("API Key appears too short");
      return;
    }

    setIsSubmitting(true);
    try {
      const res = await signIn("credentials", {
        apiKey: key,
        redirect: false,
        callbackUrl: next,
      });

      if (res?.error) {
        toast.error(res.error || "Failed to sign in with API key");
      } else {
        toast.success("Signed in with API Key successfully!");
        router.push(next);
      }
    } catch (err) {
      console.error(err);
      toast.error("An error occurred during API key authentication");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen w-full flex items-center justify-center p-6 text-[#1c2a32] select-none relative">
      <Toaster position="top-right" />
      <div className="glass-panel w-full max-w-md p-8 space-y-6 shadow-2xl relative z-10">
        <div className="flex flex-col items-center text-center space-y-3">
          <div className="w-14 h-14 rounded-2xl bg-[#1687f8]/12 border border-[#1687f8]/20 flex items-center justify-center text-2xl text-[#1687f8] font-bold shadow-sm">
            D
          </div>
          <h2 className="text-xl font-bold tracking-tight text-[#1c2a32]">Doolphin Enterprise</h2>
          <p className="text-xs text-[#647985] leading-relaxed">
            Access Liquid Studio with your Google Account or custom MuAPI key.
          </p>
        </div>

        {/* Auth Method Selector Tabs */}
        <div className="flex glass-control p-1">
          <button
            type="button"
            onClick={() => setActiveTab("google")}
            className={`flex-1 py-2 rounded-xl text-xs font-semibold transition-all flex items-center justify-center gap-2 cursor-pointer ${
              activeTab === "google"
                ? "bg-white/90 text-[#1687f8] shadow-sm border border-white"
                : "text-[#647985] hover:text-[#1c2a32]"
            }`}
          >
            <FaGoogle className="text-red-500" />
            <span>Google Account</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab("apikey")}
            className={`flex-1 py-2 rounded-xl text-xs font-semibold transition-all flex items-center justify-center gap-2 cursor-pointer ${
              activeTab === "apikey"
                ? "bg-white/90 text-[#1687f8] shadow-sm border border-white"
                : "text-[#647985] hover:text-[#1c2a32]"
            }`}
          >
            <FaKey className="text-[#f4ad31]" />
            <span>API Key</span>
          </button>
        </div>

        {/* Tab Content */}
        {activeTab === "google" ? (
          <div className="space-y-4 pt-2">
            <button
              onClick={() => signIn("google", { callbackUrl: next })}
              className="w-full glass-btn-secondary py-3 text-xs flex items-center justify-center gap-3 cursor-pointer"
            >
              <FaGoogle className="text-sm text-red-500" />
              <span>Continue with Google</span>
            </button>
            <p className="text-xs text-center text-[#8da1ab]">
              Uses system credit balance. Ideal for credit pack purchases.
            </p>
          </div>
        ) : (
          <form onSubmit={handleApiKeyLogin} className="space-y-4 pt-2">
            <div className="space-y-1.5">
              <label className="block text-[11px] uppercase font-semibold text-[#8da1ab] tracking-wider">
                MuAPI Secret Key
              </label>
              <input
                type="password"
                value={apiKeyInput}
                onChange={(e) => setApiKeyInput(e.target.value)}
                placeholder="mu_..."
                className="w-full glass-control px-3.5 py-2.5 text-xs text-[#1c2a32] placeholder-[#8da1ab]"
              />
              <div className="flex justify-end">
                <a
                  href="https://muapi.ai"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs text-[#1687f8] hover:underline font-medium"
                >
                  Get API Key from MuAPI →
                </a>
              </div>
            </div>

            <button
              type="submit"
              disabled={isSubmitting || !apiKeyInput.trim()}
              className="w-full glass-btn-primary py-3 text-xs flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50"
            >
              <span>{isSubmitting ? "Authenticating..." : "Sign In with API Key"}</span>
              <FaArrowRight className="text-xs" />
            </button>

            <p className="text-xs text-center text-[#1687f8] font-medium">
              ⚡ Direct access with zero credit consumption.
            </p>
          </form>
        )}

        <div className="flex items-start gap-2.5 glass-card p-3.5 text-xs leading-relaxed text-[#647985]">
          <FaInfoCircle className="text-[#1687f8] text-sm shrink-0 mt-0.5" />
          <span>
            By signing in, you agree to our Terms of Service. Custom keys are encrypted and stored safely.
          </span>
        </div>
      </div>
    </div>
  );
}

export default function Login() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen flex items-center justify-center text-[#1c2a32]">
          <div className="w-8 h-8 border-2 border-[#1687f8] border-t-transparent rounded-full animate-spin" />
        </div>
      }
    >
      <LoginContent />
    </Suspense>
  );
}
