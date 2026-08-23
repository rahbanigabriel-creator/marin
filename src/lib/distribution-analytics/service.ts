import { prisma } from "@/lib/db";
import { readPaidDashboard, type PaidDashboardOutput, type PaidMetricRecord } from "@/lib/metrics/paid-dashboard";

import {
  DISTRIBUTION_ANALYTICS_SCHEMA_VERSION,
  ORGANIC_PLATFORMS,
  ORGANIC_PUBLICATION_STATES,
  SEO_PRIORITY_BANDS,
  SEO_SEVERITIES,
  SEO_TASK_STATES,
  type AnalyticsRangeInternal,
  type AnalyticsSectionState,
  type AnalyticsSource,
  type DistributionAnalyticsResponse,
  type OrganicAnalyticsInput,
  type SeoAnalyticsInput,
} from "./types";
import { analyticsDayKey, analyticsRangeParams } from "./validation";

const MAX_PAID_SOURCES = 30;
const MAX_CURRENCIES = 10;
const MAX_SOURCE_NAME_LENGTH = 160;
const MAX_SOURCE_DETAIL_LENGTH = 500;

export type PaidAnalyticsInput = Pick<
  PaidDashboardOutput,
  | "totals"
  | "platforms"
  | "sources"
  | "currency"
  | "currencies"
  | "mixedCurrency"
  | "requestedFrom"
  | "requestedTo"
  | "observedFrom"
  | "observedTo"
  | "state"
  | "campaigns"
>;

export interface DistributionAnalyticsDependencies {
  readOrganic(workspaceId: string, range: AnalyticsRangeInternal): Promise<OrganicAnalyticsInput>;
  readSeo(workspaceId: string, range: AnalyticsRangeInternal): Promise<SeoAnalyticsInput>;
  readPaid(workspaceId: string, range: { from: Date; to: Date }): Promise<PaidAnalyticsInput>;
  now(): Date;
}

function countMap<T extends string>(keys: readonly T[], rows: Array<{ key: string; count: number }>, otherKey: T) {
  const result = new Map<T, number>(keys.map((key) => [key, 0]));
  for (const row of rows) {
    const key = (keys as readonly string[]).includes(row.key) ? row.key as T : otherKey;
    result.set(key, (result.get(key) ?? 0) + row.count);
  }
  return keys.map((key) => ({ key, count: result.get(key) ?? 0 }));
}

function platformCounts(rows: Array<{ key: string; count: number }>) {
  const result = new Map(ORGANIC_PLATFORMS.map((key) => [key, 0]));
  for (const row of rows) {
    if ((ORGANIC_PLATFORMS as readonly string[]).includes(row.key)) {
      const key = row.key as (typeof ORGANIC_PLATFORMS)[number];
      result.set(key, (result.get(key) ?? 0) + row.count);
    }
  }
  return ORGANIC_PLATFORMS.map((key) => ({ key, count: result.get(key) ?? 0 }));
}

function priorityCounts(rows: Array<{ priority: number; count: number }>) {
  const totals = new Map(SEO_PRIORITY_BANDS.map((key) => [key, 0]));
  for (const row of rows) {
    const key = row.priority <= 25 ? "p1_25" : row.priority <= 50 ? "p26_50" : row.priority <= 75 ? "p51_75" : "p76_plus";
    totals.set(key, (totals.get(key) ?? 0) + row.count);
  }
  return SEO_PRIORITY_BANDS.map((key) => ({ key, count: totals.get(key) ?? 0 }));
}

function iso(value: Date | null): string | null {
  return value ? value.toISOString() : null;
}

function earliestDate(values: Array<Date | null | undefined>): Date | null {
  const times = values.filter((value): value is Date => value instanceof Date).map((value) => value.getTime());
  return times.length ? new Date(Math.min(...times)) : null;
}

function latestDate(values: Array<Date | null | undefined>): Date | null {
  const times = values.filter((value): value is Date => value instanceof Date).map((value) => value.getTime());
  return times.length ? new Date(Math.max(...times)) : null;
}

