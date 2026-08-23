import type { Prisma } from "@prisma/client";

import { prisma } from "@/lib/db";
import { isBillingConfigured } from "@/lib/billing/config";
import { getStripePriceId, PLANS } from "@/lib/billing/plans";
import { resolveBillingPolicy, type BillingPolicy } from "@/lib/billing/policy";
import type { BillingSnapshotDto } from "@/lib/billing/types";
import { applyLaunchFeatureGates } from "@/lib/product/features";

export type BillingDatabase = Pick<
  Prisma.TransactionClient,
  "subscription" | "usageEvent" | "connection" | "brand" | "membership" | "publication" | "asset" | "workspace"
>;

export async function resolveWorkspaceBillingPolicy(
  workspaceId: string,
  db: BillingDatabase = prisma,
  now = new Date(),
): Promise<BillingPolicy> {
  const subscription = await db.subscription.findUnique({
    where: { workspaceId },
    select: {
      plan: true,
      status: true,
      currentPeriodStart: true,
      currentPeriodEnd: true,
    },
  });
  return resolveBillingPolicy(subscription, now);
}

export function staticFreeBillingSnapshot(
  canManage: boolean,
  now = new Date(),
): BillingSnapshotDto {
  const policy = resolveBillingPolicy(null, now);
  return {
    billingConfigured: isBillingConfigured(),
    canManage,
    plan: {
      id: "free",
      name: PLANS.free.name,
      priceEurMonthly: PLANS.free.priceEurMonthly,
      priceEurAnnual: PLANS.free.priceEurAnnual,
    },
    subscription: null,
    usage: {
      included: PLANS.free.includedCredits,
      committed: 0,
      reserved: 0,
      remaining: PLANS.free.includedCredits,
      periodStart: policy.periodStart.toISOString(),
      periodEnd: policy.periodEnd.toISOString(),
    },
    resources: { connections: 0, brands: 0, seats: 0, scheduledPosts: 0, storageUsedBytes: 0 },
    entitlements: applyLaunchFeatureGates(PLANS.free.entitlements),
    checkout: {
      monthlyConfigured: Boolean(getStripePriceId("solo", "monthly")),
      annualConfigured: Boolean(getStripePriceId("solo", "annual")),
    },
  };
}

export async function getBillingSnapshot(
  workspaceId: string,
  canManage: boolean,
  now = new Date(),
  db: BillingDatabase = prisma,
): Promise<BillingSnapshotDto> {
  const subscription = await db.subscription.findUnique({ where: { workspaceId } });
  const policy = resolveBillingPolicy(subscription, now);
  const [committed, reserved, connections, brands, seats, scheduledPosts, storage] = await Promise.all([
    db.usageEvent.aggregate({
      _sum: { credits: true },
      where: {
        workspaceId,
        status: "committed",
        periodStart: { gte: policy.periodStart, lt: policy.periodEnd },
      },
    }),
    db.usageEvent.aggregate({
      _sum: { credits: true },
      where: {
        workspaceId,
        status: "reserved",
        periodStart: { gte: policy.periodStart, lt: policy.periodEnd },
      },
    }),
    db.connection.count({ where: { workspaceId, status: { not: "revoked" } } }),
    db.brand.count({ where: { workspaceId } }),
    db.membership.count({ where: { workspaceId } }),
    db.publication.count({
      where: {
        workspaceId,
        scheduledAt: { gte: now },
        status: { in: ["draft", "ready", "scheduled", "publishing"] },
      },
    }),
    db.asset.aggregate({
      _sum: { bytes: true },
      where: { workspaceId },
    }),
  ]);
  const committedCredits = committed._sum.credits ?? 0;
  const reservedCredits = reserved._sum.credits ?? 0;
  const plan = PLANS[policy.planId];

  return {
    billingConfigured: isBillingConfigured(),
    canManage,
    plan: {
      id: policy.planId,
      name: plan.name,
      priceEurMonthly: plan.priceEurMonthly,
      priceEurAnnual: plan.priceEurAnnual,
    },
    subscription: subscription
      ? {
          status: subscription.status,
          billingInterval:
            subscription.billingInterval === "monthly" || subscription.billingInterval === "annual"
              ? subscription.billingInterval
              : null,
          currentPeriodStart: subscription.currentPeriodStart?.toISOString() ?? null,
          currentPeriodEnd: subscription.currentPeriodEnd?.toISOString() ?? null,
          cancelAtPeriodEnd: subscription.cancelAtPeriodEnd,
        }
      : null,
    usage: {
      included: plan.includedCredits,
      committed: committedCredits,
      reserved: reservedCredits,
      remaining: Math.max(0, plan.includedCredits - committedCredits - reservedCredits),
      periodStart: policy.periodStart.toISOString(),
      periodEnd: policy.periodEnd.toISOString(),
    },
    resources: {
      connections,
      brands,
      seats,
      scheduledPosts,
      storageUsedBytes: storage._sum.bytes ?? 0,
    },
    entitlements: policy.entitlements,
    checkout: {
      monthlyConfigured: Boolean(getStripePriceId("solo", "monthly")),
      annualConfigured: Boolean(getStripePriceId("solo", "annual")),
    },
  };
}
