import { validateModelPlatformPreparedQuoteForDispatch } from "./validateDispatch.js";

function parseJsonObject(value, label) {
  try {
    const parsed = typeof value === "string" ? JSON.parse(value) : value;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error();
    return parsed;
  } catch {
    throw new Error(`${label} is missing or invalid`);
  }
}

function assertEqual(actual, expected, label) {
  if (!actual || actual !== expected) throw new Error(`IMMUTABLE_DISPATCH_BINDING_MISMATCH: ${label}`);
}

export function resolveImmutableRecoveryDispatch({ outboxPayload, job, quote, now = new Date() } = {}) {
  const outbox = parseJsonObject(outboxPayload, "Outbox payload");
  if (!job || outbox.providerJobId !== job.id) throw new Error("IMMUTABLE_DISPATCH_BINDING_MISMATCH: providerJobId");
  if (!quote || (outbox.quoteId && outbox.quoteId !== quote.id)) throw new Error("IMMUTABLE_DISPATCH_BINDING_MISMATCH: quoteId");
  if (job.variant?.creation?.quoteId && job.variant.creation.quoteId !== quote.id) throw new Error("IMMUTABLE_DISPATCH_BINDING_MISMATCH: creation quoteId");

  const request = parseJsonObject(quote.requestSnapshot, "Preflight request snapshot");
  const routingSnapshot = parseJsonObject(job.routingSnapshot, "Provider job routing snapshot");
  const capabilitySnapshot = parseJsonObject(job.capabilitySnapshot, "Provider job capability snapshot");
  const validated = validateModelPlatformPreparedQuoteForDispatch({ quote, request, routingSnapshot, now });

  assertEqual(job.inputFingerprint, validated.providerPayloadHash, "payload fingerprint");
  assertEqual(job.endpoint, validated.providerEndpoint, "provider endpoint");
  assertEqual(job.registryRevision, validated.providerSpecHash, "registry revision");
  assertEqual(job.pricingRevision, validated.pricingRevisionId, "pricing revision");
  assertEqual(job.adapterVersion, validated.adapterRevision, "adapter revision");
  assertEqual(capabilitySnapshot.capabilityRevision, validated.capabilityRevision, "capability revision");
  if (capabilitySnapshot.adapterRevision) {
    assertEqual(capabilitySnapshot.adapterRevision, validated.adapterRevision, "capability adapter revision");
  }

  const endpoint = new URL(validated.providerEndpoint);
  if (routingSnapshot.webhookUrl) endpoint.searchParams.set("webhook", routingSnapshot.webhookUrl);

  return {
    providerPayloadJson: validated.providerPayloadJson,
    providerPayloadHash: validated.providerPayloadHash,
    dispatchUrl: endpoint.toString(),
  };
}
