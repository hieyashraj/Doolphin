import { defineGenerationModel } from "./types.js";

export function defineImageModel(definition) {
  return defineGenerationModel({
    provider: "MUAPI",
    mediaType: "IMAGE",
    settlementMode: "ATOMIC_JOB",
    deployments: { staging: "DISABLED_PENDING_STAGING_POC", production: "DISABLED" },
    qaProfile: { requireHttpsOutput: true, requireImageDecode: true, requireMimeMatch: true, requireDimensions: true, finalImageRequired: true, derivativeFailureIsNonTerminal: true },
    ...definition,
  });
}
