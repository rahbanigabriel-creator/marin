import { NextResponse } from "next/server";

import { getCurrentWorkspace } from "@/lib/auth";
import { hasLiveData, readAds, readCampaignConfig, readMetricFactsRange } from "@/lib/metrics/source";
import {
  aggregateTotals,
  buildDashboard,
  campaignKey,
  sampleDashboard,
  type CampaignMeta,
  type DashAd,
  type DashboardData,
  type DashTotals,
} from "@/lib/metrics/dashboard";

export const runtime = "nodejs";

const DEMO_MODE = process.env.NEXT_PUBLIC_MARPIN_DEMO_MODE === "true";

/** Default window when the client sends no range. */
const DEFAULT_DAYS = 30;
/** Guard rails on the requested window length. */
const MAX_DAYS = 365;

const ZERO_TOTALS: DashTotals = {
  spend: 0, revenue: 0, conversions: 0, clicks: 0, impressions: 0,
  roas: 0, cpa: 0, ctr: 0, cpc: 0, cpm: 0, cvr: 0, aov: 0,
};

function emptyDashboard(from: Date, to: Date): DashboardData {
  return buildDashboard([], { from, to });
}

/** Midnight-UTC today. */
function todayUtc(): Date {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

/** Parse a `yyyy-mm-dd` query param to a UTC-midnight Date, or null if invalid. */
function parseDay(raw: string | null): Date | null {
  if (!raw) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw.trim());
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const day = Number(m[3]);
  const d = new Date(Date.UTC(y, mo - 1, day));
  // Reject out-of-range components that JS would otherwise roll over (e.g.
  // 2026-13-45 → 2027-02-14), which would silently shift the window.
  if (Number.isNaN(d.getTime()) || d.getUTCFullYear() !== y || d.getUTCMonth() !== mo - 1 || d.getUTCDate() !== day) {
    return null;
  }
  return d;
}

function daysBetween(from: Date, to: Date): number {
  return Math.round((to.getTime() - from.getTime()) / 86_400_000) + 1;
}

/** Resolve and clamp the requested [from, to] window (inclusive, UTC midnight). */
function resolveRange(url: URL): { from: Date; to: Date } {
  const today = todayUtc();
  let to = parseDay(url.searchParams.get("to")) ?? today;
  let from = parseDay(url.searchParams.get("from"));
  if (!from) {
    from = new Date(to);
    from.setUTCDate(from.getUTCDate() - (DEFAULT_DAYS - 1));
  }
  // Never let the window run into the future, and keep from <= to.
  if (to.getTime() > today.getTime()) to = today;
  if (from.getTime() > to.getTime()) from = new Date(to);
  // Clamp the span to MAX_DAYS (trim the start).
  if (daysBetween(from, to) > MAX_DAYS) {
    from = new Date(to);
    from.setUTCDate(from.getUTCDate() - (MAX_DAYS - 1));
  }
  return { from, to };
}

/**
 * Load per-campaign config and key it for the dashboard join. MetricFact keys
 * performance by campaign NAME (Google/Meta) or ID (TikTok/LinkedIn), so we map
 * BOTH name→config and externalId→config to the same row — the builder's
 * campaignKey lookup then matches regardless of which the platform stored.
 * Best-effort: any failure (e.g. table absent) yields no decoration, never an
 * error — the dashboard still renders with null config.
 */
async function loadCampaignMeta(workspaceId: string): Promise<Map<string, CampaignMeta> | undefined> {
  try {
    const rows = await readCampaignConfig(workspaceId);
    if (rows.length === 0) return undefined;
    const map = new Map<string, CampaignMeta>();
    for (const r of rows) {
      const m: CampaignMeta = {
        status: r.status,
        objective: r.objective,
        budget: r.budget,
        budgetType: r.budgetType,
      };
      if (r.name) map.set(campaignKey(r.platform, r.name), m);
      if (r.externalId) map.set(campaignKey(r.platform, r.externalId), m);
    }
    return map;
  } catch (err) {
    console.warn("[dashboard] campaign config unavailable, rendering without it", err);
    return undefined;
  }
}

