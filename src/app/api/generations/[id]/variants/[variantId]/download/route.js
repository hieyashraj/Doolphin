import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { R2StorageService } from "@/lib/storage/r2StorageService";

export async function GET(_request, { params }) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id, variantId } = await params;
  const variant = await prisma.creationVariant.findFirst({ where: { id: variantId, creationId: id, status: "COMPLETED", creation: { userId: session.user.id } }, include: { artifacts: { where: { type: "FINAL_VIDEO", validationStatus: "VALID" } } } });
  if (!variant?.artifacts[0]) return NextResponse.json({ error: "Verified deliverable not found" }, { status: 404 });
  const artifact = variant.artifacts[0];
  const url = await R2StorageService.generateSignedUrl({ storageKey: artifact.storageKey, expiresInSeconds: 900, isDownload: true, filename: `doolphin_${id}_variant_${variant.variantIndex + 1}.mp4` });
  return NextResponse.json({ success: true, downloadUrl: url, expiresInSeconds: 900 });
}
