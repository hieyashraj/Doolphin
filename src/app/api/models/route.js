import { NextResponse } from "next/server";
import { requireActivatedAccount } from "@/lib/access/authorization";
import {
  CATALOGUE_REVISION,
  listCatalogueGroupedByFamily,
  listFeaturedModels,
} from "@/lib/models/videoModelCatalogue";

/**
 * The model catalogue the selector renders.
 *
 * Served from the server rather than bundled into the client so the list cannot
 * drift from the pricing artifact the billing guards read: one source, one
 * deploy. It also keeps the full document out of the client bundle.
 *
 * Authenticated because it exposes credit costs, which are commercial terms
 * rather than public marketing copy.
 */
export async function GET() {
  try {
    await requireActivatedAccount();
  } catch (error) {
    return NextResponse.json(
      { success: false, code: error.code || "UNAUTHORIZED", error: "Activation required" },
      { status: error.status || 401 },
    );
  }

  const groups = listCatalogueGroupedByFamily();
  const featured = listFeaturedModels();

  const all = groups.flatMap((group) => group.models);
  return NextResponse.json({
    success: true,
    revision: CATALOGUE_REVISION,
    featured,
    groups,
    counts: {
      total: all.length,
      selectable: all.filter((model) => model.selectable).length,
      // Split so the remaining work is visible: "readyToIntegrate" is ours to
      // write, "awaitingSchema" is blocked on the provider's request schema.
      readyToIntegrate: all.filter(
        (model) => model.pendingIntegration && model.payloadContractVerified,
      ).length,
      awaitingSchema: all.filter(
        (model) => model.pendingIntegration && !model.payloadContractVerified,
      ).length,
      comingSoon: all.filter((model) => model.comingSoon).length,
    },
  });
}
