import test from "node:test";
import assert from "node:assert/strict";
import { claimProviderSubmission } from "../src/lib/generation/providerSubmissionLease.js";

function whereMatches(job, where) {
  if (where.id && job.id !== where.id) return false;
  if (where.status) {
    if (typeof where.status === "string" && job.status !== where.status) return false;
    if (where.status.in && !where.status.in.includes(job.status)) return false;
  }
  if (where.providerRequestId === null && job.providerRequestId !== null) return false;
  if (where.submissionLeaseId && job.submissionLeaseId !== where.submissionLeaseId) return false;
  if (where.submissionLeaseExpiresAt?.lte && !(job.submissionLeaseExpiresAt <= where.submissionLeaseExpiresAt.lte)) return false;
  return true;
}

function fakePrisma(job) {
  return {
    providerJob: {
      async updateMany({ where, data }) {
        if (!whereMatches(job, where)) return { count: 0 };
        for (const [key, value] of Object.entries(data)) {
          if (value && typeof value === "object" && "increment" in value) job[key] += value.increment;
          else job[key] = value;
        }
        return { count: 1 };
      },
      async findUnique({ where }) {
        if (where.id !== job.id) return null;
        return { ...job };
      },
    },
  };
}

test("concurrent durable submission claims permit exactly one paid submitter", async () => {
  const job = { id: "job_1", status: "PREPARED", providerRequestId: null, submissionLeaseId: null, submissionLeaseExpiresAt: null, submissionCount: 0 };
  const prisma = fakePrisma(job);
  const now = new Date("2026-08-13T00:00:00.000Z");
  const [first, second] = await Promise.all([
    claimProviderSubmission({ prisma, providerJobId: job.id, ownerId: "api:a", now }),
    claimProviderSubmission({ prisma, providerJobId: job.id, ownerId: "reconcile:b", now }),
  ]);
  assert.equal([first, second].filter((result) => result.claimed).length, 1);
  assert.equal(job.status, "SUBMITTING");
  assert.equal(job.submissionCount, 1);
  assert.equal(job.submissionLeaseId, first.claimed ? "api:a" : "reconcile:b");
});

test("an expired claimant becomes submission-unknown instead of being blindly re-submitted", async () => {
  const now = new Date("2026-08-13T00:02:00.000Z");
  const job = { id: "job_2", status: "SUBMITTING", providerRequestId: null, submissionLeaseId: "lost-worker", submissionLeaseExpiresAt: new Date("2026-08-13T00:01:00.000Z"), submissionCount: 1 };
  const result = await claimProviderSubmission({ prisma: fakePrisma(job), providerJobId: job.id, ownerId: "reconcile", now });
  assert.deepEqual({ claimed: result.claimed, state: result.state, expiredLease: result.expiredLease }, { claimed: false, state: "SUBMISSION_UNKNOWN", expiredLease: true });
  assert.equal(job.status, "SUBMISSION_UNKNOWN");
  assert.equal(job.submissionCount, 1);
});

test("known provider request ids can never be claimed for another provider POST", async () => {
  const job = { id: "job_3", status: "QUEUED", providerRequestId: "mu_123", submissionLeaseId: null, submissionLeaseExpiresAt: null, submissionCount: 1 };
  const result = await claimProviderSubmission({ prisma: fakePrisma(job), providerJobId: job.id, ownerId: "late-worker" });
  assert.equal(result.claimed, false);
  assert.equal(result.state, "ALREADY_SUBMITTED");
  assert.equal(job.submissionCount, 1);
});
