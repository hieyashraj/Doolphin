import { prisma } from "../prisma.js";
import { PLANS } from "../entitlements/pricing.js";
import { materializeAnnualGrantSchedule } from "../entitlements/grants.js";
import { grantCreditsIdempotently, IdempotencyIntegrityConflict } from "../entitlements/ledger.js";
import { getPolarConfig } from "./polarEnvironment.js";

export function resolvePlanFromPolarProduct(productId, metadataPlanCode) {
  // Invariant: missing product_id -> zero grant (financial fail-closed)
  if (!productId) {
    return null;
  }

  let products = {};
  try {
    const config = getPolarConfig();
    products = config.products || {};
  } catch {
    products = {
      EXPLORER: process.env.POLAR_SANDBOX_PRODUCT_EXPLORER || process.env.POLAR_PRODUCT_EXPLORER,
      STARTER_MONTHLY: process.env.POLAR_SANDBOX_PRODUCT_STARTER_MONTHLY || process.env.POLAR_PRODUCT_STARTER_MONTHLY,
      STARTER_ANNUAL: process.env.POLAR_SANDBOX_PRODUCT_STARTER_ANNUAL || process.env.POLAR_PRODUCT_STARTER_ANNUAL,
      GROWTH_MONTHLY: process.env.POLAR_SANDBOX_PRODUCT_GROWTH_MONTHLY || process.env.POLAR_PRODUCT_GROWTH_MONTHLY,
      GROWTH_ANNUAL: process.env.POLAR_SANDBOX_PRODUCT_GROWTH_ANNUAL || process.env.POLAR_PRODUCT_GROWTH_ANNUAL,
      AGENCY_MONTHLY: process.env.POLAR_SANDBOX_PRODUCT_AGENCY_MONTHLY || process.env.POLAR_PRODUCT_AGENCY_MONTHLY,
      AGENCY_ANNUAL: process.env.POLAR_SANDBOX_PRODUCT_AGENCY_ANNUAL || process.env.POLAR_PRODUCT_AGENCY_ANNUAL,
    };
  }

  // Exact matching against server-owned product ID catalog ONLY.
  // Metadata planCode is NEVER used as a financial authority.
  for (const [code, id] of Object.entries(products)) {
    if (id && id === productId) {
      return code;
    }
  }

  return null; // Unknown product_id -> zero grant (financial fail-closed)
}

function grantReason(code) {
  if (code === "EXPLORER") return "EXPLORER_GRANT";
  if (code.startsWith("STARTER")) return "STARTER_MONTHLY_GRANT";
  if (code.startsWith("GROWTH")) return "GROWTH_MONTHLY_GRANT";
  return "AGENCY_MONTHLY_GRANT";
}

export function extractWebhookIdentity(headers, eventPayload) {
  const getHeader = (key) => {
    if (!headers) return null;
    if (typeof headers.get === "function") return headers.get(key);
    return headers[key] || headers[key.toLowerCase()] || null;
  };

  const webhookId =
    getHeader("webhook-id") ||
    eventPayload.id ||
    eventPayload.event_id ||
    (eventPayload.data && eventPayload.data.id ? `msg_${eventPayload.data.id}` : null);

  return webhookId;
}

export function canonicalPayload(eventPayload, webhookId) {
  const data = eventPayload.data || {};
  const metadataPlanCode = data.metadata?.planCode || data.customer_metadata?.planCode || data.subscription?.metadata?.planCode;
  
  // Primary order authority: exact product_id matching only
  const productId = data.product_id || data.product?.id || null;
  const planCode = resolvePlanFromPolarProduct(productId, metadataPlanCode);

  const billingReason = data.billing_reason || (data.order && data.order.billing_reason) || null;
  const subscriptionId = data.subscription_id || data.subscription?.id || (eventPayload.type.startsWith("subscription.") ? data.id : null);
  const customerId = data.customer_id || data.customer?.id || null;
  const orderId = data.order_id || (eventPayload.type.startsWith("order.") ? data.id : null);
  const supabaseUserId = data.metadata?.supabaseUserId || data.customer_metadata?.supabaseUserId || data.subscription?.metadata?.supabaseUserId;

  const currentPeriodStart = data.current_period_start || data.subscription?.current_period_start || data.starts_at;
  const currentPeriodEnd = data.current_period_end || data.subscription?.current_period_end || data.ends_at;

  return {
    webhookId,
    eventType: eventPayload.type,
    planCode,
    productId,
    billingReason,
    subscriptionId,
    orderId,
    customerId,
    supabaseUserId,
    currentPeriodStart: currentPeriodStart ? new Date(currentPeriodStart) : null,
    currentPeriodEnd: currentPeriodEnd ? new Date(currentPeriodEnd) : null,
    createdAt: data.created_at ? new Date(data.created_at) : new Date(),
    raw: data,
  };
}

