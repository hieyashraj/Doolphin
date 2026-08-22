import { NextResponse } from "next/server";
import { requireActivatedAccount } from "@/lib/access/authorization";
import { listGeneratedModelsByStudio, toClientModel, CATALOG_REVISION } from "@/lib/models/videoModelFactory";
import { getGenerationModel } from "@/lib/generation/modelRegistry";
import { restrictedFamiliesForPlan, isModelAllowedForPlan } from "@/lib/entitlements/modelAccess";

/**
 * The model bench for a studio.
 *
 * The Video Studio previously rendered a hardcoded array of seven placeholder
 * names ("grok-video", "veo-3-1", "fal-kling-3-std", …) that mapped to no
 * registered model, so choosing one could not produce a working generation. This
 * serves the real, registered, priceable bench instead.
 *
 * Plan gating is applied HERE as well as at preflight/submission, so a model the
 * plan may not use is never even offered.
 */
export async function GET(request) {
  let planCode;
  try {
    ({ entitlement: { planCode } } = await requireActivatedAccount());
  } catch (error) {
    return NextResponse.json({ error: error.code || "UNAUTHENTICATED" }, { status: error.status || 401 });
  }

  const studio = new URL(request.url).searchParams.get("studio") || "video-studio";
  const allowed = ["video-studio", "product-studio", "app-studio", "image-studio"];
  if (!allowed.includes(studio)) {
    return NextResponse.json({ error: "UNKNOWN_STUDIO", allowed }, { status: 400 });
  }

  const models = listGeneratedModelsByStudio(studio)
    .filter((definition) =>
      isModelAllowedForPlan({
        planCode,
        providerModelId: definition.providerSpec.providerModelId,
        modelFamily: definition.productPolicy.family,
      })
    )
    .map((definition) => {
      const clientModel = toClientModel(definition);
      const model = getGenerationModel(clientModel.id);
      return {
        ...clientModel,
        resolutions: model?.resolutions || ["720p"],
        aspectRatios: model?.aspectRatios || ["9:16", "16:9"],
        minDuration: model?.minDuration ?? 4,
        maxDuration: model?.maxDuration ?? 10,
        maxImages: model?.maxImages ?? 1,
        maxVideoReferences: model?.maxVideoReferences ?? 0,
      };
    });

  return NextResponse.json({
    studio,
    catalogRevision: CATALOG_REVISION,
    restrictedFamilies: restrictedFamiliesForPlan(planCode),
    count: models.length,
    models,
  });
}
