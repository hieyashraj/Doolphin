import { prisma } from "../prisma.js";
import { AppError, ERROR_CODES } from "../errors.js";

/**
 * CircuitBreaker and Budget Management Service.
 * Section 5.23 & 5.24 Compliance.
 */

export class CircuitBreakerService {
  static async checkState(provider, internalModelId = null) {
    const record = await prisma.circuitBreakerState.findUnique({
      where: {
        provider_internalModelId: {
          provider,
          internalModelId: internalModelId || "",
        },
      },
    });

    if (record && record.state === "OPEN") {
      throw new AppError(
        ERROR_CODES.CIRCUIT_BREAKER_OPEN,
        `Circuit breaker is OPEN for provider ${provider}. Requests are currently blocked to prevent repeated failures.`
      );
    }
    return true;
  }

  static async recordFailure(provider, internalModelId = null, errorCode = null) {
    const key = { provider, internalModelId: internalModelId || "" };
    const record = await prisma.circuitBreakerState.findUnique({ where: { provider_internalModelId: key } });

    const failureCount = (record?.failureCount || 0) + 1;
    const isNowOpen = failureCount >= 3;

    await prisma.circuitBreakerState.upsert({
      where: { provider_internalModelId: key },
      create: {
        provider,
        internalModelId: internalModelId || "",
        state: isNowOpen ? "OPEN" : "CLOSED",
        failureCount: 1,
        openedAt: isNowOpen ? new Date() : null,
        lastFailureCode: errorCode,
      },
      update: {
        failureCount,
        state: isNowOpen ? "OPEN" : "CLOSED",
        openedAt: isNowOpen ? new Date() : record?.openedAt,
        lastFailureCode: errorCode,
      },
    });
  }

  static async recordSuccess(provider, internalModelId = null) {
    const key = { provider, internalModelId: internalModelId || "" };
    await prisma.circuitBreakerState.upsert({
      where: { provider_internalModelId: key },
      create: {
        provider,
        internalModelId: internalModelId || "",
        state: "CLOSED",
        failureCount: 0,
      },
      update: {
        failureCount: 0,
        state: "CLOSED",
      },
    });
  }
}