function boundedText(value: string, maximum: number): string {
  return value.length <= maximum ? value : value.slice(0, maximum);
}

function boundedOptionalText(value: string | null, maximum: number): string | null {
  return value === null ? null : boundedText(value, maximum);
}

function timeline(range: AnalyticsRangeInternal, organic: OrganicAnalyticsInput) {
  const scheduled = new Map<string, number>();
  const userConfirmedExternalHandoffs = new Map<string, number>();
  for (const row of organic.scheduled) {
    const key = analyticsDayKey(row.at);
    scheduled.set(key, (scheduled.get(key) ?? 0) + row.count);
  }
  for (const row of organic.userConfirmedExternalHandoffsByDate) {
    const key = analyticsDayKey(row.at);
    userConfirmedExternalHandoffs.set(key, (userConfirmedExternalHandoffs.get(key) ?? 0) + row.count);
  }
  return Array.from({ length: range.days }, (_, index) => {
    const date = new Date(range.from);
    date.setUTCDate(date.getUTCDate() + index);
    const key = analyticsDayKey(date);
    return {
      date: key,
      scheduled: scheduled.get(key) ?? 0,
      userConfirmedExternalHandoffs: userConfirmedExternalHandoffs.get(key) ?? 0,
    };
  });
}

function blankPaidMetrics(): PaidMetricRecord {
  return {
    spend: null,
    revenue: null,
    roas: null,
    cpa: null,
    conversions: null,
    clicks: null,
    impressions: null,
    ctr: null,
    cpc: null,
    cpm: null,
    cvr: null,
    aov: null,
  };
}

function safePaidMetrics(metrics: PaidMetricRecord, mixedCurrency: boolean): PaidMetricRecord {
  if (!mixedCurrency) return { ...metrics };
  return {
    ...metrics,
    spend: null,
    revenue: null,
    roas: null,
    cpa: null,
    cpc: null,
    cpm: null,
    aov: null,
  };
}

function normalizePaidState(value: string, hasSources: boolean): AnalyticsSectionState {
  if (!hasSources) return "unavailable";
  if (["available", "partial", "unavailable", "stale", "failed"].includes(value)) {
    return value as AnalyticsSectionState;
  }
  return "unavailable";
}

function overallState(organic: OrganicAnalyticsInput, seoTotal: number, paid: PaidAnalyticsInput): DistributionAnalyticsResponse["state"] {
  const hasPaidData = paid.campaigns.length > 0 || Object.values(paid.totals).some((value) => value !== null);
  const hasOrganicData = organic.total > 0 || organic.userConfirmedExternalHandoffs > 0;
  const hasAnyData = hasOrganicData || seoTotal > 0 || hasPaidData;
  if (!hasAnyData && paid.sources.length === 0) return "empty";
  const paidState = normalizePaidState(paid.state, paid.sources.length > 0);
  return paidState === "available" || (paid.sources.length === 0 && (hasOrganicData || seoTotal > 0)) ? "available" : "partial";
}