/**
 * Load this workspace's ads grouped by campaign. The dashboard joins ads onto
 * campaigns via the value MetricFact stores in `campaign` — for Meta (the only
 * platform with fetchAds today) that's the campaign NAME, so the name key is the
 * one that actually fires. We also index by campaignExternalId as forward-compat
 * for a future platform that stores the id on MetricFact. Best-effort: a missing
 * table / no ads yields no creatives, never an error.
 */
async function loadAds(workspaceId: string): Promise<Map<string, DashAd[]> | undefined> {
  try {
    const rows = await readAds(workspaceId);
    if (rows.length === 0) return undefined;
    const map = new Map<string, DashAd[]>();
    for (const r of rows) {
      const ad: DashAd = {
        externalId: r.externalId,
        name: r.name,
        status: r.status,
        creativeType: r.creativeType,
        thumbnailUrl: r.thumbnailUrl,
        title: r.title,
        body: r.body,
        callToAction: r.callToAction,
        linkUrl: r.linkUrl,
        spend: r.spend ?? 0,
        impressions: r.impressions ?? 0,
        clicks: r.clicks ?? 0,
        conversions: r.conversions ?? 0,
        ctr: r.impressions && r.impressions > 0 ? round2(((r.clicks ?? 0) / r.impressions) * 100) : 0,
        cpc: r.clicks && r.clicks > 0 ? round2((r.spend ?? 0) / r.clicks) : 0,
        cpa: r.conversions && r.conversions > 0 ? round2((r.spend ?? 0) / r.conversions) : 0,
      };
      for (const key of [
        r.campaignName ? campaignKey(r.platform, r.campaignName) : null,
        r.campaignExternalId ? campaignKey(r.platform, r.campaignExternalId) : null,
      ]) {
        if (!key) continue;
        const list = map.get(key) ?? [];
        list.push(ad);
        map.set(key, list);
      }
    }
    // Highest-spend creative first within each campaign.
    for (const list of map.values()) list.sort((a, b) => b.spend - a.spend);
    return map;
  } catch (err) {
    console.warn("[dashboard] ads unavailable, rendering without creatives", err);
    return undefined;
  }
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** The same-length window immediately preceding [from, to]. */
function previousRange(from: Date, to: Date): { from: Date; to: Date } {
  const len = daysBetween(from, to);
  const prevTo = new Date(from);
  prevTo.setUTCDate(prevTo.getUTCDate() - 1);
  const prevFrom = new Date(prevTo);
  prevFrom.setUTCDate(prevFrom.getUTCDate() - (len - 1));
  return { from: prevFrom, to: prevTo };
}

/**
 * The unified campaigns dashboard data — mirrors the chat route's data-mode
 * pattern: "sample" behind the demo flag, "live" from real MetricFact rows, and
 * an honest "empty" otherwise. Never fabricates numbers on the real path.
 *
 * Accepts `?from=yyyy-mm-dd&to=yyyy-mm-dd` (UTC). The response echoes the
 * resolved range and includes the previous same-length window's totals so the
 * client can render KPI deltas without a second request.
 */
export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const { from, to } = resolveRange(url);

  if (DEMO_MODE) {
    return NextResponse.json({ mode: "sample", data: sampleDashboard() });
  }

  try {
    const workspace = await getCurrentWorkspace();
    if (workspace && (await hasLiveData(workspace.id))) {
      const rows = await readMetricFactsRange(workspace.id, from, to);
      const meta = await loadCampaignMeta(workspace.id);
      const ads = await loadAds(workspace.id);
      const data = buildDashboard(rows, { from, to }, meta, ads);

      // Previous same-length window → deltas. Cheap totals-only aggregate.
      const prev = previousRange(from, to);
      const prevRows = await readMetricFactsRange(workspace.id, prev.from, prev.to);
      data.previous = aggregateTotals(prevRows);

      return NextResponse.json({ mode: "live", data });
    }
  } catch (err) {
    console.warn("[dashboard] failed to read live data, returning empty", err);
  }

  const data = emptyDashboard(from, to);
  data.previous = ZERO_TOTALS;
  return NextResponse.json({ mode: "empty", data });
}
