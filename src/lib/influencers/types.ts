import type { WorkspaceRole } from "@/lib/auth";

export const INFLUENCER_PLATFORMS = [
  "youtube",
  "instagram",
  "facebook",
  "tiktok",
  "snapchat",
  "reddit",
  "pinterest",
] as const;

export type InfluencerPlatform = (typeof INFLUENCER_PLATFORMS)[number];
export type InfluencerSource = "manual" | "import" | "vendor";
export type InfluencerCrmStatus =
  | "prospect"
  | "researching"
  | "qualified"
  | "outreach_ready"
  | "contacted"
  | "replied"
  | "negotiating"
  | "active"
  | "declined"
  | "archived";

export type InfluencerMetricName =
  | "audience_size"
  | "average_views"
  | "engagement_rate";

export interface InfluencerMetricEvidence {
  metric: InfluencerMetricName;
  value: number;
  sourceUrl: string | null;
  observedAt: string;
  source: "manual" | "public_profile" | "vendor";
}

export interface InfluencerProfileDraft {
  platform: InfluencerPlatform;
  handle: string;
  profileUrl: string;
  displayName: string | null;
  contactEmail: string | null;
  contactName: string | null;
  topics: string[];
  audienceCountries: string[];
  notes: string | null;
  status: InfluencerCrmStatus;
  source: InfluencerSource;
  metrics: InfluencerMetricEvidence[];
}

export interface InfluencerOutreachDraft {
  subject: string | null;
  body: string;
  sponsorshipDisclosure: string;
  claimsRestrictions: string | null;
  compensationNote: string | null;
}

export interface InfluencerCapability {
  canRead: boolean;
  canManage: boolean;
  contactVisibility: "full" | "redacted";
  vendorDiscovery: "available" | "unavailable";
  aiAssistance: "available" | "upgrade_required" | "unavailable";
  outreachExecution: "assisted";
}

export interface InfluencerCapabilityInput {
  role: WorkspaceRole;
  vendorConfigured: boolean;
  aiConfigured: boolean;
  hasAiEntitlement: boolean;
}

export interface InfluencerTrackingLinkInput {
  destinationUrl: string;
  campaignKey: string;
  influencerKey: string;
  platform: InfluencerPlatform;
}

export interface InfluencerTrackingLink {
  slug: string;
  destinationUrl: string;
  taggedDestinationUrl: string;
}
