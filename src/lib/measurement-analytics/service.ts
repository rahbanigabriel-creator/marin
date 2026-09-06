import type { Connection, MetricFact, Prisma } from "@prisma/client";

import { prisma } from "@/lib/db";
import type { AnalyticsRangeInternal } from "@/lib/distribution-analytics/types";
import { analyticsDayKey, analyticsRangeParams } from "@/lib/distribution-analytics/validation";
import {
  MEASUREMENT_PLATFORMS,
  MEASUREMENT_SCHEMA_VERSION,
  PAID_MEASUREMENT_KEYS,
  type MeasurementAnalyticsResponse,
  type MeasurementPlatform,
  type MeasurementSource,
  type MeasurementValues,
  type PaidMeasurementAccount,
} from "./types";

export const MAX_MEASUREMENT_FACTS = 20_000;
export const MAX_MEASUREMENT_SOURCES = 100;
const MAX_GA4_OBSERVATIONS = 100;

export const measurementConnectionSelect = {
  id: true, workspaceId: true, platform: true, externalAccountId: true,
  displayName: true, status: true, currency: true, lastSuccessfulSyncAt: true,
} satisfies Prisma.ConnectionSelect;

export const measurementFactSelect = {
  id: true, workspaceId: true, connectionId: true, platform: true, date: true,
  campaign: true, campaignExternalId: true, metric: true, value: true,
  currency: true, staleAt: true, updatedAt: true,
} satisfies Prisma.MetricFactSelect;

export type MeasurementConnectionRow = Pick<Connection, keyof typeof measurementConnectionSelect>;
export type MeasurementFactRow = Pick<MetricFact, keyof typeof measurementFactSelect>;
export interface MeasurementSnapshot {
  connections: MeasurementConnectionRow[];
  facts: MeasurementFactRow[];
}

export function measurementQueries(workspaceId: string, range: AnalyticsRangeInternal) {
  if (!workspaceId.trim()) throw new Error("workspace_id_required");
  return {
    connections: {
      where: { workspaceId, platform: { in: [...MEASUREMENT_PLATFORMS] } },
      select: measurementConnectionSelect,
      orderBy: [{ platform: "asc" }, { id: "asc" }],
      take: MAX_MEASUREMENT_SOURCES + 1,
    } satisfies Prisma.ConnectionFindManyArgs,
    facts: {
      where: {
        workspaceId,
        date: { gte: range.from, lt: range.toExclusive },
        staleAt: null,
        // Check both sides of the relation. A foreign or mismatched connection
        // must never lend its identity to a workspace's measurement row.
        OR: MEASUREMENT_PLATFORMS.map((platform) => ({
          platform,
          metric: { in: platform === "ga4" ? ["sessions", "conversions"] : [...PAID_MEASUREMENT_KEYS] },
          OR: [
            { connection: { workspaceId, platform } },
            ...(platform === "ga4" ? [{ connectionId: null }] : []),
          ],
        })),
      },
      select: measurementFactSelect,
      orderBy: [{ date: "desc" }, { id: "asc" }],
      take: MAX_MEASUREMENT_FACTS + 1,
    } satisfies Prisma.MetricFactFindManyArgs,
  };
}

function latestStored(facts: MeasurementFactRow[]): string | null {
  return facts.length ? new Date(Math.max(...facts.map((row) => row.updatedAt.getTime()))).toISOString() : null;
}

function blankMetrics(): MeasurementValues {
  return { spend: null, clicks: null, impressions: null, conversions: null };
}

function paidAccount(
  connection: MeasurementConnectionRow,
  facts: MeasurementFactRow[],
  limited: boolean,
): PaidMeasurementAccount {
  const metrics = blankMetrics();
  const observedDays = { spend: 0, clicks: 0, impressions: 0, conversions: 0 };
  const notices: string[] = [];
  const days = new Map<string, { date: string } & MeasurementValues>();
  const campaignFacts = facts.filter((row) => row.campaignExternalId.trim() !== "");
  if (campaignFacts.length !== facts.length) notices.push("Account-level or unidentified rows excluded to avoid overlapping campaign totals.");
  if (limited) notices.push("Read limit reached. Totals and charts are withheld; narrow the date range.");
  let currency: string | null = null;

  if (!limited) for (const metric of PAID_MEASUREMENT_KEYS) {
    const rows = campaignFacts.filter((row) => row.metric === metric);
    if (!rows.length) continue;
    const keys = new Set(rows.map((row) => JSON.stringify([analyticsDayKey(row.date), row.campaignExternalId, row.metric])));
    if (keys.size !== rows.length || rows.some((row) => !Number.isFinite(row.value) || row.value < 0)) {
      notices.push(`${metric}: conflicting or invalid observations; value withheld.`);
      continue;
    }
    if (metric === "spend") {
      const currencies = new Set(rows.map((row) => row.currency));
      const [recordedCurrency] = currencies;
      if (currencies.size !== 1 || !recordedCurrency || !/^[A-Z]{3}$/.test(recordedCurrency)
        || (connection.currency !== null && connection.currency !== recordedCurrency)) {
        notices.push("Spend unavailable: observation currency is missing, mixed, or conflicts with the account.");
        continue;
      }
      currency = recordedCurrency;
    }
    const total = rows.reduce((sum, row) => sum + row.value, 0);
    if (!Number.isFinite(total)) {
      notices.push(`${metric}: invalid total; value withheld.`);
      continue;
    }
    metrics[metric] = total;
    observedDays[metric] = new Set(rows.map((row) => analyticsDayKey(row.date))).size;
    for (const row of rows) {
      const date = analyticsDayKey(row.date);
      const day = days.get(date) ?? { date, ...blankMetrics() };
      day[metric] = (day[metric] ?? 0) + row.value;
      days.set(date, day);
    }
  }

  return {
    sourceId: connection.id, currency, metrics, observedDays,
    series: [...days.values()].sort((a, b) => a.date.localeCompare(b.date)), notices,
  };
}

