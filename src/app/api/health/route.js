import { NextResponse } from "next/server";
import { getMockSession as getServerSession } from "@/lib/getMockSession";
import { getProviderAdapter } from "@/lib/adapters";

export async function GET() {
  try {
    const session = await getServerSession();
    const isDev = process.env.NODE_ENV === "development";

    if (!session?.user && !isDev) {
      // Public production health check returns generic status only
      return NextResponse.json({ status: "ok" });
    }

    const falKeyPresent = Boolean((session?.user?.falKey || process.env.FAL_KEY || "").trim());
    const ugcKeyPresent = Boolean((session?.user?.customApiKey || process.env.MUAPI_API_KEY || process.env.UGC_API_KEY || "").trim());

    let adapterStatus = "OK";
    let endpoint = "";
    try {
      const adapter = getProviderAdapter("fal-kling-3-std");
      endpoint = adapter.getEndpoint("fal-kling-3-std", "http://localhost:3000/api/webhook/fal");
    } catch (err) {
      adapterStatus = `Error: ${err.message}`;
    }

    const isV3Endpoint = endpoint.includes("/v3/standard/image-to-video");

    return NextResponse.json({
      status: "ok",
      diagnostics: {
        falConfigured: falKeyPresent,
        ugcConfigured: ugcKeyPresent,
        klingAdapterStatus: adapterStatus,
        isV3Endpoint
      }
    });
  } catch (error) {
    return NextResponse.json({
      status: "error",
      error: "Health check failed"
    }, { status: 500 });
  }
}
