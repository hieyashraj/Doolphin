import { NextResponse } from "next/server";
import { getProviderAdapter } from "@/lib/adapters";

export async function GET() {
  try {
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
        klingAdapterStatus: adapterStatus,
        isV3Endpoint,
      },
    });
  } catch (error) {
    return NextResponse.json(
      { status: "error", error: "Health check failed" },
      { status: 500 }
    );
  }
}
