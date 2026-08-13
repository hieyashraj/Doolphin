import test from "node:test";
import assert from "node:assert/strict";
import { claimProviderSubmission } from "../src/lib/generation/providerSubmissionLease.js";

// This is deliberately a dry-run persistence model.  It represents the
// durable records and deterministic object key used by the real route and
// quality pipeline without calling a provider, R2, or a database.  Each
// "crash" throws after the durable boundary named by the test; calling replay
// then exercises the recovery contract from the surviving records.
function createDryRun() {
  const state = {
    quote: null, reservations: [], job: { id: "job_1", status: "PREPARED", providerRequestId: null, submissionLeaseId: null, submissionLeaseExpiresAt: null, submissionCount: 0 },
    variant: { id: "variant_1", status: "QUEUED", finalizationLeaseId: null },
    providerPosts: 0, providerResultReads: 0, outputDownloads: 0, r2Writes: 0,
    artifacts: [], settlements: [], webhookCount: 0, now: new Date("2026-08-13T00:00:00.000Z"),
  };
  const finalKey = "final/ws_1/creation_1/variant_0.mp4";

  const prisma = {
    providerJob: {
      async updateMany({ where, data }) {
        const job = state.job;
        const match = job.id === where.id
          && (!where.status || (typeof where.status === "string" ? job.status === where.status : where.status.in.includes(job.status)))
          && !(where.providerRequestId === null && job.providerRequestId !== null)
          && (!where.submissionLeaseId || job.submissionLeaseId === where.submissionLeaseId)
          && (!where.submissionLeaseExpiresAt?.lte || job.submissionLeaseExpiresAt <= where.submissionLeaseExpiresAt.lte);
        if (!match) return { count: 0 };
        for (const [key, value] of Object.entries(data)) job[key] = value?.increment ? (job[key] || 0) + value.increment : value;
        return { count: 1 };
      },
      async findUnique() { return { ...state.job }; },
    },
  };

  function quoteAndReserve() {
    if (!state.quote) state.quote = { id: "quote_1", credits: 180, immutableRequest: "request_fingerprint_1" };
    if (!state.reservations.length) state.reservations.push({ id: "reservation_1", amount: 180, status: "RESERVED" });
  }

  async function submit({ crashAt } = {}) {
    quoteAndReserve();
    const claim = await claimProviderSubmission({ prisma, providerJobId: state.job.id, ownerId: "api:owner", now: state.now });
    if (!claim.claimed) return claim.state;
    if (crashAt === "submission_claim") throw new Error("CRASH: submission_claim");
    // The mocked provider is called only by a lease owner, and its accepted id
    // is persisted before any later delivery work begins.
    state.providerPosts += 1;
    state.job.providerRequestId = "mock_request_1";
    state.job.status = "QUEUED";
    state.job.submissionLeaseId = null;
    state.variant.status = "PROCESSING";
    if (crashAt === "provider_acceptance") throw new Error("CRASH: provider_acceptance");
    return "SUBMITTED";
  }

  function settleOnce() {
    const reservation = state.reservations[0];
    if (reservation.status === "RESERVED") {
      reservation.status = "COMMITTED";
      state.settlements.push({ reservationId: reservation.id, kind: "COMMIT" });
    }
  }

  function failNoDelivery() {
    for (const reservation of state.reservations) {
      if (reservation.status === "RESERVED") {
        reservation.status = "RELEASED";
        state.settlements.push({ reservationId: reservation.id, kind: "RELEASE" });
      }
    }
    state.variant.status = "FAILED";
  }

  async function finalize({ crashAt } = {}) {
    if (state.variant.status === "COMPLETED") return "ALREADY_COMPLETED";
    if (!state.job.providerRequestId) return "WAITING_FOR_PROVIDER_ID";
    state.providerResultReads += 1;
    state.outputDownloads += 1;
    if (crashAt === "output_download") throw new Error("CRASH: output_download");
    let artifact = state.artifacts.find((item) => item.storageKey === finalKey);
    if (!artifact) {
      state.r2Writes += 1; // deterministic overwrite-safe final object key
      state.r2ObjectExists = true;
      if (crashAt === "final_r2") throw new Error("CRASH: final_r2");
      artifact = { id: "artifact_1", storageKey: finalKey };
      state.artifacts.push(artifact);
    }
    if (crashAt === "artifact_db_write") throw new Error("CRASH: artifact_db_write");
    settleOnce();
    if (crashAt === "credit_settlement") throw new Error("CRASH: credit_settlement");
    state.variant.status = "COMPLETED";
    state.variant.finalArtifactId = artifact.id;
    return "COMPLETED";
  }

  async function webhook({ crashAt } = {}) {
    state.webhookCount += 1;
    return finalize({ crashAt });
  }

  async function reconcile() {
    // A known request id is polled/finalized, never re-submitted.  An expired
    // claim is ambiguous and therefore also never triggers a second POST.
    if (state.job.status === "SUBMITTING") {
      state.now = new Date(state.now.getTime() + 91_000);
      await claimProviderSubmission({ prisma, providerJobId: state.job.id, ownerId: "reconcile:owner", now: state.now });
      return state.job.status;
    }
    if (state.job.providerRequestId) return finalize();
    return "WAITING";
  }
  return { state, finalKey, quoteAndReserve, submit, webhook, reconcile, failNoDelivery };
}

