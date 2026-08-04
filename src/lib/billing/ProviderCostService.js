import { prisma } from "../prisma.js";

/**
 * Provider Cost Ledger Service.
 * Section 5.14 & 21 Compliance: Tracking external micro-USD provider costs.
 */

export class ProviderCostService {
  static async recordEstimatedCost({
    workspaceId,
    creationId,
    creationVariantId,
    providerJobId,
    provider,
    stageName,
    estimatedCostMinMicroUsd,
    estimatedCostMaxMicroUsd,
    pricingRevision = "1.0.0",
    inputFingerprint,
  }) {
    return await prisma.providerCostLedger.create({
      data: {
        workspaceId,
        creationId,
        creationVariantId,
        providerJobId,
        provider,
        stageName,
        estimatedCostMinMicroUsd,
        estimatedCostMaxMicroUsd,
        providerBillingStatus: "ESTIMATED",
        pricingRevision,
        inputFingerprint,
      },
    });
  }

  static async reconcileActualCost({
    providerCostLedgerId,
    actualCostMicroUsd,
    providerRequestId,
    billableUnits = 1.0,
    billingStatus = "BILLED",
  }) {
    return await prisma.providerCostLedger.update({
      where: { id: providerCostLedgerId },
      data: {
        actualCostMicroUsd,
        providerRequestId,
        billableUnits,
        providerBillingStatus: billingStatus,
        reconciledAt: new Date(),
      },
    });
  }
}
