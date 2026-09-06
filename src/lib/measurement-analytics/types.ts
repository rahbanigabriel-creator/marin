import type { AnalyticsDateRange } from "@/lib/distribution-analytics/types";

export const MEASUREMENT_SCHEMA_VERSION = "2026-09-06" as const;
export const MEASUREMENT_PLATFORMS = ["ga4", "google_ads", "meta_ads"] as const;
export const PAID_MEASUREMENT_KEYS = ["spend", "clicks", "impressions", "conversions"] as const;
export type PaidMeasurementKey = (typeof PAID_MEASUREMENT_KEYS)[number];
export type MeasurementPlatform = (typeof MEASUREMENT_PLATFORMS)[number];
export type MeasurementValues = Record<PaidMeasurementKey, number | null>;

export interface MeasurementSource {
  id: string;
  platform: MeasurementPlatform;
  name: string;
  accountId: string;
  connectionState: "connected" | "error" | "revoked" | "unknown";
  lastSuccessfulSyncAt: string | null;
  lastStoredAt: string | null;
  observedFrom: string | null;
  observedTo: string | null;
}

export interface PaidMeasurementAccount {
  sourceId: string;
  currency: string | null;
  metrics: MeasurementValues;
  observedDays: Record<PaidMeasurementKey, number>;
  series: Array<{ date: string } & MeasurementValues>;
  notices: string[];
}

export interface MeasurementAnalyticsResponse {
  schemaVersion: typeof MEASUREMENT_SCHEMA_VERSION;
  generatedAt: string;
  range: AnalyticsDateRange;
  sources: MeasurementSource[];
  limited: boolean;
  ga4: {
    state: "empty" | "observations_only";
    observationCount: number;
    observationsLimited: boolean;
    lastStoredAt: string | null;
    observations: Array<{
      id: string;
      date: string;
      sourceId: string | null;
      campaign: string | null;
      metric: "sessions" | "conversions";
      value: number | null;
    }>;
  };
  paid: { accounts: PaidMeasurementAccount[] };
  appsFlyer: { state: "unavailable" };
}
