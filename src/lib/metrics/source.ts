import type { Campaign, MetricFact } from "@prisma/client";

import { prisma, isDatabaseConfigured } from "@/lib/db";
import type { MetricsSource } from "@/lib/agent/tools";

/**
 * DB-backed MetricsSource (Stack B, architecture §4/§6). Server-only.
 *
 * This is the real-data implementation of the same MetricsSource interface the
 * agent already reads through (src/lib/agent/tools.ts). The agent keeps calling
 * get_account_metrics — internal-first is untouched; ONLY the data source
 * changes. getAccountMetrics() aggregates this workspace's MetricFact rows over
 * a recent window and serializes them to the SAME human-readable shape the model
 * expects from serializeArtifacts (compact "Label value" lines).
 *
 * Graceful-without-keys (mirrors src/lib/db.ts / provider.ts): importing this
 * module never touches the database. The prisma query is injected behind the
 * MetricFactQuery seam (default: a real prisma read), so:
 *   • tests can stub the query and exercise the serializer with NO live DB;
 *   • the route only ever constructs this source after hasLiveData() confirms a
 *     DB is configured AND has rows — never on the offline path.
 *
 * EU-first: no region is referenced here; residency is a property of the
 * DATABASE_URL deployment, not this code.
 */

/** Recent window (days) aggregated for an internal read. */
export const RECENT_WINDOW_DAYS = 30;

/** Minimal row shape the serializer needs — a structural subset of MetricFact. */
export type MetricFactRow = Pick<
  MetricFact,
  "platform" | "campaign" | "metric" | "value" | "date"
>;

/**
 * The injectable read seam. Returns the workspace's recent MetricFact rows
 * (most recent first is not required — the aggregator is order-independent).
 * The default reads prisma; tests pass a stub returning fixed rows.
 */
export type MetricFactQuery = (
  workspaceId: string,
  since: Date,
) => Promise<MetricFactRow[]>;

export const defaultMetricFactQuery: MetricFactQuery = (workspaceId, since) =>
  prisma.metricFact.findMany({
    where: { workspaceId, date: { gte: since } },
    select: { platform: true, campaign: true, metric: true, value: true, date: true },
  });

/** Default existence probe: any MetricFact row for this workspace at all. */
const defaultCount = (workspaceId: string): Promise<number> =>
  prisma.metricFact.count({ where: { workspaceId } });

/** Human-readable platform labels (canonical id → display name). */
const PLATFORM_LABEL: Record<string, string> = {
  google_ads: "Google Ads",
  ga4: "GA4",
  meta_ads: "Meta Ads",
  tiktok_ads: "TikTok Ads",
  linkedin_ads: "LinkedIn Ads",
  search_console: "Search Console",
};

function platformLabel(platform: string): string {
  return PLATFORM_LABEL[platform] ?? platform;
}

/** Metrics that are RATES (averaged across rows) rather than additive sums. */
const RATE_METRICS = new Set(["roas", "cpa", "ctr", "cvr", "cpc"]);

/** Format a metric value the way the model expects to read it. */
function formatMetric(metric: string, value: number): string {
  const m = metric.toLowerCase();
  if (m === "roas") return `${round(value, 2)}×`;
  if (m === "ctr" || m === "cvr") return `${round(value, 1)}%`;
  if (m === "spend" || m === "revenue" || m === "cpa" || m === "cpc") {
    return "€" + round(value, 2).toLocaleString("en-US");
  }
  // counts (conversions, clicks, impressions, …)
  return round(value, 0).toLocaleString("en-US");
}

function round(n: number, dp: number): number {
  const f = 10 ** dp;
  return Math.round(n * f) / f;
}

interface Aggregate {
  sum: number;
  count: number;
  isRate: boolean;
}

/**
 * Reduce raw rows into per-platform headline metrics + per-campaign breakdowns.
 * Sums additive metrics; averages rate metrics.
 *
 * Account-level rows (campaign === "", see prisma/schema.prisma) and
 * campaign-level rows are DISTINCT grains: naively summing both double-counts
 * spend. So the platform headline is built from account-level rows when they
 * exist; only metrics that have NO account-level row fall back to rolling up
 * their campaign rows (so the headline is never silently empty). Campaign rows
 * are always surfaced as an itemized breakdown beneath the headline.
 */
