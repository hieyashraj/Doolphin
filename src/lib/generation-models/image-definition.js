import { defineGenerationModel } from "./types.js";

export function defineImageModel(definition) {
  const deployments = definition.pocStatus === "POC_PASS"
    ? { staging: "STAGING_ENABLED", production: "DISABLED" }
    : { staging: "DISABLED_PENDING_STAGING_POC", production: "DISABLED" };
  return defineGenerationModel({
    provider: "MUAPI",
    mediaType: "IMAGE",
    settlementMode: "ATOMIC_JOB",
    deployments,
    qaProfile: { requireHttpsOutput: true, requireImageDecode: true, requireMimeMatch: true, requireDimensions: true, finalImageRequired: true, derivativeFailureIsNonTerminal: true },
    ...definition,
  });
}
