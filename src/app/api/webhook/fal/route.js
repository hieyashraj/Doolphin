import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function POST(req) {
  try {
    const data = await req.json();
    console.log("[FAL_WEBHOOK_RECEIVED]", data);

    const requestId = data.request_id;

    if (!requestId) {
      console.error("[FAL_WEBHOOK_ERROR] Missing request_id in payload", data);
      return NextResponse.json({ error: "Missing request_id" }, { status: 400 });
    }

    const creation = await prisma.creation.findUnique({
      where: { requestId }
    });

    if (!creation) {
      console.warn(`[FAL_WEBHOOK] Creation with requestId ${requestId} not found.`);
      return NextResponse.json({ error: "Creation not found" }, { status: 404 });
    }

    const hasError = data.status === "ERROR" || data.status === "failed" || (data.error && data.error !== "");

    if (hasError) {
      await prisma.creation.update({
        where: { id: creation.id },
        data: {
          status: "failed",
          error: data.error || "Generation failed"
        }
      });
      console.log(`[FAL_WEBHOOK] Marked creation ${creation.id} as failed.`);
    } else if (data.status === "OK" || data.status === "completed" || data.video || data.images) {
      // Fal.ai video endpoints output is usually data.video.url
      // Image endpoints output is usually data.images[0].url
      const videoUrl = data.video?.url || (data.images && data.images.length > 0 ? data.images[0].url : null) || data.url;

      await prisma.creation.update({
        where: { id: creation.id },
        data: {
          status: "completed",
          url: videoUrl
        }
      });
      console.log(`[FAL_WEBHOOK] Marked creation ${creation.id} as completed with URL: ${videoUrl}`);
    } else {
      await prisma.creation.update({
        where: { id: creation.id },
        data: {
          status: data.status ? String(data.status).toLowerCase() : "processing"
        }
      });
    }

    return NextResponse.json({ success: true });

  } catch (error) {
    console.error("[FAL_WEBHOOK_ERROR]", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