export function buildDistributionAnalytics(input: {
  range: AnalyticsRangeInternal;
  organic: OrganicAnalyticsInput;
  seo: SeoAnalyticsInput;
  paid: PaidAnalyticsInput;
  generatedAt: Date;
}): DistributionAnalyticsResponse {
  const { range, organic, seo, paid } = input;
  const paidSources = [...paid.sources]
    .sort((a, b) => `${a.platformLabel}:${a.accountName}`.localeCompare(`${b.platformLabel}:${b.accountName}`))
    .slice(0, MAX_PAID_SOURCES);
  const sources: AnalyticsSource[] = [
    {
      id: "marpin-organic-operations",
      name: "Marpin organic workflow and handoffs",
      kind: "operational",
      state: organic.total > 0 || organic.userConfirmedExternalHandoffs > 0 ? "available" : "empty",
      detail: organic.total > 0 || organic.userConfirmedExternalHandoffs > 0
        ? `${organic.total} persisted publications; ${organic.userConfirmedExternalHandoffs} user-confirmed external handoffs in range`
        : "No persisted organic workflow records in range",
      freshnessAt: iso(organic.latestUpdatedAt),
      observedFrom: iso(organic.earliestActivityAt),
      observedTo: iso(organic.latestActivityAt),
    },
    {
      id: "marpin-seo-operations",
      name: "Marpin SEO workspace",
      kind: "operational",
      state: seo.total > 0 ? "available" : "empty",
      detail: seo.total > 0 ? `${seo.total} persisted SEO tasks in range` : "No persisted SEO tasks in range",
      freshnessAt: iso(seo.latestUpdatedAt),
      observedFrom: iso(seo.earliestActivityAt),
      observedTo: iso(seo.latestActivityAt),
    },
    ...paidSources.map((source): AnalyticsSource => ({
      id: `paid:${source.connectionId}`,
      name: boundedText(`${source.platformLabel} · ${source.accountName}`, MAX_SOURCE_NAME_LENGTH),
      kind: "measured_outcome",
      state: normalizePaidState(source.state, true),
      detail: boundedOptionalText(source.detail, MAX_SOURCE_DETAIL_LENGTH),
      freshnessAt: source.lastSyncedAt,
      observedFrom: source.observedFrom,
      observedTo: source.observedTo,
    })),
  ];
  const sourcesTruncated = paid.sources.length > paidSources.length;

  return {
    schemaVersion: DISTRIBUTION_ANALYTICS_SCHEMA_VERSION,
    generatedAt: input.generatedAt.toISOString(),
    state: overallState(organic, seo.total, paid),
    range: analyticsRangeParams(range),
    organic: {
      state: organic.total > 0 || organic.userConfirmedExternalHandoffs > 0 ? "available" : "empty",
      outputType: "operational",
      totalPublications: organic.total,
      userConfirmedExternalHandoffs: organic.userConfirmedExternalHandoffs,
      byState: countMap(ORGANIC_PUBLICATION_STATES, organic.byState, "other"),
      byPlatform: platformCounts(organic.byPlatform),
      timeline: timeline(range, organic),
      coverage: {
        observedFrom: iso(organic.earliestActivityAt),
        observedTo: iso(organic.latestActivityAt),
        freshnessAt: iso(organic.latestUpdatedAt),
      },
      performance: {
        state: "unavailable",
        reason: "organic_provider_reads_not_connected",
        message: "No organic provider metrics are connected. Calendar and handoff records do not establish reach, impressions, engagements, or clicks.",
        source: null,
        coverage: { observedFrom: null, observedTo: null, freshnessAt: null },
        reach: null,
        impressions: null,
        engagements: null,
        clicks: null,
      },
    },
    seo: {
      state: seo.total > 0 ? "available" : "empty",
      outputType: "operational",
      totalTasks: seo.total,
      byStatus: countMap(SEO_TASK_STATES, seo.byStatus, "other"),
      bySeverity: countMap(SEO_SEVERITIES, seo.bySeverity, "other"),
      byPriority: priorityCounts(seo.byPriority),
      coverage: {
        observedFrom: iso(seo.earliestActivityAt),
        observedTo: iso(seo.latestActivityAt),
        freshnessAt: iso(seo.latestUpdatedAt),
        latestAnalyzedAt: iso(seo.latestAnalyzedAt),
        latestUpdatedAt: iso(seo.latestUpdatedAt),
      },
    },
    paid: {
      state: normalizePaidState(paid.state, paid.sources.length > 0),
      outputType: "measured_outcome",
      totals: safePaidMetrics(paid.totals ?? blankPaidMetrics(), paid.mixedCurrency),
      platforms: paid.platforms.slice(0, 3).map((platform) => ({
        platform: platform.platform,
        label: platform.label,
        currency: platform.currency,
        mixedCurrency: platform.mixedCurrency,
        metrics: safePaidMetrics({
          spend: platform.spend,
          revenue: platform.revenue,
          roas: platform.roas,
          cpa: platform.cpa,
          conversions: platform.conversions,
          clicks: platform.clicks,
          impressions: platform.impressions,
          ctr: platform.ctr,
          cpc: platform.cpc,
          cpm: platform.cpm,
          cvr: platform.cvr,
          aov: platform.aov,
        }, platform.mixedCurrency),
      })),
      currency: paid.mixedCurrency ? null : paid.currency,
      currencies: paid.currencies.slice(0, MAX_CURRENCIES),
      mixedCurrency: paid.mixedCurrency,
      requestedRange: { from: paid.requestedFrom, to: paid.requestedTo },
      observedRange: { from: paid.observedFrom, to: paid.observedTo },
      sourceCount: paid.sources.length,
      sourcesTruncated,
    },
    sources,
    sourcesTruncated,
  };
}

