import type { Ad, Campaign, Connection, MetricFact, SyncAttempt } from "@prisma/client";

import { prisma } from "@/lib/db";
import type { PaidSyncPlatform } from "@/lib/connectors/paid-clients";
import { isLaunchPaidPlatform, PAID_PLATFORM_IDS } from "@/lib/product/platforms";

export const PAID_METRIC_KEYS = [
  "spend", "revenue", "roas", "cpa", "conversions", "clicks",
  "impressions", "ctr", "cpc", "cpm", "cvr", "aov",
] as const;
export type PaidMetricKey = (typeof PAID_METRIC_KEYS)[number];
export type PaidMetricRecord = Record<PaidMetricKey, number | null>;

const MONEY_METRICS = new Set<PaidMetricKey>(["spend", "revenue", "cpa", "cpc", "cpm", "aov"]);
const ADDITIVE = new Set<PaidMetricKey>(["spend", "revenue", "conversions", "clicks", "impressions"]);
const PLATFORM_LABEL: Record<PaidSyncPlatform, string> = {
  google_ads: "Google Ads",
  meta_ads: "Meta Ads",
  tiktok_ads: "TikTok Ads",
};

export type PaidFactRow = Pick<
  MetricFact,
  "connectionId" | "platform" | "date" | "campaignExternalId" | "campaignName" | "metric" | "value" | "currency"
>;
export type PaidCampaignRow = Pick<
  Campaign,
  "connectionId" | "platform" | "providerExternalId" | "name" | "status" | "objective" | "budget" | "budgetType" | "currency"
>;
export type PaidAdRow = Pick<
  Ad,
  | "connectionId" | "platform" | "providerExternalId" | "campaignExternalId" | "name" | "status"
  | "creativeType" | "thumbnailUrl" | "title" | "body" | "callToAction" | "linkUrl"
  | "spend" | "impressions" | "clicks" | "conversions" | "currency" | "metricsFrom" | "metricsTo"
>;
export type PaidConnectionRow = Pick<
  Connection,
  | "id" | "platform" | "externalAccountId" | "displayName" | "status" | "currency" | "timezone"
  | "lastSyncAt" | "lastSuccessfulSyncAt" | "lastErrorCode" | "lastErrorMessage"
>;
export type PaidAttemptRow = Pick<
  SyncAttempt,
  | "id" | "connectionId" | "status" | "requestedFrom" | "requestedTo" | "observedFrom" | "observedTo"
  | "currency" | "timezone" | "errorCode" | "errorMessage" | "startedAt" | "completedAt"
>;

export interface PaidDashboardInput {
  connections: PaidConnectionRow[];
  attempts: PaidAttemptRow[];
  facts: PaidFactRow[];
  previousFacts: PaidFactRow[];
  campaigns: PaidCampaignRow[];
  ads: PaidAdRow[];
  range: { from: Date; to: Date };
}

export interface PaidDashboardOutput {
  totals: PaidMetricRecord;
  previous: PaidMetricRecord;
  series: Array<{ date: string } & PaidMetricRecord>;
  platforms: Array<{ platform: string; label: string; currency: string | null; mixedCurrency: boolean } & PaidMetricRecord>;
  campaigns: Array<{
    identity: string;
    connectionId: string;
    accountId: string;
    accountName: string;
    externalId: string;
    platform: string;
    label: string;
    campaign: string;
    currency: string | null;
    sourceState: string;
    observedFrom: string | null;
    observedTo: string | null;
    status: string | null;
    objective: string | null;
    budget: number | null;
    budgetType: string | null;
    series: Array<{ date: string } & PaidMetricRecord>;
    ads: Array<{
      externalId: string;
      name: string;
      status: string | null;
      creativeType: string | null;
      thumbnailUrl: string | null;
      title: string | null;
      body: string | null;
      callToAction: string | null;
      linkUrl: string | null;
      currency: string | null;
      metricsFrom: string | null;
      metricsTo: string | null;
    } & PaidMetricRecord>;
  } & PaidMetricRecord>;
  range: { from: string; to: string; days: number };
  sources: Array<{
    key: string;
    id: string;
    connectionId: string;
    accountId: string;
    accountName: string;
    platform: string;
    platformLabel: string;
    currency: string | null;
    timezone: string | null;
    state: string;
    detail: string | null;
    requestedFrom: string | null;
    requestedTo: string | null;
    observedFrom: string | null;
    observedTo: string | null;
    lastSyncedAt: string | null;
  }>;
  accounts: PaidDashboardOutput["sources"];
  currency: string | null;
  currencies: string[];
  mixedCurrency: boolean;
  currencyGroups: Array<{ currency: string; totals: PaidMetricRecord }>;
  observedFrom: string | null;
  observedTo: string | null;
  requestedFrom: string;
  requestedTo: string;
  state: string;
  stateDetail: string | null;
}