async function getPrismaClient() {
  const { prisma: client } = await import("../prisma.js");
  return client;
}

function isPolarEventIdUniqueConstraint(error) {
  if (!error || error.code !== "P2002") return false;
  const target = error.meta?.target;
  const msg = error.message || "";

  if (Array.isArray(target)) {
    return target.length === 1 && target[0] === "polarEventId";
  }
  if (typeof target === "string") {
    return target === "polarEventId";
  }

  if (msg.includes("polarEventId")) {
    return true;
  }

  return false;
}

function isPayloadConsistent(persisted, operation) {
  if (!persisted || !persisted.payloadJson) return false;

  let storedPayload;
  try {
    storedPayload = JSON.parse(persisted.payloadJson);
  } catch {
    return false;
  }

  const storedOp = canonicalPayload(storedPayload, operation.webhookId);
  if (!storedOp) return false;

  return (
    storedOp.eventType === operation.eventType &&
    storedOp.orderId === operation.orderId &&
    storedOp.subscriptionId === operation.subscriptionId &&
    storedOp.customerId === operation.customerId &&
    storedOp.productId === operation.productId &&
    storedOp.billingReason === operation.billingReason &&
    storedOp.supabaseUserId === operation.supabaseUserId
  );
}

export async function processPolarBillingEvent(eventPayload, headers, db = null) {
  const activeDb = db || (await getPrismaClient());
  const webhookId = extractWebhookIdentity(headers, eventPayload);
  if (!webhookId) return { status: "IGNORED", reason: "Missing webhook message identity" };

  const operation = canonicalPayload(eventPayload, webhookId);

  try {
    // ATOMIC WEBHOOK DELIVERY TRANSACTION
    // Timeout of 15 seconds ensures multi-query transactions (e.g. annual schedule materialization)
    // do not abort on remote DB connection latency. Expiration rolls back the transaction atomically.
    return await activeDb.$transaction(async (tx) => {
      // 1. DEDUPLICATE WEBHOOK MESSAGE IDENTITY (BillingWebhookEvent.polarEventId)
      const priorEvent = await tx.billingWebhookEvent.findUnique({ where: { polarEventId: operation.webhookId } });
      if (priorEvent && priorEvent.processedAt !== null) {
        if (!isPayloadConsistent(priorEvent, operation)) {
          throw new IdempotencyIntegrityConflict("Webhook ID reuse with conflicting payload");
        }
        return { status: "ALREADY_PROCESSED", webhookId: operation.webhookId };
      }

      let eventRecord = priorEvent;
      if (!eventRecord) {
        eventRecord = await tx.billingWebhookEvent.create({
          data: {
            polarEventId: operation.webhookId,
            eventType: operation.eventType,
            payloadJson: JSON.stringify(eventPayload),
            processedAt: null,
          },
        });
      } else if (!isPayloadConsistent(eventRecord, operation)) {
        throw new IdempotencyIntegrityConflict("Webhook ID reuse with conflicting payload");
      }

      // 2. ROUTE BY EVENT TYPE (ONLY order.paid initiates credit grants)
      let result = { status: "PROCESSED_NO_GRANT", eventType: operation.eventType };

      if (operation.eventType === "order.paid") {
        result = await handleOrderPaid(operation, tx);
      } else if (operation.eventType.startsWith("subscription.")) {
        result = await handleSubscriptionLifecycle(operation, tx);
      } else if (operation.eventType === "order.refunded" || operation.eventType === "refund.created") {
        result = await handleOrderRefunded(operation, tx);
      }

      // Mark webhook delivery processed ONLY after all business mutations succeeded inside transaction
      await tx.billingWebhookEvent.update({
        where: { polarEventId: operation.webhookId },
        data: { processedAt: new Date() },
      });

      return result;
    }, { timeout: 15000 });
  } catch (error) {
    if (isPolarEventIdUniqueConstraint(error)) {
      const persisted = await activeDb.billingWebhookEvent.findUnique({
        where: { polarEventId: operation.webhookId },
      });
      if (persisted && persisted.processedAt !== null) {
        if (isPayloadConsistent(persisted, operation)) {
          return { status: "ALREADY_PROCESSED", webhookId: operation.webhookId };
        } else {
          throw new IdempotencyIntegrityConflict("Webhook ID reuse with conflicting payload");
        }
      }
    }
    throw error;
  }
}