async function readOrganic(workspaceId: string, range: AnalyticsRangeInternal): Promise<OrganicAnalyticsInput> {
  const activityWhere = {
    workspaceId,
    OR: [
      { scheduledAt: { gte: range.from, lt: range.toExclusive } },
      { publishedAt: { gte: range.from, lt: range.toExclusive } },
      { updatedAt: { gte: range.from, lt: range.toExclusive } },
    ],
  };
  const [
    total,
    stateGroups,
    platformGroups,
    scheduledGroups,
    userConfirmedExternalHandoffGroups,
    earliestUpdate,
    latestUpdate,
    latestUpdated,
  ] = await Promise.all([
    prisma.publication.count({ where: activityWhere }),
    prisma.publication.groupBy({ by: ["status"], where: activityWhere, _count: { _all: true } }),
    prisma.publication.groupBy({ by: ["platform"], where: activityWhere, _count: { _all: true } }),
    prisma.publication.groupBy({
      by: ["scheduledAt"],
      where: { workspaceId, scheduledAt: { gte: range.from, lt: range.toExclusive } },
      _count: { _all: true },
    }),
    prisma.publicationAttempt.groupBy({
      by: ["attemptedAt"],
      where: {
        workspaceId,
        provider: "assisted",
        status: "succeeded",
        response: { path: ["kind"], equals: "user_attestation" },
        attemptedAt: { gte: range.from, lt: range.toExclusive },
      },
      _count: { _all: true },
    }),
    prisma.publication.findFirst({ where: { workspaceId, updatedAt: { gte: range.from, lt: range.toExclusive } }, orderBy: { updatedAt: "asc" }, select: { updatedAt: true } }),
    prisma.publication.findFirst({ where: { workspaceId, updatedAt: { gte: range.from, lt: range.toExclusive } }, orderBy: { updatedAt: "desc" }, select: { updatedAt: true } }),
    prisma.publication.findFirst({ where: { workspaceId }, orderBy: { updatedAt: "desc" }, select: { updatedAt: true } }),
  ]);
  return {
    total,
    userConfirmedExternalHandoffs: userConfirmedExternalHandoffGroups.reduce((sum, row) => sum + row._count._all, 0),
    byState: stateGroups.map((row) => ({ key: row.status, count: row._count._all })),
    byPlatform: platformGroups.map((row) => ({ key: row.platform, count: row._count._all })),
    scheduled: scheduledGroups.flatMap((row) => row.scheduledAt ? [{ at: row.scheduledAt, count: row._count._all }] : []),
    userConfirmedExternalHandoffsByDate: userConfirmedExternalHandoffGroups.map((row) => ({
      at: row.attemptedAt,
      count: row._count._all,
    })),
    earliestActivityAt: earliestDate([
      earliestUpdate?.updatedAt,
      ...scheduledGroups.map((row) => row.scheduledAt),
      ...userConfirmedExternalHandoffGroups.map((row) => row.attemptedAt),
    ]),
    latestActivityAt: latestDate([
      latestUpdate?.updatedAt,
      ...scheduledGroups.map((row) => row.scheduledAt),
      ...userConfirmedExternalHandoffGroups.map((row) => row.attemptedAt),
    ]),
    latestUpdatedAt: latestUpdated?.updatedAt ?? null,
  };
}

