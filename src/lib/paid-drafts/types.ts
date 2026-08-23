export type PaidPlatform = "google_ads" | "meta_ads" | "tiktok_ads";

export type PaidDraftSource = "manual" | "ai";

export type PaidLaunchTemplate =
  | "google_search_rsa"
  | "meta_traffic"
  | "meta_lead"
  | "tiktok_traffic"
  | "tiktok_conversion";

export type PaidCampaignObjective = "traffic" | "leads" | "conversions";

export interface PaidAccountIdentity {
  readonly platform: PaidPlatform;
  readonly connectionId: string;
  readonly accountId: string;
  readonly accountName: string;
}

export interface PaidBudgetSnapshot {
  readonly amountMinor: number;
  readonly currency: string;
  readonly cadence: "daily" | "lifetime";
}

export interface PaidScheduleSnapshot {
  readonly startsAt: string;
  readonly endsAt: string;
  readonly timezone: string;
}

export interface SearchKeywordSnapshot {
  readonly text: string;
  readonly matchType: "broad" | "phrase" | "exact";
}

export interface GoogleSearchTargetingSnapshot {
  readonly kind: "search";
  readonly locations: readonly string[];
  readonly languages: readonly string[];
  readonly keywords: readonly SearchKeywordSnapshot[];
  readonly negativeKeywords: readonly string[];
}

export type SocialGender = "all" | "female" | "male";

export interface SocialTargetingSnapshot {
  readonly kind: "audience";
  readonly locations: readonly string[];
  readonly languages: readonly string[];
  readonly ageMin: number;
  readonly ageMax: number;
  readonly genders: readonly SocialGender[];
  readonly interests: readonly string[];
}

export interface GoogleResponsiveSearchAdSnapshot {
  readonly localId: string;
  readonly name: string;
  readonly format: "responsive_search";
  readonly assetIds: readonly [];
  readonly headlines: readonly string[];
  readonly descriptions: readonly string[];
  readonly destinationUrl: string;
  readonly path1: string | null;
  readonly path2: string | null;
}

export type SocialCallToAction =
  | "contact_us"
  | "download"
  | "learn_more"
  | "shop_now"
  | "sign_up";

export interface MetaCreativeAdSnapshot {
  readonly localId: string;
  readonly name: string;
  readonly format: "image" | "video";
  readonly assetIds: readonly [string];
  readonly primaryText: string;
  readonly headline: string;
  readonly description: string | null;
  readonly callToAction: SocialCallToAction;
  readonly destinationUrl: string;
}

export interface TikTokVideoAdSnapshot {
  readonly localId: string;
  readonly name: string;
  readonly format: "video";
  readonly assetIds: readonly [string];
  readonly primaryText: string;
  readonly headline: string;
  readonly callToAction: SocialCallToAction;
  readonly destinationUrl: string;
}

export interface GoogleSearchAdGroupSnapshot {
  readonly localId: string;
  readonly name: string;
  readonly targeting: GoogleSearchTargetingSnapshot;
  readonly ads: readonly GoogleResponsiveSearchAdSnapshot[];
}

export interface MetaAdGroupSnapshot {
  readonly localId: string;
  readonly name: string;
  readonly targeting: SocialTargetingSnapshot;
  readonly ads: readonly MetaCreativeAdSnapshot[];
}

export interface TikTokAdGroupSnapshot {
  readonly localId: string;
  readonly name: string;
  readonly targeting: SocialTargetingSnapshot;
  readonly ads: readonly TikTokVideoAdSnapshot[];
}

interface PaidCampaignSnapshotBase {
  readonly schemaVersion: 1;
  readonly source: PaidDraftSource;
  readonly connection: PaidAccountIdentity;
  readonly campaign: {
    readonly name: string;
    readonly objective: PaidCampaignObjective;
  };
  readonly budget: PaidBudgetSnapshot;
  readonly schedule: PaidScheduleSnapshot;
  readonly assumptions: readonly string[];
}

export interface GoogleSearchCampaignSnapshotV1 extends PaidCampaignSnapshotBase {
  readonly platform: "google_ads";
  readonly template: "google_search_rsa";
  readonly campaign: {
    readonly name: string;
    readonly objective: "traffic";
  };
  readonly adGroups: readonly GoogleSearchAdGroupSnapshot[];
}

export interface MetaCampaignSnapshotV1 extends PaidCampaignSnapshotBase {
  readonly platform: "meta_ads";
  readonly template: "meta_traffic" | "meta_lead";
  readonly campaign: {
    readonly name: string;
    readonly objective: "traffic" | "leads";
  };
  readonly adGroups: readonly MetaAdGroupSnapshot[];
}

export interface TikTokCampaignSnapshotV1 extends PaidCampaignSnapshotBase {
  readonly platform: "tiktok_ads";
  readonly template: "tiktok_traffic" | "tiktok_conversion";
  readonly campaign: {
    readonly name: string;
    readonly objective: "traffic" | "conversions";
  };
  readonly adGroups: readonly TikTokAdGroupSnapshot[];
}

export type PaidCampaignSnapshotV1 =
  | GoogleSearchCampaignSnapshotV1
  | MetaCampaignSnapshotV1
  | TikTokCampaignSnapshotV1;

export type PaidDraftState =
  | "draft"
  | "ready"
  | "creating_paused"
  | "provider_paused"
  | "activating"
  | "activation_requested"
  | "active"
  | "in_review"
  | "rejected"
  | "needs_reconciliation";
