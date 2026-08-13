import crypto from "crypto";

// A lease must cover the provider HTTP timeout with room for DB finalization.
// When it expires we deliberately move to SUBMISSION_UNKNOWN, never back to
// PREPARED: the original request may have reached a billable provider.
export const PROVIDER_SUBMISSION_LEASE_MS = 90_000;

export function newSubmissionOwner(prefix = "worker") {
  return `${prefix}:${crypto.randomUUID()}`;
}

/**
 * Atomically takes the one and only paid-provider submission lease.
 *
 * PREPARED -> SUBMITTING is the only automatic submission transition.  A
 * crashed/slow claimant eventually becomes SUBMISSION_UNKNOWN, which is
 * recoverable by provider-status lookup but is never blindly re-submitted.
 */
export async function claimProviderSubmission({ prisma, providerJobId, ownerId = newSubmissionOwner(), now = new Date(), leaseMs = PROVIDER_SUBMISSION_LEASE_MS }) {
  const leaseExpiresAt = new Date(now.getTime() + leaseMs);
  const claimed = await prisma.providerJob.updateMany({
    where: { id: providerJobId, status: "PREPARED", providerRequestId: null },
    data: {
      status: "SUBMITTING",
      submissionLeaseId: ownerId,
      submissionClaimedAt: now,
      submissionLeaseExpiresAt: leaseExpiresAt,
      submissionCount: { increment: 1 },
    },
  });
  if (claimed.count === 1) return { claimed: true, ownerId, leaseExpiresAt, state: "SUBMITTING" };

  const job = await prisma.providerJob.findUnique({
    where: { id: providerJobId },
    select: { status: true, providerRequestId: true, submissionLeaseId: true, submissionLeaseExpiresAt: true },
  });
  if (!job) return { claimed: false, state: "MISSING" };
  if (job.providerRequestId || ["QUEUED", "PROCESSING", "SUCCEEDED"].includes(job.status)) return { claimed: false, state: "ALREADY_SUBMITTED", job };

  if (job.status === "SUBMITTING" && job.submissionLeaseExpiresAt && job.submissionLeaseExpiresAt <= now) {
    // The lost worker may have sent the POST. Preserve its owner for audit,
    // but make the ambiguity explicit and unblock reconciliation.
    const expired = await prisma.providerJob.updateMany({
      where: { id: providerJobId, status: "SUBMITTING", submissionLeaseId: job.submissionLeaseId, submissionLeaseExpiresAt: { lte: now } },
      data: { status: "SUBMISSION_UNKNOWN", errorCode: "SUBMISSION_LEASE_EXPIRED", safeError: "Provider submission outcome requires reconciliation" },
    });
    if (expired.count === 1) return { claimed: false, state: "SUBMISSION_UNKNOWN", expiredLease: true };
  }
  return { claimed: false, state: job.status === "SUBMITTING" ? "CLAIMED_BY_OTHER" : job.status, job };
}

/** A claimant can record a confirmed provider id even if its lease just expired. */
export function submissionOwnerWhere(providerJobId, ownerId) {
  return {
    id: providerJobId,
    submissionLeaseId: ownerId,
    status: { in: ["SUBMITTING", "SUBMISSION_UNKNOWN"] },
  };
}

export function clearSubmissionLease() {
  return { submissionLeaseId: null, submissionLeaseExpiresAt: null };
}
