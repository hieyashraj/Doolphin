import { z } from "zod";

export const StudioEnum = z.enum(["image-studio", "video-studio", "app-studio", "product-studio"]);
export const GenerationModeEnum = z.enum(["text-to-image", "image-to-image", "image-edit", "text-to-video", "image-to-video", "video-extend"]);

export const ProviderModelSpecSchema = z.object({
  providerModelId: z.string().min(1),
  endpoint: z.string().url(),
  category: z.string(),
  description: z.string().optional(),
  cost: z.object({
    amount: z.number().nonnegative(),
    currency: z.string().default("USD"),
    strategy: z.enum(["FLAT", "PER_SECOND", "INPUT_OUTPUT_DURATION", "RESOLUTION_TIER"])
  }),
  dynamicPricing: z.boolean().default(false),
  estimateEndpoint: z.string().url().nullable().optional(),
  inputSchema: z.record(z.string(), z.unknown()),
  outputSchema: z.record(z.string(), z.unknown()).optional()
});

export const DoolphinProductPolicySchema = z.object({
  id: z.string().min(1),
  displayName: z.string().min(1),
  studios: z.array(StudioEnum).min(1),
  generationMode: GenerationModeEnum,
  enabled: z.boolean().default(true),
  displayOrder: z.number().int().default(100),
  badge: z.string().optional(),
  description: z.string().optional(),
  legacyAliases: z.array(z.string()).default([])
});

export const DoolphinBusinessPolicySchema = z.object({
  targetContributionMarginBps: z.number().int().default(3000), // 30% margin floor
  variableInfraCostMicroUsd: z.bigint().default(0n),
  minimumCredits: z.number().int().default(1)
});

export const ModelDefinitionSchema = z.object({
  providerSpec: ProviderModelSpecSchema,
  productPolicy: DoolphinProductPolicySchema,
  businessPolicy: DoolphinBusinessPolicySchema,
  toProviderPayload: z.function()
});
