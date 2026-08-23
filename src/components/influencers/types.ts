export const INFLUENCER_PLATFORMS = [
  "youtube",
  "instagram",
  "facebook",
  "tiktok",
  "snapchat",
  "reddit",
  "pinterest",
] as const;

export const INFLUENCER_STATUSES = [
  "prospect",
  "researching",
  "qualified",
  "outreach_ready",
  "contacted",
  "replied",
  "negotiating",
  "active",
  "declined",
  "archived",
] as const;

export type InfluencerPlatform = (typeof INFLUENCER_PLATFORMS)[number];
export type InfluencerStatus = (typeof INFLUENCER_STATUSES)[number];
export type InfluencerMetricName =
  | "audience_size"
  | "average_views"
  | "engagement_rate";

export interface InfluencerMetricDto {
  metric: InfluencerMetricName;
  value: number;
  sourceUrl: string | null;
  observedAt: string;
  source: "manual" | "public_profile" | "vendor";
}

export interface InfluencerQualificationEvidenceDto {
  id?: string;
  label: string;
  detail: string | null;
  sourceUrl: string | null;
  observedAt: string | null;
}

export interface InfluencerOutreachDto {
  id: string;
  subject: string | null;
  body: string;
  sponsorshipDisclosure: string;
  claimsRestrictions: string | null;
  compensationNote: string | null;
  status: "draft" | "copied" | "opened" | string;
  createdAt: string;
  updatedAt?: string;
}

export interface InfluencerTrackingLinkDto {
  id: string;
  slug: string;
  destinationUrl: string;
  taggedDestinationUrl: string;
  trackingUrl: string;
  campaignKey: string;
  enabled: boolean;
  clickCount: string;
  lastClickedAt: string | null;
  disabledAt: string | null;
  expiresAt: string;
  version: number;
  createdAt: string;
}

export interface InfluencerCampaignSummaryDto {
  id: string;
  name: string;
  status: string;
}

export interface InfluencerDeliverableSummaryDto {
  id: string;
  title: string;
  status: string;
  dueAt: string | null;
}

export interface InfluencerProfileDto {
  id: string;
  version: number;
  platform: InfluencerPlatform;
  handle: string;
  normalizedHandle?: string;
  profileUrl: string;
  displayName: string | null;
  contactEmail: string | null;
  contactName: string | null;
  topics: string[];
  audienceCountries: string[];
  notes: string | null;
  status: InfluencerStatus;
  source: "manual" | "import" | "vendor";
  metrics: InfluencerMetricDto[];
  qualificationEvidence?: InfluencerQualificationEvidenceDto[];
  outreachDrafts?: InfluencerOutreachDto[];
  trackingLinks?: InfluencerTrackingLinkDto[];
  campaigns?: InfluencerCampaignSummaryDto[];
  deliverables?: InfluencerDeliverableSummaryDto[];
  lastActivityAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface InfluencerCapabilityDto {
  canManage: boolean;
  contactVisibility: "full" | "redacted";
  vendorDiscovery: "available" | "unavailable";
  aiAssistance: "available" | "upgrade_required" | "unavailable";
  outreachExecution: "assisted";
}

export interface InfluencerCoverageDto {
  profileCount?: number;
  observedAt?: string | null;
  lastActivityAt?: string | null;
  detail?: string | null;
}

export interface InfluencerWorkspaceResponse {
  profiles: InfluencerProfileDto[];
  capability: InfluencerCapabilityDto;
  coverage: InfluencerCoverageDto;
}

export interface InfluencerProfileInput {
  platform: InfluencerPlatform;
  handle: string;
  profileUrl: string;
  displayName: string | null;
  contactEmail: string | null;
  contactName: string | null;
  topics: string[];
  audienceCountries: string[];
  notes: string | null;
  status: InfluencerStatus;
  source: "manual" | "import";
  metrics: InfluencerMetricDto[];
}

export interface InfluencerOutreachInput {
  subject: string | null;
  body: string;
  sponsorshipDisclosure: string;
  claimsRestrictions: string | null;
  compensationNote: string | null;
}
