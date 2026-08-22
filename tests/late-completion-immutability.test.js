import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const imagePipelineSource = fs.readFileSync(new URL("../src/lib/generation/imagePipeline.js", import.meta.url), "utf8");
const reconcileSource = fs.readFileSync(new URL("../src/app/api/internal/reconcile/route.js", import.meta.url), "utf8");

test("imagePipeline enforces TERMINAL_VARIANT_STATUSES guard to ignore late provider completions", () => {
  assert.match(imagePipelineSource, /const TERMINAL_VARIANT_STATUSES = new Set\(\["COMPLETED", "FAILED", "TIMED_OUT", "CANCELLED", "QUARANTINED"\]\)/);
  assert.match(imagePipelineSource, /if \(TERMINAL_VARIANT_STATUSES\.has\(job\.variant\?\.status\)\)/);
  assert.match(imagePipelineSource, /return \{ ignored: true, reason: "VARIANT_ALREADY_TERMINAL", status: job\.variant\.status \}/);
  assert.match(imagePipelineSource, /if \(TERMINAL_VARIANT_STATUSES\.has\(job\.variant\?\.status\)\) return;/);
});

test("reconciliation activeJobs query filters out jobs whose variants are already in a terminal state", () => {
  assert.match(reconcileSource, /status: \{ in: \["QUEUED", "PROCESSING"\] \}/);
  assert.match(reconcileSource, /variant: \{ is: \{ \.\.\.reconciliationEligibleVariantWhere\(\), status: \{ in: \["QUEUED", "PROCESSING"\] \} \} \}/);
});

test("workflow timeout closes every unresolved ProviderJob state and clears submission leases", () => {
  assert.match(reconcileSource, /prisma\.providerJob\.updateMany\(\{ where: \{ creationVariantId: variant\.id, status: \{ in: \["PREPARED", "SUBMITTING", "SUBMISSION_UNKNOWN", "QUEUED", "PROCESSING"\] \} \}, data: \{ status: "TIMED_OUT"/);
  assert.match(reconcileSource, /safeError: "Workflow timed out before completion\.", \.\.\.clearSubmissionLease\(\)/);
});
