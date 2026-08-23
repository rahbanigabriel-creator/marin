import type {
  BillingInterval,
  LaunchPlanId,
  PlanEntitlements,
} from "@/lib/billing/plans";

export interface BillingSnapshotDto {
  billingConfigured: boolean;
  canManage: boolean;
  plan: {
    id: LaunchPlanId;
    name: string;
    priceEurMonthly: number;
    priceEurAnnual: number | null;
  };
  subscription: {
    status: string;
    billingInterval: BillingInterval | null;
    currentPeriodStart: string | null;
    currentPeriodEnd: string | null;
    cancelAtPeriodEnd: boolean;
  } | null;
  usage: {
    included: number;
    committed: number;
    reserved: number;
    remaining: number;
    periodStart: string;
    periodEnd: string;
  };
  resources: {
    connections: number;
    brands: number;
    seats: number;
    scheduledPosts: number;
    storageUsedBytes: number;
  };
  entitlements: PlanEntitlements;
  checkout: {
    monthlyConfigured: boolean;
    annualConfigured: boolean;
  };
}