function blankMetrics(): PaidMetricRecord {
  return Object.fromEntries(PAID_METRIC_KEYS.map((key) => [key, null])) as PaidMetricRecord;
}

function round(value: number): number {
  return Math.round(value * 10000) / 10000;
}

function ratio(numerator: number | null, denominator: number | null, multiplier = 1): number | null {
  if (numerator == null || denominator == null || denominator <= 0) return null;
  return round((numerator / denominator) * multiplier);
}

function derive(record: PaidMetricRecord, mixedCurrency: boolean): PaidMetricRecord {
  if (!mixedCurrency) {
    if (record.roas == null) record.roas = ratio(record.revenue, record.spend);
    if (record.cpa == null) record.cpa = ratio(record.spend, record.conversions);
    if (record.cpc == null) record.cpc = ratio(record.spend, record.clicks);
    if (record.cpm == null) record.cpm = ratio(record.spend, record.impressions, 1000);
    if (record.aov == null) record.aov = ratio(record.revenue, record.conversions);
  }
  if (record.ctr == null) record.ctr = ratio(record.clicks, record.impressions, 100);
  if (record.cvr == null) record.cvr = ratio(record.conversions, record.clicks, 100);
  if (mixedCurrency) {
    for (const key of MONEY_METRICS) record[key] = null;
    record.roas = null;
  }
  return record;
}

function metricsFromFacts(facts: PaidFactRow[], mixedCurrency = false): PaidMetricRecord {
  const record = blankMetrics();
  for (const key of ADDITIVE) {
    const values = facts.filter((fact) => fact.metric.toLowerCase() === key).map((fact) => fact.value);
    if (values.length === 0) continue;
    record[key] = round(values.reduce((sum, value) => sum + value, 0));
  }
  return derive(record, mixedCurrency);
}

function dayKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function axis(from: Date, to: Date): string[] {
  const days: string[] = [];
  const cursor = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate()));
  const end = Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), to.getUTCDate());
  for (let i = 0; i < 366 && cursor.getTime() <= end; i += 1) {
    days.push(dayKey(cursor));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return days;
}

function currencySet(values: Array<string | null | undefined>): string[] {
  return [...new Set(values.filter((value): value is string => typeof value === "string" && /^[A-Z]{3}$/.test(value)))].sort();
}

function stateSeverity(state: string): number {
  return { available: 0, unavailable: 1, stale: 2, partial: 3, failed: 4, revoked: 5 }[state] ?? 1;
}

function sourceState(connection: PaidConnectionRow, latest: PaidAttemptRow | undefined): string {
  if (connection.status === "revoked") return "revoked";
  if (latest?.status === "failed" || connection.status === "error") return "failed";
  if (latest?.status === "partial") return "partial";
  if (latest?.status === "running") return "unavailable";
  if (!latest) return "unavailable";
  const syncedAt = latest.completedAt ?? latest.startedAt;
  if (Date.now() - syncedAt.getTime() > 24 * 60 * 60 * 1000) return "stale";
  return "available";
}

function minIso(values: Array<Date | null | undefined>): string | null {
  const times = values.filter((value): value is Date => value instanceof Date).map((value) => value.getTime());
  return times.length > 0 ? new Date(Math.min(...times)).toISOString() : null;
}

function maxIso(values: Array<Date | null | undefined>): string | null {
  const times = values.filter((value): value is Date => value instanceof Date).map((value) => value.getTime());
  return times.length > 0 ? new Date(Math.max(...times)).toISOString() : null;
}

function latestAttempts(attempts: PaidAttemptRow[]): Map<string, PaidAttemptRow> {
  const map = new Map<string, PaidAttemptRow>();
  for (const attempt of [...attempts].sort((a, b) => b.startedAt.getTime() - a.startedAt.getTime())) {
    if (!map.has(attempt.connectionId)) map.set(attempt.connectionId, attempt);
  }
  return map;
}

function latestSuccessfulAttempts(attempts: PaidAttemptRow[]): Map<string, PaidAttemptRow> {
  return latestAttempts(attempts.filter((attempt) => attempt.status === "succeeded" || attempt.status === "partial"));
}

