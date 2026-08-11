"use client";

import { signIn, useSession } from "next-auth/react";
import { useEffect, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { FaGoogle, FaInfoCircle } from "react-icons/fa";

function LoginContent() {
  const { status } = useSession();
  const router = useRouter();
  const searchParams = useSearchParams();
  const next = searchParams.get("callbackUrl") || searchParams.get("next") || "/";

  useEffect(() => {
    if (status === "authenticated") router.push(next);
  }, [status, router, next]);

  return (
    <div className="min-h-screen w-full flex items-center justify-center p-6 text-[#111111] bg-[#FAF8ED]">
      <div className="bg-[#FAF8ED] border-2 border-[#111111] w-full max-w-md p-8 space-y-6 shadow-2xl rounded-3xl">
        <div className="flex flex-col items-center text-center space-y-3">
          <div className="w-16 h-16 rounded-full bg-[#111111] flex items-center justify-center text-3xl font-serif italic text-white font-bold">d</div>
          <h1 className="text-3xl font-serif font-bold">Doolphin Studio</h1>
          <p className="text-sm text-[#44423D] font-medium">Sign in to your private workspace. Provider credentials stay server-side and are never entered in the browser.</p>
        </div>
        <button onClick={() => signIn("google", { callbackUrl: next })} className="w-full bg-white hover:bg-[#F2EFE5] border border-[#111111] text-[#111111] py-3.5 rounded-full text-sm font-semibold flex items-center justify-center gap-3 shadow-sm">
          <FaGoogle className="text-red-600" />
          <span>Continue with Google</span>
        </button>
        <div className="flex items-start gap-3 bg-[#EFECE1] border border-[#111111] p-4 rounded-2xl text-xs leading-relaxed text-[#44423D] font-medium">
          <FaInfoCircle className="text-base shrink-0 mt-0.5" />
          <span>Generation uses the platform MuAPI integration and your workspace credit balance.</span>
        </div>
      </div>
    </div>
  );
}

export default function Login() {
  return <Suspense fallback={<div className="min-h-screen flex items-center justify-center bg-[#FAF8ED]">Loading…</div>}><LoginContent /></Suspense>;
}
