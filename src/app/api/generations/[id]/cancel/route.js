import { NextResponse } from "next/server";
import { requireActivatedAccount } from "@/lib/access/authorization";
import { prisma } from "@/lib/prisma";
import { CreditEscrowService } from "@/lib/billing/CreditEscrowService";

export async function POST(_request, { params }) {
  let appUser; try { ({ appUser } = await requireActivatedAccount()); } catch (error) { return NextResponse.json({ error: error.code || "UNAUTHENTICATED" }, { status: error.status || 401 }); }
  const { id } = await params;
  const creation = await prisma.creation.findFirst({ where: { id, userId: appUser.id }, include: { variants: { include: { providerJobs: true } } } });
  if (!creation) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const submitted = creation.variants.some((variant) => variant.providerJobs.some((job) => job.providerRequestId || ["SUBMITTING", "SUBMISSION_UNKNOWN", "QUEUED", "PROCESSING", "SUCCEEDED"].includes(job.status)));
  if (submitted) return NextResponse.json({ error: "This request has already reached a paid provider and cannot be safely cancelled without provider-side cancellation support" }, { status: 409 });
  for (const variant of creation.variants) await CreditEscrowService.releaseVariantReservations(variant.id, "USER_CANCELLED_BEFORE_SUBMISSION");
  await prisma.$transaction([
    prisma.creationVariant.updateMany({ where: { creationId: id }, data: { status: "CANCELLED", cancelledAt: new Date(), currentStage: "cancelled" } }),
    prisma.providerJob.updateMany({ where: { variant: { creationId: id }, status: "PREPARED" }, data: { status: "CANCELLED", completedAt: new Date() } }),
    prisma.queueOutbox.updateMany({ where: { aggregateId: { in: creation.variants.map((variant) => variant.id) }, status: "PENDING" }, data: { status: "DEAD_LETTER", lastError: "Cancelled by user before submission" } }),
    prisma.creation.update({ where: { id }, data: { status: "CANCELLED", cancelledAt: new Date(), currentStage: "cancelled" } })
  ]);
  return NextResponse.json({ success: true, creationId: id, status: "CANCELLED" });
}