function assertExactlyOnce(run) {
  assert.equal(run.state.providerPosts, 1, "one paid provider POST");
  assert.equal(run.state.artifacts.length, 1, "one final artifact row");
  assert.equal(run.state.artifacts[0].storageKey, run.finalKey, "deterministic final key");
  assert.deepEqual(run.state.settlements, [{ reservationId: "reservation_1", kind: "COMMIT" }], "one settlement");
  assert.equal(run.state.reservations[0].status, "COMMITTED");
  assert.equal(run.state.variant.status, "COMPLETED");
}

test("mocked end-to-end generation has one quote, reservation, provider id, artifact, and settlement across duplicate webhook/reconcile", async () => {
  const run = createDryRun();
  assert.equal(await run.submit(), "SUBMITTED");
  await Promise.all([run.webhook(), run.webhook(), run.reconcile()]);
  assert.equal(run.state.quote.id, "quote_1");
  assert.equal(run.state.reservations.length, 1);
  assert.equal(run.state.job.providerRequestId, "mock_request_1");
  assertExactlyOnce(run);
});

test("crash after submission claim becomes submission-unknown without a second paid provider POST", async () => {
  const run = createDryRun();
  await assert.rejects(run.submit({ crashAt: "submission_claim" }), /CRASH/);
  assert.equal(await run.reconcile(), "SUBMISSION_UNKNOWN");
  assert.equal(run.state.providerPosts, 0);
  assert.equal(run.state.job.submissionCount, 1);
  assert.equal(run.state.reservations[0].status, "RESERVED", "requires authenticated provider lookup or timeout policy");
});

for (const boundary of ["provider_acceptance", "output_download", "final_r2", "artifact_db_write", "credit_settlement"]) {
  test(`mocked replay survives crash after ${boundary} without duplicate spend, artifact, or charge`, async () => {
    const run = createDryRun();
    if (boundary === "provider_acceptance") {
      await assert.rejects(run.submit({ crashAt: boundary }), /CRASH/);
    } else {
      await run.submit();
      await assert.rejects(run.webhook({ crashAt: boundary }), /CRASH/);
    }
    await run.reconcile();
    await run.webhook();
    assertExactlyOnce(run);
  });
}

test("mocked provider or QA no-delivery failure releases the only reservation exactly once", () => {
  const run = createDryRun();
  run.quoteAndReserve();
  run.failNoDelivery();
  run.failNoDelivery();
  assert.deepEqual(run.state.settlements, [{ reservationId: "reservation_1", kind: "RELEASE" }]);
  assert.equal(run.state.reservations[0].status, "RELEASED");
  assert.equal(run.state.variant.status, "FAILED");
});
