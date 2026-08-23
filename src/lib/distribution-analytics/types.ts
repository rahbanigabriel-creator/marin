import type { PaidMetricRecord } from "@/lib/metrics/paid-dashboard";

export const DISTRIBUTION_ANALYTICS_SCHEMA_VERSION = "2026-08-22" as const;

export const ORGANIC_PLATFORMS = [
  "youtube",
  "instagram",
  "facebook",
  "tiktok",
  "snapchat",
  "reddit",
  "pinterest",
] as const;

export const ORGANIC_PUBLICATION_STATES = [
  "draft",
  "ready",
  "scheduled",
  "publishing",
  "published",
  "failed",
  "cancelled",
  "other",
] as const;

export const SEO_TASK_STATES = ["open", "in_progress", "completed", "dismissed", "other"] as const;
export const SEO_SEVERITIES = ["critical", "high", "medium", "low", "other"] as const;
export const SEO_PRIORITY_BANDS = ["p1_25", "p26_50", "p51_75", "p76_plus"] as const;

export type AnalyticsSectionState = "available" | "empty" | "partial" | "unavailable" | "stale" | "failed";
export type DistributionAnalyticsState = "available" | "empty" | "partial";
export type AnalyticsSourceKind = "operational" | "measured_outcome";

export interface AnalyticsDateRange {
  from: string;
  to: string;
  days: number;
  timezone: "UTC";
}

export interface AnalyticsCoverage {
  observedFrom: string | null;
  observedTo: string | null;
  freshnessAt: string | null;
}

export interface AnalyticsSource {
  id: string;
  name: string;
  kind: AnalyticsSourceKind;
  state: AnalyticsSectionState;
  detail: string | null;
  freshnessAt: string | null;
  observedFrom: string | null;
  observedTo: string | null;
}

export interface CountByKey<T extends string> {
  key: T;
  count: number;
}

export interface DistributionOrganicSummary {
  state: "available" | "empty";
  outputType: "operational";
  totalPublications: number;
  userConfirmedExternalHandoffs: number;
  byState: Array<CountByKey<(typeof ORGANIC_PUBLICATION_STATES)[number]>>;
  byPlatform: Array<CountByKey<(typeof ORGANIC_PLATFORMS)[number]>>;
  timeline: Array<{ date: string; scheduled: number; userConfirmedExternalHandoffs: number }>;
  coverage: AnalyticsCoverage;
  performance: {
    state: "unavailable";
    reason: "organic_provider_reads_not_connected";
    message: "No organic provider metrics are connected. Calendar and handoff records do not establish reach, impressions, engagements, or clicks.";
    source: null;
    coverage: AnalyticsCoverage;
    reach: null;
    impressions: null;
    engagements: null;
    clicks: null;
  };
}

export interface DistributionSeoSummary {
  state: "available" | "empty";
  outputType: "operational";
  totalTasks: number;
  byStatus: Array<CountByKey<(typeof SEO_TASK_STATES)[number]>>;
  bySeverity: Array<CountByKey<(typeof SEO_SEVERITIES)[number]>>;
  byPriority: Array<CountByKey<(typeof SEO_PRIORITY_BANDS)[number]>>;
  coverage: AnalyticsCoverage & {
    latestAnalyzedAt: string | null;
    latestUpdatedAt: string | null;
  };
}

export interface DistributionPaidPlatformSummary {
  platform: string;
  label: string;
  currency: string | null;
  mixedCurrency: boolean;
  metrics: PaidMetricRecord;
}

export interface DistributionPaidSummary {
  state: AnalyticsSectionState;
  outputType: "measured_outcome";
  totals: PaidMetricRecord;
  platforms: DistributionPaidPlatformSummary[];
  currency: string | null;
  currencies: string[];
  mixedCurrency: boolean;
  requestedRange: { from: string; to: string };
  observedRange: { from: string | null; to: string | null };
  sourceCount: number;
  sourcesTruncated: boolean;
}

export interface DistributionAnalyticsResponse {
  schemaVersion: typeof DISTRIBUTION_ANALYTICS_SCHEMA_VERSION;
  generatedAt: string;
  state: DistributionAnalyticsState;
  range: AnalyticsDateRange;
  organic: DistributionOrganicSummary;
  seo: DistributionSeoSummary;
  paid: DistributionPaidSummary;
  sources: AnalyticsSource[];
  sourcesTruncated: boolean;
}

export interface AnalyticsRangeInternal {
  from: Date;
  to: Date;
  toExclusive: Date;
  days: number;
}

export interface OrganicAnalyticsInput {
  total: number;
  userConfirmedExternalHandoffs: number;
  byState: Array<{ key: string; count: number }>;
  byPlatform: Array<{ key: string; count: number }>;
  scheduled: Array<{ at: Date; count: number }>;
  userConfirmedExternalHandoffsByDate: Array<{ at: Date; count: number }>;
  earliestActivityAt: Date | null;
  latestActivityAt: Date | null;
  latestUpdatedAt: Date | null;
}

export interface SeoAnalyticsInput {
  total: number;
  byStatus: Array<{ key: string; count: number }>;
  bySeverity: Array<{ key: string; count: number }>;
  byPriority: Array<{ priority: number; count: number }>;
  earliestActivityAt: Date | null;
  latestActivityAt: Date | null;
  latestAnalyzedAt: Date | null;
  latestUpdatedAt: Date | null;
}
