"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function PricingRedirect() {
  const router = useRouter();
  useEffect(() => {
    router.replace("/?tab=video");
  }, [router]);

  return (
    <div className="h-full w-full bg-[#FAF8ED] flex items-center justify-center">
      <div className="w-8 h-8 border-3 border-[#111111] border-t-transparent rounded-full animate-spin" />
    </div>
  );
}