function attemptsForRange(
  attempts: PaidAttemptRow[],
  range: PaidDashboardInput["range"],
): PaidAttemptRow[] {
  const from = range.from.getTime();
  const to = range.to.getTime();
  return attempts.filter(
    (attempt) => attempt.requestedFrom.getTime() === from && attempt.requestedTo.getTime() === to,
  );
}

function adMetrics(ad: PaidAdRow): PaidMetricRecord {
  const metrics = blankMetrics();
  metrics.spend = ad.spend;
  metrics.impressions = ad.impressions;
  metrics.clicks = ad.clicks;
  metrics.conversions = ad.conversions;
  return derive(metrics, false);
}

function normalizePlatform(value: string): PaidSyncPlatform | null {
  return isLaunchPaidPlatform(value) ? value : null;
}

export function buildPaidDashboard(input: PaidDashboardInput): PaidDashboardOutput {
  const latest = latestAttempts(input.attempts);
  const latestSuccessful = latestSuccessfulAttempts(input.attempts);
  const rangeAttempts = attemptsForRange(input.attempts, input.range);
  const latestForRange = latestAttempts(rangeAttempts);
  const latestSuccessfulForRange = latestSuccessfulAttempts(rangeAttempts);
  const connectionById = new Map(input.connections.map((connection) => [connection.id, connection]));
  const sources = input.connections.flatMap((connection) => {
    const platform = normalizePlatform(connection.platform);
    if (!platform) return [];
    const attempt = latest.get(connection.id);
    const successful = latestSuccessful.get(connection.id);
    const rangeAttempt = latestForRange.get(connection.id);
    const rangeSuccessful = latestSuccessfulForRange.get(connection.id);
    const rangeFacts = input.facts.filter((fact) => fact.connectionId === connection.id);
    const state = sourceState(connection, attempt);
    return [{
      key: `${platform}:${connection.externalAccountId}`,
      id: connection.id,
      connectionId: connection.id,
      accountId: connection.externalAccountId,
      accountName: connection.displayName ?? connection.externalAccountId,
      platform,
      platformLabel: PLATFORM_LABEL[platform],
      currency: connection.currency ?? successful?.currency ?? null,
      timezone: connection.timezone ?? successful?.timezone ?? null,
      state,
      detail: attempt?.errorMessage ?? connection.lastErrorMessage ?? null,
      requestedFrom: rangeAttempt?.requestedFrom.toISOString() ?? null,
      requestedTo: rangeAttempt?.requestedTo.toISOString() ?? null,
      observedFrom: rangeSuccessful?.observedFrom?.toISOString() ?? minIso(rangeFacts.map((fact) => fact.date)),
      observedTo: rangeSuccessful?.observedTo?.toISOString() ?? maxIso(rangeFacts.map((fact) => fact.date)),
      lastSyncedAt: (attempt?.completedAt ?? attempt?.startedAt ?? connection.lastSyncAt)?.toISOString() ?? null,
    }];
  });
  const sourceByConnection = new Map(sources.map((source) => [source.connectionId, source]));
  const currentFacts = input.facts.filter((fact) => fact.connectionId && connectionById.has(fact.connectionId));
  const configuredCampaigns = new Map<string, PaidCampaignRow>();
  for (const campaign of input.campaigns) {
    if (!campaign.connectionId || !campaign.providerExternalId) continue;
    configuredCampaigns.set(`${campaign.connectionId}:${campaign.providerExternalId}`, campaign);
  }
  const campaignKeys = new Set(configuredCampaigns.keys());
  for (const fact of currentFacts) {
    if (fact.connectionId && fact.campaignExternalId) campaignKeys.add(`${fact.connectionId}:${fact.campaignExternalId}`);
  }

  const rangeAxis = axis(input.range.from, input.range.to);
  const campaignCurrencyUnsafe = new Set<string>();
  const campaigns = [...campaignKeys].flatMap((identity) => {
    const split = identity.indexOf(":");
    const connectionId = identity.slice(0, split);
    const providerId = identity.slice(split + 1);
    const connection = connectionById.get(connectionId);
    const source = sourceByConnection.get(connectionId);
    const platform = connection ? normalizePlatform(connection.platform) : null;
    if (!connection || !source || !platform) return [];
    const config = configuredCampaigns.get(identity);
    const facts = currentFacts.filter((fact) => fact.connectionId === connectionId && fact.campaignExternalId === providerId);
    const currencies = currencySet([config?.currency, ...facts.map((fact) => fact.currency), source.currency]);
    const currency = currencies.length === 1 ? currencies[0] : null;
    const hasMoneyEvidence = facts.some((fact) => ["spend", "revenue"].includes(fact.metric.toLowerCase()));
    const unsafeCurrency = currencies.length > 1 || (hasMoneyEvidence && currency == null);
    if (unsafeCurrency) campaignCurrencyUnsafe.add(identity);
    const series = rangeAxis.map((date) => ({
      date,
      ...metricsFromFacts(facts.filter((fact) => dayKey(fact.date) === date), unsafeCurrency),
    }));
    const campaignAds = input.ads
      .filter((ad) => ad.connectionId === connectionId && ad.campaignExternalId === providerId && ad.providerExternalId)
      .map((ad) => ({
        externalId: ad.providerExternalId as string,
        name: ad.name,
        status: ad.status,
        creativeType: ad.creativeType,
        thumbnailUrl: ad.thumbnailUrl,
        title: ad.title,
        body: ad.body,
        callToAction: ad.callToAction,
        linkUrl: ad.linkUrl,
        currency: ad.currency ?? currency,
        metricsFrom: ad.metricsFrom?.toISOString() ?? null,
        metricsTo: ad.metricsTo?.toISOString() ?? null,
        ...adMetrics(ad),
      }));
    const observedFrom = minIso(facts.map((fact) => fact.date));
    const observedTo = maxIso(facts.map((fact) => fact.date));
    return [{
      identity,
      connectionId,
      accountId: connection.externalAccountId,
      accountName: connection.displayName ?? connection.externalAccountId,
      externalId: providerId,
      platform,
      label: PLATFORM_LABEL[platform],
      campaign: config?.name ?? facts.find((fact) => fact.campaignName)?.campaignName ?? providerId,
      currency,
      sourceState: source.state,
      observedFrom,
      observedTo,
      status: config?.status ?? null,
      objective: config?.objective ?? null,
      budget: config?.budget ?? null,
      budgetType: config?.budgetType ?? null,
      series,
      ads: campaignAds,
      ...metricsFromFacts(facts, unsafeCurrency),
    }];
  });

  const currencies = currencySet([...sources.map((source) => source.currency), ...campaigns.map((campaign) => campaign.currency)]);
  const mixedKnownCurrencies = currencies.length > 1;
  const unknownCurrencyContribution = campaignCurrencyUnsafe.size > 0;
  const currencyUnsafe = mixedKnownCurrencies || unknownCurrencyContribution;
  // Provider metric snapshots contain only rows with observations. Campaign
  // inventory also includes dormant campaigns, so aggregating campaign DTOs
  // would let an inactive campaign with no rows erase valid account totals.
  // Sum the canonical facts directly and preserve null for metrics the provider
  // did not evidence anywhere in the selected range.
  const totals = metricsFromFacts(currentFacts, currencyUnsafe);
  const previous = metricsFromFacts(input.previousFacts, currencyUnsafe);
  const series = rangeAxis.map((date) => ({
    date,
    ...metricsFromFacts(currentFacts.filter((fact) => dayKey(fact.date) === date), currencyUnsafe),
  }));
  const platformIds = [...new Set(campaigns.map((campaign) => campaign.platform))];
  const platforms = platformIds.map((platform) => {
    const rows = campaigns.filter((campaign) => campaign.platform === platform);
    const childCurrencies = currencySet(rows.map((row) => row.currency));
    const unsafe = childCurrencies.length > 1 || rows.some((row) => campaignCurrencyUnsafe.has(row.identity));
    return {
      platform,
      label: PLATFORM_LABEL[platform as PaidSyncPlatform] ?? platform,
      currency: childCurrencies.length === 1 ? childCurrencies[0] : null,
      mixedCurrency: unsafe,
      ...metricsFromFacts(currentFacts.filter((fact) => fact.platform === platform), unsafe),
    };
  });
  const currencyGroups = currencies.map((currency) => ({
    currency,
    totals: metricsFromFacts(currentFacts.filter((fact) => fact.currency === currency), false),
  }));
  const observedFrom = minIso(currentFacts.map((fact) => fact.date));
  const observedTo = maxIso(currentFacts.map((fact) => fact.date));
  const state = sources.reduce((worst, source) => stateSeverity(source.state) > stateSeverity(worst) ? source.state : worst, sources.length ? "available" : "unavailable");
  const rangeDays = Math.round((input.range.to.getTime() - input.range.from.getTime()) / 86_400_000) + 1;
  return {
    totals,
    previous,
    series,
    platforms,
    campaigns,
    range: { from: dayKey(input.range.from), to: dayKey(input.range.to), days: rangeDays },
    sources,
    accounts: sources,
    currency: !currencyUnsafe && currencies.length === 1 ? currencies[0] : null,
    currencies,
    mixedCurrency: currencyUnsafe,
    currencyGroups,
    observedFrom,
    observedTo,
    requestedFrom: input.range.from.toISOString(),
    requestedTo: input.range.to.toISOString(),
    state,
    stateDetail: state === "available" ? null : sources.find((source) => source.state === state)?.detail ?? null,
  };
}