function aggregate(rows: MetricFactRow[]) {
  // platform → metric → Aggregate, from account-level ("") rows only
  const accountByPlatform = new Map<string, Map<string, Aggregate>>();
  // platform → metric → Aggregate, rolled up from campaign rows (fallback)
  const campaignRollup = new Map<string, Map<string, Aggregate>>();
  // platform → campaign → metric → Aggregate (itemized breakdown)
  const byCampaign = new Map<string, Map<string, Map<string, Aggregate>>>();

  const bump = (agg: Map<string, Aggregate>, metric: string, value: number) => {
    const isRate = RATE_METRICS.has(metric.toLowerCase());
    const cur = agg.get(metric) ?? { sum: 0, count: 0, isRate };
    cur.sum += value;
    cur.count += 1;
    agg.set(metric, cur);
  };

  const ensure = <V>(m: Map<string, V>, k: string, make: () => V): V => {
    const v = m.get(k) ?? make();
    m.set(k, v);
    return v;
  };

  for (const r of rows) {
    const campaign = r.campaign && r.campaign.length > 0 ? r.campaign : "";
    if (campaign) {
      bump(ensure(campaignRollup, r.platform, () => new Map()), r.metric, r.value);
      const campaigns = ensure(byCampaign, r.platform, () => new Map<string, Map<string, Aggregate>>());
      bump(ensure(campaigns, campaign, () => new Map()), r.metric, r.value);
    } else {
      bump(ensure(accountByPlatform, r.platform, () => new Map()), r.metric, r.value);
    }
  }

  // Merge headline = account-level rows, plus campaign rollups ONLY for metrics
  // with no account-level row on that platform.
  const byPlatform = new Map<string, Map<string, Aggregate>>();
  const platforms = new Set([...accountByPlatform.keys(), ...campaignRollup.keys()]);
  for (const platform of platforms) {
    const headline = new Map<string, Aggregate>(accountByPlatform.get(platform) ?? []);
    const rollup = campaignRollup.get(platform);
    if (rollup) {
      for (const [metric, agg] of rollup) {
        if (!headline.has(metric)) headline.set(metric, agg);
      }
    }
    byPlatform.set(platform, headline);
  }

  return { byPlatform, byCampaign };
}

function resolve(agg: Aggregate): number {
  return agg.isRate && agg.count > 0 ? agg.sum / agg.count : agg.sum;
}

function metricsLine(metrics: Map<string, Aggregate>, only?: Set<string>): string {
  const parts: string[] = [];
  for (const [metric, agg] of metrics) {
    if (only && !only.has(metric.toLowerCase())) continue;
    parts.push(`${metric} ${formatMetric(metric, resolve(agg))}`);
  }
  return parts.join(", ");
}

/**
 * Serialize aggregated rows into the compact, model-readable block the agent
 * expects from an internal read — same spirit/shape as serializeArtifacts.
 * `sections` optionally restricts the metrics surfaced (the tool's `sections`
 * arg), matching get_account_metrics' contract.
 */
export function serializeMetricFacts(
  rows: MetricFactRow[],
  sections?: string[],
  windowDays = RECENT_WINDOW_DAYS,
): string {
  if (rows.length === 0) return "(no internal data available)";

  const only =
    sections && sections.length > 0
      ? new Set(sections.map((s) => s.toLowerCase()))
      : undefined;

  const { byPlatform, byCampaign } = aggregate(rows);
  const lines: string[] = [`Connected-account metrics (last ${windowDays} days):`];

  for (const [platform, metrics] of byPlatform) {
    const headline = metricsLine(metrics, only);
    if (headline) lines.push(`${platformLabel(platform)} — ${headline}`);

    const campaigns = byCampaign.get(platform);
    if (campaigns) {
      for (const [campaign, cMetrics] of campaigns) {
        const cLine = metricsLine(cMetrics, only);
        if (cLine) lines.push(`  • ${campaign}: ${cLine}`);
      }
    }
  }

  // If a section filter eliminated every metric, fall back to the unfiltered
  // view rather than returning an empty (and misleading) block.
  if (lines.length === 1) return serializeMetricFacts(rows, undefined, windowDays);

  return lines.join("\n");
}

