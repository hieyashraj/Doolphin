import { NextResponse } from "next/server";
import { getMockSession as getServerSession } from "@/lib/getMockSession";
import { saveMediaBuffer } from "@/lib/storage";

export async function POST(req) {
  try {
    const session = await getServerSession();

    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const formData = await req.formData();
    const file = formData.get("file");

    if (!file) {
      return NextResponse.json({ error: "No file provided" }, { status: 400 });
    }

    // Validate mime type
    const mimeType = file.type || "image/png";
    if (!mimeType.startsWith("image/") && !mimeType.startsWith("video/") && !mimeType.startsWith("audio/")) {
      return NextResponse.json({ error: "Unsupported media file type" }, { status: 400 });
    }

    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    if (buffer.length === 0) {
      return NextResponse.json({ error: "File payload is empty" }, { status: 400 });
    }

    const ext = file.name ? file.name.split('.').pop() : 'png';
    const filename = `ref_${Date.now()}_${Math.random().toString(36).substring(2, 7)}.${ext}`;

    // Save to durable storage manager
    const localUrl = await saveMediaBuffer(buffer, filename, "references");

    return NextResponse.json({
      success: true,
      url: localUrl
    });

  } catch (error) {
    console.error("[UPLOAD_ERROR]", error);
    return NextResponse.json({ error: error.message || "Upload Failed" }, { status: 500 });
  }
}
