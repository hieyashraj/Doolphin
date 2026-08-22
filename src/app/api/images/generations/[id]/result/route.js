import { NextResponse } from "next/server";
import { requireActivatedAccount } from "@/lib/access/authorization";
import { prisma } from "@/lib/prisma";
import { fetchAuthenticatedMuapiResult } from "@/lib/generation/muapiResult";
import { processAuthenticatedImageResult } from "@/lib/generation/imagePipeline";

export async function POST(_req, { params }) {
  try {
    const { appUser } = await requireActivatedAccount(); const { id } = await params;
    const job = await prisma.providerJob.findFirst({ where: { variant: { creation: { id, userId: appUser.id, generationType: "IMAGE_STUDIO" } } }, include: { variant: { include: { creation: true } } } });
    if (!job) return NextResponse.json({ code: "IMAGE_GENERATION_NOT_FOUND" }, { status: 404 });
    if (!job.providerRequestId) return NextResponse.json({ status: "QUEUED" });
    if (["COMPLETED", "FAILED", "TIMED_OUT", "CANCELLED", "QUARANTINED"].includes(job.variant.status)) {
      const artifactCount = job.variant.status === "COMPLETED"
        ? await prisma.generatedArtifact.count({ where: { creationVariantId: job.creationVariantId, type: "FINAL_IMAGE", validationStatus: "VALID" } })
        : 0;
      return NextResponse.json({
        status: job.variant.status,
        completed: job.variant.status === "COMPLETED",
        failed: job.variant.status !== "COMPLETED",
        artifactCount,
      });
    }
    const payload = await fetchAuthenticatedMuapiResult(job.providerRequestId);
    const result = await processAuthenticatedImageResult(job, payload);
    return NextResponse.json({ status: result.status || (result.completed ? "COMPLETED" : result.failed ? "FAILED" : "PROCESSING"), ...result });
  } catch (error) { console.error("[IMAGE_RESULT]", error); return NextResponse.json({ code: "IMAGE_RESULT_UNAVAILABLE" }, { status: 503 }); }
}