function previousRange(from: Date, to: Date): { from: Date; to: Date } {
  const days = Math.round((to.getTime() - from.getTime()) / 86_400_000) + 1;
  const previousTo = new Date(from);
  previousTo.setUTCDate(previousTo.getUTCDate() - 1);
  const previousFrom = new Date(previousTo);
  previousFrom.setUTCDate(previousFrom.getUTCDate() - (days - 1));
  return { from: previousFrom, to: previousTo };
}

export async function readPaidDashboard(
  workspaceId: string,
  range: { from: Date; to: Date },
): Promise<PaidDashboardOutput> {
  const previous = previousRange(range.from, range.to);
  const [connections, attempts, facts, previousFacts, campaigns, ads] = await Promise.all([
    prisma.connection.findMany({
      where: { workspaceId, platform: { in: [...PAID_PLATFORM_IDS] } },
      select: {
        id: true, platform: true, externalAccountId: true, displayName: true, status: true,
        currency: true, timezone: true, lastSyncAt: true, lastSuccessfulSyncAt: true,
        lastErrorCode: true, lastErrorMessage: true,
      },
      orderBy: [{ platform: "asc" }, { externalAccountId: "asc" }],
    }),
    prisma.syncAttempt.findMany({
      where: { workspaceId, connection: { platform: { in: [...PAID_PLATFORM_IDS] } } },
      select: {
        id: true, connectionId: true, status: true, requestedFrom: true, requestedTo: true,
        observedFrom: true, observedTo: true, currency: true, timezone: true, errorCode: true,
        errorMessage: true, startedAt: true, completedAt: true,
      },
      orderBy: { startedAt: "desc" },
      take: 500,
    }),
    prisma.metricFact.findMany({
      where: {
        workspaceId, platform: { in: [...PAID_PLATFORM_IDS] }, connectionId: { not: null },
        staleAt: null, date: { gte: range.from, lte: range.to },
      },
      select: {
        connectionId: true, platform: true, date: true, campaignExternalId: true,
        campaignName: true, metric: true, value: true, currency: true,
      },
      orderBy: { date: "asc" },
    }),
    prisma.metricFact.findMany({
      where: {
        workspaceId, platform: { in: [...PAID_PLATFORM_IDS] }, connectionId: { not: null },
        staleAt: null, date: { gte: previous.from, lte: previous.to },
      },
      select: {
        connectionId: true, platform: true, date: true, campaignExternalId: true,
        campaignName: true, metric: true, value: true, currency: true,
      },
      orderBy: { date: "asc" },
    }),
    prisma.campaign.findMany({
      where: { workspaceId, platform: { in: [...PAID_PLATFORM_IDS] }, connectionId: { not: null }, staleAt: null },
      select: {
        connectionId: true, platform: true, providerExternalId: true, name: true, status: true,
        objective: true, budget: true, budgetType: true, currency: true,
      },
    }),
    prisma.ad.findMany({
      where: { workspaceId, platform: { in: [...PAID_PLATFORM_IDS] }, connectionId: { not: null }, staleAt: null },
      select: {
        connectionId: true, platform: true, providerExternalId: true, campaignExternalId: true,
        name: true, status: true, creativeType: true, thumbnailUrl: true, title: true, body: true,
        callToAction: true, linkUrl: true, spend: true, impressions: true, clicks: true,
        conversions: true, currency: true, metricsFrom: true, metricsTo: true,
      },
      orderBy: { spend: "desc" },
    }),
  ]);
  return buildPaidDashboard({ connections, attempts, facts, previousFacts, campaigns, ads, range });
}