async function handleOrderPaid(operation, tx) {
  const plan = PLANS[operation.planCode];
  if (!plan || !operation.orderId) {
    return { status: "IGNORED_UNRECOGNIZED_PRODUCT", reason: "Product/Plan not recognized" };
  }

  // A. ONE-TIME PURCHASE (EXPLORER ONLY)
  if (operation.billingReason === "purchase" || plan.interval === "ONE_TIME") {
    if (operation.planCode !== "EXPLORER") {
      return { status: "IGNORED_UNSUPPORTED_ONETIME_PRODUCT", reason: "Only Explorer is an approved one-time purchase" };
    }

    const user = await tx.user.findUnique({ where: { supabaseUserId: operation.supabaseUserId } });
    if (!user?.defaultWorkspaceId) throw new IdempotencyIntegrityConflict("Billing identity is not linked to a workspace");

    if (operation.customerId) {
      await tx.billingCustomer.upsert({
        where: { polarCustomerId: operation.customerId },
        update: { userId: user.id },
        create: { userId: user.id, polarCustomerId: operation.customerId },
      });
    }

    // Check Explorer eligibility identity
    const claimed = await tx.entitlement.findFirst({
      where: {
        planCode: "EXPLORER",
        OR: [
          { userId: user.id },
          { workspaceId: user.defaultWorkspaceId },
          ...(operation.customerId ? [{ polarCustomerId: operation.customerId }] : []),
        ],
      },
    });
    if (claimed) throw new IdempotencyIntegrityConflict("Explorer has already been claimed by an eligibility identity");

    const startsAt = operation.createdAt;
    const endsAt = new Date(Date.UTC(startsAt.getUTCFullYear() + 10, startsAt.getUTCMonth(), startsAt.getUTCDate()));

    const entitlement = await tx.entitlement.create({
      data: {
        userId: user.id,
        workspaceId: user.defaultWorkspaceId,
        planCode: operation.planCode,
        billingInterval: "ONE_TIME",
        polarCustomerId: operation.customerId,
        polarOrderId: operation.orderId,
        startsAt,
        endsAt,
        featuresJson: "[]",
      },
    });

    await tx.user.update({
      where: { id: user.id },
      data: {
        activationStatus: "ACTIVATED",
        subscriptionStatus: "NONE",
        explorerClaimedAt: startsAt,
        explorerOrderId: operation.orderId,
      },
    });

    const grant = await grantCreditsIdempotently(
      {
        workspaceId: user.defaultWorkspaceId,
        userId: user.id,
        amount: plan.credits,
        reason: grantReason(operation.planCode),
        sourceId: entitlement.id,
        idempotencyKey: `polar-order:${operation.orderId}`,
      },
      tx
    );

    return { ...grant, entitlement };
  }

  // B. INITIAL SUBSCRIPTION PURCHASE (billing_reason = subscription_create)
  if (operation.billingReason === "subscription_create") {
    const user = await tx.user.findUnique({ where: { supabaseUserId: operation.supabaseUserId } });
    if (!user?.defaultWorkspaceId) throw new IdempotencyIntegrityConflict("Billing identity is not linked to a workspace");

    if (operation.customerId) {
      await tx.billingCustomer.upsert({
        where: { polarCustomerId: operation.customerId },
        update: { userId: user.id },
        create: { userId: user.id, polarCustomerId: operation.customerId },
      });
    }

    const startsAt = operation.currentPeriodStart || operation.createdAt;
    const endsAt =
      operation.currentPeriodEnd ||
      (plan.interval === "ANNUAL"
        ? new Date(Date.UTC(startsAt.getUTCFullYear() + 1, startsAt.getUTCMonth(), startsAt.getUTCDate()))
        : new Date(Date.UTC(startsAt.getUTCFullYear(), startsAt.getUTCMonth() + 1, startsAt.getUTCDate())));

    let entitlement = await tx.entitlement.findFirst({
      where: {
        OR: [
          ...(operation.subscriptionId ? [{ polarSubscriptionId: operation.subscriptionId }] : []),
          ...(operation.orderId ? [{ polarOrderId: operation.orderId }] : []),
        ],
      },
    });

    if (!entitlement) {
      entitlement = await tx.entitlement.create({
        data: {
          userId: user.id,
          workspaceId: user.defaultWorkspaceId,
          planCode: operation.planCode,
          billingInterval: plan.interval,
          polarCustomerId: operation.customerId,
          polarOrderId: operation.orderId,
          polarSubscriptionId: operation.subscriptionId,
          startsAt,
          endsAt,
          featuresJson: "[]",
        },
      });
    }

    await tx.user.update({
      where: { id: user.id },
      data: {
        activationStatus: "ACTIVATED",
        subscriptionStatus: "ACTIVE",
      },
    });

    if (plan.interval === "ANNUAL") {
      await materializeAnnualGrantSchedule(entitlement, plan.credits, tx);
      return { status: "PROCESSED", entitlement };
    } else {
      const grant = await grantCreditsIdempotently(
        {
          workspaceId: entitlement.workspaceId,
          userId: entitlement.userId,
          amount: plan.credits,
          reason: grantReason(entitlement.planCode),
          sourceId: entitlement.id,
          idempotencyKey: `polar-order:${operation.orderId}`,
        },
        tx
      );
      return { ...grant, entitlement };
    }
  }

  // C. RECURRING RENEWAL (billing_reason = subscription_cycle)
  if (operation.billingReason === "subscription_cycle") {
    let entitlement = null;
    if (operation.subscriptionId) {
      entitlement = await tx.entitlement.findUnique({ where: { polarSubscriptionId: operation.subscriptionId } });
    }
    if (!entitlement && operation.customerId) {
      entitlement = await tx.entitlement.findFirst({
        where: { polarCustomerId: operation.customerId, status: { in: ["ACTIVE", "CANCEL_AT_PERIOD_END"] } },
        orderBy: { createdAt: "desc" },
      });
    }

    if (!entitlement) {
      throw new IdempotencyIntegrityConflict("Subscription renewal order has no matching entitlement");
    }

    // Sync authoritative period end timestamp
    const newEndsAt = operation.currentPeriodEnd || entitlement.endsAt;
    await tx.entitlement.update({
      where: { id: entitlement.id },
      data: { endsAt: newEndsAt, status: "ACTIVE" },
    });

    const grant = await grantCreditsIdempotently(
      {
        workspaceId: entitlement.workspaceId,
        userId: entitlement.userId,
        amount: PLANS[entitlement.planCode].credits,
        reason: grantReason(entitlement.planCode),
        sourceId: entitlement.id,
        idempotencyKey: `polar-order:${operation.orderId}`,
      },
      tx
    );

    return { ...grant, entitlement };
  }

  // D. PLAN SWITCH / UPDATE (billing_reason = subscription_update)
  if (operation.billingReason === "subscription_update") {
    return { status: "PROCESSED_UNSUPPORTED_PLAN_UPDATE", reason: "Plan updates require manual proration review" };
  }

  return { status: "PROCESSED_NO_GRANT" };
}

