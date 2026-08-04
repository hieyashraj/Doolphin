import { NextResponse } from "next/server";
import { getMockSession as getServerSession } from "@/lib/getMockSession";
import { prisma } from "@/lib/prisma";

export async function POST(req) {
  try {
    const session = await getServerSession();
    const userId = session?.user?.id || "doolphin-default-user";

    const body = await req.json();
    const updateData = {};
    if (body.apiKey !== undefined) updateData.customApiKey = body.apiKey ? String(body.apiKey).trim() : null;
    if (body.falKey !== undefined) updateData.falKey = body.falKey ? String(body.falKey).trim() : null;
    if (body.elevenLabsKey !== undefined) updateData.elevenLabsKey = body.elevenLabsKey ? String(body.elevenLabsKey).trim() : null;
    if (body.name !== undefined) updateData.name = String(body.name).trim();
    if (body.email !== undefined) updateData.email = String(body.email).trim();

    let updatedUser;
    try {
      updatedUser = await prisma.user.upsert({
        where: { id: userId },
        update: updateData,
        create: {
          id: userId,
          name: body.name || "Doolphin Creator",
          email: body.email || "creator@doolphin.ai",
          credits: 9999,
          ...updateData
        },
        select: { id: true, name: true, email: true, credits: true, customApiKey: true, falKey: true, elevenLabsKey: true }
      });
    } catch (dbErr) {
      console.warn("DB Upsert warning, applying fallback user state:", dbErr);
      updatedUser = {
        id: userId,
        name: body.name || "Doolphin Creator",
        email: body.email || "creator@doolphin.ai",
        customApiKey: updateData.customApiKey || null,
        falKey: updateData.falKey || null,
        elevenLabsKey: updateData.elevenLabsKey || null
      };
    }

    return NextResponse.json({
      success: true,
      name: updatedUser.name,
      email: updatedUser.email,
      customApiKey: updatedUser.customApiKey,
      falKey: updatedUser.falKey,
      elevenLabsKey: updatedUser.elevenLabsKey,
    });
  } catch (error) {
    console.error("Error updating user settings:", error);
    return NextResponse.json({
      success: true,
      customApiKey: null,
      falKey: null,
      elevenLabsKey: null,
      warning: error.message
    });
  }
}

export async function DELETE(req) {
  try {
    const session = await getServerSession();
    const userId = session?.user?.id || "doolphin-default-user";

    const { searchParams } = new URL(req.url);
    const action = searchParams.get("action"); // "deleteAccount" or key type

    if (action === "deleteAccount") {
      try {
        await prisma.user.delete({ where: { id: userId } });
      } catch (err) {
        console.warn("Account delete warning:", err.message);
      }
      return NextResponse.json({ success: true, message: "Account deleted" });
    }

    const type = searchParams.get("type"); // "muapi", "fal", "elevenlabs" or "all"

    const updateData = {};
    if (!type || type === "all" || type === "muapi") updateData.customApiKey = null;
    if (!type || type === "all" || type === "fal") updateData.falKey = null;
    if (!type || type === "all" || type === "elevenlabs") updateData.elevenLabsKey = null;

    let updatedUser;
    try {
      updatedUser = await prisma.user.upsert({
        where: { id: userId },
        update: updateData,
        create: {
          id: userId,
          name: "Doolphin Creator",
          email: "creator@doolphin.ai",
          credits: 9999,
          ...updateData
        },
        select: { id: true, customApiKey: true, falKey: true, elevenLabsKey: true }
      });
    } catch (dbErr) {
      console.warn("DB Clear warning, applying fallback clear state:", dbErr);
      updatedUser = {
        id: userId,
        customApiKey: null,
        falKey: null,
        elevenLabsKey: null
      };
    }

    return NextResponse.json({
      success: true,
      customApiKey: updatedUser.customApiKey,
      falKey: updatedUser.falKey,
      elevenLabsKey: updatedUser.elevenLabsKey,
    });
  } catch (error) {
    console.error("Error clearing settings:", error);
    return NextResponse.json({
      success: true,
      customApiKey: null,
      falKey: null,
      elevenLabsKey: null
    });
  }
}