export function buildMeasurementAnalytics(input: {
  workspaceId: string;
  range: AnalyticsRangeInternal;
  snapshot: MeasurementSnapshot;
  now: Date;
}): MeasurementAnalyticsResponse {
  const { workspaceId, range, snapshot, now } = input;
  if (!workspaceId.trim()) throw new Error("workspace_id_required");
  const connections = snapshot.connections.filter((row) => row.workspaceId === workspaceId
    && (MEASUREMENT_PLATFORMS as readonly string[]).includes(row.platform)).slice(0, MAX_MEASUREMENT_SOURCES);
  const byId = new Map(connections.map((row) => [row.id, row]));
  const limited = snapshot.facts.length > MAX_MEASUREMENT_FACTS || snapshot.connections.length > MAX_MEASUREMENT_SOURCES;
  const facts = snapshot.facts.slice(0, MAX_MEASUREMENT_FACTS).filter((row) => {
    if (row.workspaceId !== workspaceId || row.staleAt !== null || row.date < range.from || row.date >= range.toExclusive) return false;
    if (!(MEASUREMENT_PLATFORMS as readonly string[]).includes(row.platform)) return false;
    if (row.connectionId === null) return row.platform === "ga4";
    return byId.get(row.connectionId)?.platform === row.platform;
  });
  const sources = connections.map((connection): MeasurementSource => {
    const rows = facts.filter((row) => row.connectionId === connection.id);
    const dates = rows.map((row) => analyticsDayKey(row.date)).sort();
    return {
      id: connection.id,
      platform: connection.platform as MeasurementPlatform,
      name: (connection.displayName ?? connection.externalAccountId).slice(0, 160),
      accountId: connection.externalAccountId.slice(0, 160),
      connectionState: connection.status === "connected" || connection.status === "error" || connection.status === "revoked" ? connection.status : "unknown",
      lastSuccessfulSyncAt: connection.lastSuccessfulSyncAt?.toISOString() ?? null,
      lastStoredAt: latestStored(rows),
      observedFrom: dates[0] ?? null, observedTo: dates.at(-1) ?? null,
    };
  });
  const ga4Facts = facts.filter((row) => row.platform === "ga4"
    && (row.metric === "sessions" || row.metric === "conversions") && Number.isFinite(row.value) && row.value >= 0)
    .sort((a, b) => b.date.getTime() - a.date.getTime() || a.id.localeCompare(b.id));

  return {
    schemaVersion: MEASUREMENT_SCHEMA_VERSION, generatedAt: now.toISOString(),
    range: analyticsRangeParams(range), sources, limited,
    ga4: {
      state: ga4Facts.length ? "observations_only" : "empty",
      observationCount: ga4Facts.length,
      observationsLimited: limited || ga4Facts.length > MAX_GA4_OBSERVATIONS,
      lastStoredAt: latestStored(ga4Facts),
      // The legacy GA4 writer drops property identity and collapses unnamed
      // campaign dimensions. Preserve exact rows, never infer property totals.
      observations: ga4Facts.slice(0, MAX_GA4_OBSERVATIONS).map((row) => ({
        id: row.id, date: analyticsDayKey(row.date), sourceId: row.connectionId,
        campaign: row.campaign ? row.campaign.slice(0, 160) : null,
        metric: row.metric as "sessions" | "conversions",
        // Existing facts cannot distinguish explicit provider zero from the
        // legacy normalizer's missing-value coercion, even after a new sync.
        value: row.value === 0 ? null : row.value,
      })),
    },
    paid: {
      accounts: connections.filter((row) => row.platform !== "ga4").map((connection) => paidAccount(
        connection, facts.filter((row) => row.connectionId === connection.id), limited,
      )),
    },
    appsFlyer: { state: "unavailable" },
  };
}

export interface MeasurementAnalyticsDependencies {
  readSnapshot(workspaceId: string, range: AnalyticsRangeInternal): Promise<MeasurementSnapshot>;
  now(): Date;
}

const defaultDependencies: MeasurementAnalyticsDependencies = {
  async readSnapshot(workspaceId, range) {
    const queries = measurementQueries(workspaceId, range);
    const [connections, facts] = await prisma.$transaction([
      prisma.connection.findMany(queries.connections),
      prisma.metricFact.findMany(queries.facts),
    ], { isolationLevel: "RepeatableRead" });
    return { connections, facts };
  },
  now: () => new Date(),
};

export async function readMeasurementAnalytics(
  workspaceId: string,
  range: AnalyticsRangeInternal,
  dependencies: MeasurementAnalyticsDependencies = defaultDependencies,
): Promise<MeasurementAnalyticsResponse> {
  if (!workspaceId.trim()) throw new Error("workspace_id_required");
  const snapshot = await dependencies.readSnapshot(workspaceId, range);
  return buildMeasurementAnalytics({ workspaceId, range, snapshot, now: dependencies.now() });
}