/**
 * Build a DB-backed MetricsSource for a workspace. The agent reads through it
 * exactly as it reads the canned source — getAccountMetrics(sections?) returns
 * a model-readable string. Synchronous interface, so we read the recent window
 * eagerly at construction (await createDbMetricsSource) and serialize on demand.
 *
 * The `query` override exists for tests (stub the prisma read); production omits
 * it and uses the real prisma findMany.
 */
export async function createDbMetricsSource(
  workspaceId: string,
  query: MetricFactQuery = defaultMetricFactQuery,
  windowDays = RECENT_WINDOW_DAYS,
): Promise<MetricsSource> {
  const since = windowStart(windowDays);
  const rows = await query(workspaceId, since);
  return {
    getAccountMetrics(sections?: string[]): string {
      return serializeMetricFacts(rows, sections, windowDays);
    },
  };
}

/** Read the same recent MetricFact rows used by the agent for visual artifacts. */
export async function readRecentMetricFacts(
  workspaceId: string,
  query: MetricFactQuery = defaultMetricFactQuery,
  windowDays = RECENT_WINDOW_DAYS,
): Promise<MetricFactRow[]> {
  return query(workspaceId, windowStart(windowDays));
}

/**
 * Read this workspace's MetricFact rows for an explicit [from, to] window
 * (inclusive, UTC). Powers the dashboard's date-range picker. A direct prisma
 * read — the MetricFactQuery seam above exists for the agent's recent-window
 * source; the dashboard needs both bounds, so it reads directly.
 */
export async function readMetricFactsRange(
  workspaceId: string,
  from: Date,
  to: Date,
): Promise<MetricFactRow[]> {
  return prisma.metricFact.findMany({
    where: { workspaceId, date: { gte: from, lte: to } },
    select: { platform: true, campaign: true, metric: true, value: true, date: true },
    orderBy: { date: "asc" },
  });
}

/** Per-campaign config (status/budget/objective) for the dashboard join. */
export type CampaignConfigRow = Pick<
  Campaign,
  "platform" | "externalId" | "name" | "status" | "objective" | "budget" | "budgetType"
>;

/**
 * Read this workspace's campaign config rows (Phase 3). Used by the dashboard to
 * decorate performance rows with status/budget/objective. Separate from
 * MetricFact: config is the campaign entity, performance is per-day facts.
 */
export async function readCampaignConfig(workspaceId: string): Promise<CampaignConfigRow[]> {
  return prisma.campaign.findMany({
    where: { workspaceId },
    select: {
      platform: true,
      externalId: true,
      name: true,
      status: true,
      objective: true,
      budget: true,
      budgetType: true,
    },
  });
}

/**
 * True when this workspace has live, DB-backed metrics to serve. Two gates:
 *   1. a database must be configured (DATABASE_URL present) — never query an
 *      unconfigured DB, which keeps the offline path byte-compatible with today;
 *   2. at least one MetricFact row exists for the workspace.
 * Any error (DB unreachable, table missing) is swallowed → returns false → the
 * route falls back to the labelled Sample path. Never throws.
 */
export async function hasLiveData(
  workspaceId: string,
  count: (workspaceId: string) => Promise<number> = defaultCount,
): Promise<boolean> {
  if (!isDatabaseConfigured()) return false;
  try {
    return (await count(workspaceId)) > 0;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[metrics] hasLiveData probe failed, treating as no live data: ${msg}`);
    return false;
  }
}

/** Start of the recent aggregation window (UTC, `windowDays` ago, midnight). */
function windowStart(windowDays: number): Date {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - windowDays);
  d.setUTCHours(0, 0, 0, 0);
  return d;
}