async function handleSubscriptionLifecycle(operation, tx) {
  if (!operation.subscriptionId) return { status: "PROCESSED_NO_GRANT", reason: "Missing subscription identity" };

  const entitlement = await tx.entitlement.findUnique({ where: { polarSubscriptionId: operation.subscriptionId } });
  if (!entitlement) return { status: "PROCESSED_NO_GRANT", reason: "Entitlement not found" };

  const rawData = operation.raw || {};

  // Cancellation scheduled
  if (operation.eventType === "subscription.canceled" || (operation.eventType === "subscription.updated" && rawData.cancel_at_period_end)) {
    await tx.entitlement.update({
      where: { id: entitlement.id },
      data: { status: "CANCEL_AT_PERIOD_END" },
    });
    await tx.user.update({
      where: { id: entitlement.userId },
      data: { subscriptionStatus: "CANCEL_AT_PERIOD_END" },
    });
    return { status: "PROCESSED_CANCELLATION_SCHEDULED", entitlementId: entitlement.id };
  }

  // Uncancel / Restoration before period end
  if (operation.eventType === "subscription.uncanceled" || (operation.eventType === "subscription.updated" && rawData.cancel_at_period_end === false)) {
    await tx.entitlement.update({
      where: { id: entitlement.id },
      data: { status: "ACTIVE" },
    });
    await tx.user.update({
      where: { id: entitlement.userId },
      data: { subscriptionStatus: "ACTIVE" },
    });
    return { status: "PROCESSED_UNCANCELED", entitlementId: entitlement.id };
  }

  // Past due
  if (operation.eventType === "subscription.past_due" || (operation.eventType === "subscription.updated" && rawData.status === "past_due")) {
    await tx.user.update({
      where: { id: entitlement.userId },
      data: { subscriptionStatus: "PAST_DUE" },
    });
    return { status: "PROCESSED_PAST_DUE", entitlementId: entitlement.id };
  }

  // Active status restored (Zero credit grant)
  if (operation.eventType === "subscription.active" || (operation.eventType === "subscription.updated" && rawData.status === "active")) {
    await tx.user.update({
      where: { id: entitlement.userId },
      data: { subscriptionStatus: "ACTIVE" },
    });
    return { status: "PROCESSED_ACTIVE_RESTORED", entitlementId: entitlement.id };
  }

  // Immediate Revocation
  if (operation.eventType === "subscription.revoked") {
    const revokedAt = operation.createdAt || new Date();
    await tx.entitlement.update({
      where: { id: entitlement.id },
      data: { status: "REVOKED", grantsStoppedAt: revokedAt },
    });
    await tx.creditGrantSchedule.updateMany({
      where: { entitlementId: entitlement.id, status: "PENDING" },
      data: { status: "STOPPED", stoppedAt: revokedAt },
    });
    await tx.user.update({
      where: { id: entitlement.userId },
      data: { subscriptionStatus: "CANCELED" },
    });
    return { status: "PROCESSED_REVOKED", entitlementId: entitlement.id };
  }

  return { status: "PROCESSED_NO_ACTION" };
}

async function handleOrderRefunded(operation, tx) {
  if (!operation.orderId) return { status: "IGNORED_MISSING_ORDER_ID" };

  const entitlement = await tx.entitlement.findUnique({ where: { polarOrderId: operation.orderId } });
  const rawData = operation.raw || {};
  const amountRefunded = rawData.amount_refunded || rawData.refund?.amount || 0;
  const totalAmount = rawData.amount || rawData.order?.amount || 0;

  const isFullRefund = amountRefunded > 0 && amountRefunded >= totalAmount;

  if (entitlement && isFullRefund) {
    await tx.entitlement.update({
      where: { id: entitlement.id },
      data: { status: "REVOKED", grantsStoppedAt: new Date() },
    });
    await tx.creditGrantSchedule.updateMany({
      where: { entitlementId: entitlement.id, status: "PENDING" },
      data: { status: "STOPPED", stoppedAt: new Date() },
    });
    await tx.user.update({
      where: { id: entitlement.userId },
      data: { subscriptionStatus: "CANCELED" },
    });
    return { status: "PROCESSED_FULL_REFUND_REVOKED", isFullRefund: true };
  }

  return { status: "PROCESSED_PARTIAL_REFUND_AUDITED", isFullRefund: false };
}
