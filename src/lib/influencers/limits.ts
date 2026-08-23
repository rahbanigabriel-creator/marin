import type { LaunchPlanId } from "@/lib/billing/plans";

export type InfluencerLimitedResource =
  | "profiles"
  | "outreach_drafts"
  | "tracking_links";

export interface InfluencerWorkspaceLimits {
  profiles: number;
  outreach_drafts: number;
  tracking_links: number;
}

/**
 * Launch limits are deliberately finite for every self-serve plan. They bound
 * persistent CRM rows and trusted redirect creation independently of UI paging.
 */
export const INFLUENCER_WORKSPACE_LIMITS: Readonly<
  Record<LaunchPlanId, Readonly<InfluencerWorkspaceLimits>>
> = Object.freeze({
  free: Object.freeze({
    profiles: 25,
    outreach_drafts: 50,
    tracking_links: 25,
  }),
  solo: Object.freeze({
    profiles: 500,
    outreach_drafts: 2_000,
    tracking_links: 1_000,
  }),
});

export function influencerWorkspaceLimit(
  planId: LaunchPlanId,
  resource: InfluencerLimitedResource,
): number {
  return INFLUENCER_WORKSPACE_LIMITS[planId][resource];
}
