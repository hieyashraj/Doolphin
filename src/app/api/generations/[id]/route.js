import { NextResponse } from "next/server";
import { requireActivatedAccount } from "@/lib/access/authorization";
import { prisma } from "@/lib/prisma";

export async function GET(_request, { params }) {
  let appUser; try { ({ appUser } = await requireActivatedAccount()); } catch (error) { return NextResponse.json({ error: error.code || "UNAUTHENTICATED" }, { status: error.status || 401 }); }
  const { id } = await params;
  const creation = await prisma.creation.findFirst({ where: { id, userId: appUser.id }, include: { variants: { orderBy: { variantIndex: "asc" }, include: { workflowSnapshot: true } }, assets: true } });
  if (!creation) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({
    id: creation.id,
    generationType: creation.generationType,
    status: creation.status,
    currentStage: creation.currentStage,
    script: creation.spokenScript,
    instructions: creation.additionalInstructions,
    modelId: creation.modelId,
    settings: { durationSeconds: creation.duration, resolution: creation.resolution, aspectRatio: creation.aspectRatio, outputCount: creation.numberOfVideos },
    assets: creation.assets.map((asset) => ({ id: asset.id, role: asset.role, mediaType: asset.mediaType, originalFileName: asset.originalFileName, validationStatus: asset.validationStatus, metadata: asset.validationMetadata ? JSON.parse(asset.validationMetadata) : null })),
    variants: creation.variants.map((variant) => ({ id: variant.id, index: variant.variantIndex, status: variant.status, stage: variant.currentStage, progress: variant.progressValue, errorCode: variant.errorCode, error: variant.safeError, workflow: variant.workflowSnapshot ? { assetRoleMapping: JSON.parse(variant.workflowSnapshot.assetRoleMapping), speechPlan: JSON.parse(variant.workflowSnapshot.speechPlan), compositionPlan: JSON.parse(variant.workflowSnapshot.compositionPlan) } : null }))
  });
}