async function readSeo(workspaceId: string, range: AnalyticsRangeInternal): Promise<SeoAnalyticsInput> {
  const activityWhere = {
    workspaceId,
    OR: [
      { analyzedAt: { gte: range.from, lt: range.toExclusive } },
      { updatedAt: { gte: range.from, lt: range.toExclusive } },
    ],
  };
  const [
    total,
    statuses,
    severities,
    priorities,
    earliestUpdate,
    latestUpdate,
    earliestAnalysis,
    latestAnalysisInRange,
    latestAnalyzed,
    latestUpdated,
  ] = await Promise.all([
    prisma.seoTask.count({ where: activityWhere }),
    prisma.seoTask.groupBy({ by: ["status"], where: activityWhere, _count: { _all: true } }),
    prisma.seoTask.groupBy({ by: ["severity"], where: activityWhere, _count: { _all: true } }),
    prisma.seoTask.groupBy({ by: ["priority"], where: activityWhere, _count: { _all: true } }),
    prisma.seoTask.findFirst({ where: { workspaceId, updatedAt: { gte: range.from, lt: range.toExclusive } }, orderBy: { updatedAt: "asc" }, select: { updatedAt: true } }),
    prisma.seoTask.findFirst({ where: { workspaceId, updatedAt: { gte: range.from, lt: range.toExclusive } }, orderBy: { updatedAt: "desc" }, select: { updatedAt: true } }),
    prisma.seoTask.findFirst({ where: { workspaceId, analyzedAt: { gte: range.from, lt: range.toExclusive } }, orderBy: { analyzedAt: "asc" }, select: { analyzedAt: true } }),
    prisma.seoTask.findFirst({ where: { workspaceId, analyzedAt: { gte: range.from, lt: range.toExclusive } }, orderBy: { analyzedAt: "desc" }, select: { analyzedAt: true } }),
    prisma.seoTask.findFirst({ where: { workspaceId, analyzedAt: { not: null } }, orderBy: { analyzedAt: "desc" }, select: { analyzedAt: true } }),
    prisma.seoTask.findFirst({ where: { workspaceId }, orderBy: { updatedAt: "desc" }, select: { updatedAt: true } }),
  ]);
  return {
    total,
    byStatus: statuses.map((row) => ({ key: row.status, count: row._count._all })),
    bySeverity: severities.map((row) => ({ key: row.severity, count: row._count._all })),
    byPriority: priorities.map((row) => ({ priority: row.priority, count: row._count._all })),
    earliestActivityAt: earliestDate([earliestUpdate?.updatedAt, earliestAnalysis?.analyzedAt]),
    latestActivityAt: latestDate([latestUpdate?.updatedAt, latestAnalysisInRange?.analyzedAt]),
    latestAnalyzedAt: latestAnalyzed?.analyzedAt ?? null,
    latestUpdatedAt: latestUpdated?.updatedAt ?? null,
  };
}

const defaultDependencies: DistributionAnalyticsDependencies = {
  readOrganic,
  readSeo,
  readPaid: readPaidDashboard,
  now: () => new Date(),
};

export async function readDistributionAnalytics(
  workspaceId: string,
  range: AnalyticsRangeInternal,
  dependencies: DistributionAnalyticsDependencies = defaultDependencies,
): Promise<DistributionAnalyticsResponse> {
  if (!workspaceId) throw new Error("workspace_id_required");
  const [organic, seo, paid] = await Promise.all([
    dependencies.readOrganic(workspaceId, range),
    dependencies.readSeo(workspaceId, range),
    dependencies.readPaid(workspaceId, { from: range.from, to: range.to }),
  ]);
  return buildDistributionAnalytics({ range, organic, seo, paid, generatedAt: dependencies.now() });
}
