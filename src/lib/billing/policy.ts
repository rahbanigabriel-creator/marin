import {
  PLANS,
  type LaunchPlanId,
  type PlanEntitlements,
} from "@/lib/billing/plans";
import { applyLaunchFeatureGates } from "@/lib/product/features";

export const PAID_ENTITLEMENT_STATUSES = new Set(["active", "trialing"]);

export interface SubscriptionPolicyInput {
  plan: string;
  status: string;
  currentPeriodStart: Date | null;
  currentPeriodEnd: Date | null;
}

export interface BillingPolicy {
  planId: LaunchPlanId;
  entitlements: PlanEntitlements;
  periodStart: Date;
  periodEnd: Date;
}

export function utcCalendarMonth(now = new Date()): { start: Date; end: Date } {
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  return { start, end };
}

/**
 * Paid access is fail-closed: only a verified active/trialing Solo subscription
 * with a current, valid Stripe period grants Solo entitlements. Checkout redirects
 * and stale database rows can never grant access on their own.
 */
export function resolveBillingPolicy(
  subscription: SubscriptionPolicyInput | null,
  now = new Date(),
): BillingPolicy {
  const hasCurrentSoloPeriod = Boolean(
    subscription?.plan === "solo" &&
      PAID_ENTITLEMENT_STATUSES.has(subscription.status) &&
      subscription.currentPeriodStart &&
      subscription.currentPeriodEnd &&
      subscription.currentPeriodStart < subscription.currentPeriodEnd &&
      subscription.currentPeriodStart <= now &&
      now < subscription.currentPeriodEnd,
  );

  if (hasCurrentSoloPeriod && subscription?.currentPeriodStart && subscription.currentPeriodEnd) {
    const usagePeriod = utcCalendarMonth(now);
    return {
      planId: "solo",
      entitlements: applyLaunchFeatureGates(PLANS.solo.entitlements),
      periodStart: usagePeriod.start,
      periodEnd: usagePeriod.end,
    };
  }

  const freePeriod = utcCalendarMonth(now);
  return {
    planId: "free",
    entitlements: applyLaunchFeatureGates(PLANS.free.entitlements),
    periodStart: freePeriod.start,
    periodEnd: freePeriod.end,
  };
}
