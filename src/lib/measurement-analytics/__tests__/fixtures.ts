import { parseAnalyticsRange } from "@/lib/distribution-analytics/validation";
import type { MeasurementConnectionRow, MeasurementFactRow } from "../service";

export const range = parseAnalyticsRange(new URLSearchParams("from=2026-09-01&to=2026-09-03"));
export const now = new Date("2026-09-06T12:00:00Z");
export function connection(overrides: Partial<MeasurementConnectionRow> = {}): MeasurementConnectionRow {
  return {
    id: "ga4-1", workspaceId: "workspace-1", platform: "ga4", externalAccountId: "properties/123",
    displayName: "Website", status: "connected", currency: null, lastSuccessfulSyncAt: null,
    ...overrides,
  };
}
export function fact(overrides: Partial<MeasurementFactRow> = {}): MeasurementFactRow {
  return {
    id: "fact-1", workspaceId: "workspace-1", platform: "ga4", connectionId: null,
    date: new Date("2026-09-01T00:00:00Z"), campaign: "Launch", campaignExternalId: "",
    metric: "sessions", value: 12, currency: null, staleAt: null, updatedAt: now,
    ...overrides,
  };
}
export function paidConnection(overrides: Partial<MeasurementConnectionRow> = {}): MeasurementConnectionRow {
  return connection({ id: "ads-1", platform: "google_ads", externalAccountId: "456", displayName: "Paid account", currency: "EUR", lastSuccessfulSyncAt: now, ...overrides });
}
export function paidFact(overrides: Partial<MeasurementFactRow> = {}): MeasurementFactRow {
  return fact({ id: "paid-1", platform: "google_ads", connectionId: "ads-1", campaign: "ads-1:campaign-1", campaignExternalId: "campaign-1", metric: "clicks", currency: "EUR", ...overrides });
}
