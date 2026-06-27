import type { MetricFactRow } from "./source";

/**
 * The unified "all campaigns across all platforms" dataset — the data behind the
 * workspace dashboard. Built from the SAME MetricFact rows the agent reads, but
 * shaped for a Looker-style command center: blended totals, a per-day time
 * series (for the trend chart + KPI sparklines), a per-platform breakdown, and a
 * browsable/sortable per-campaign table where each campaign also carries its own
 * daily series for drill-down.
 *
 * Rates (ROAS, CPA, CTR, CPC, CPM, CVR, AOV) are DERIVED from summed components
 * when available (more correct than averaging per-row rates), falling back to
 * stored rate rows otherwise. The builder NEVER fabricates: a metric with no
 * underlying rows resolves to 0, and missing days in the axis are real zeros.
 */

/** Blended, range-wide totals with every derived KPI the table can show. */
export interface DashTotals {
  spend: number;
  revenue: number;
  conversions: number;
  clicks: number;
  impressions: number;
  roas: number;
  cpa: number;
  ctr: number;
  cpc: number;
  cpm: number;
  cvr: number;
  aov: number;
}

/** One day on the time axis — additive metrics summed, ROAS derived. */
export interface DashDailyPoint {
  /** UTC calendar day, `yyyy-mm-dd`. */
  date: string;
  spend: number;
  revenue: number;
  conversions: number;
  clicks: number;
  impressions: number;
  roas: number;
}

export interface DashPlatform {
  platform: string;
  label: string;
  spend: number;
  revenue: number;
  conversions: number;
  clicks: number;
  impressions: number;
  roas: number;
  cpa: number;
}

export interface DashCampaign {
  platform: string;
  label: string;
  campaign: string;
  spend: number;
  revenue: number;
  conversions: number;
  clicks: number;
  impressions: number;
  roas: number;
  cpa: number;
  ctr: number;
  cpc: number;
  cpm: number;
  cvr: number;
  aov: number;
  /** Config metadata (Phase 3) — null until campaign-meta sync populates it. */
  status: string | null;
  objective: string | null;
  budget: number | null;
  budgetType: string | null;
  /** This campaign's own daily series across the range (for the drill-down). */
  series: DashDailyPoint[];
  /** This campaign's ads + creatives (last sync window) — empty until ad-sync runs. */
  ads: DashAd[];
}

/** One ad + its creative + a recent performance snapshot (for the drill-down). */
export interface DashAd {
  externalId: string;
  name: string;
  status: string | null;
  creativeType: string | null;
  thumbnailUrl: string | null;
  title: string | null;
  body: string | null;
  callToAction: string | null;
  linkUrl: string | null;
  spend: number;
  impressions: number;
  clicks: number;
  conversions: number;
  ctr: number;
  cpc: number;
  cpa: number;
}

/** The window the payload covers, echoed so the UI never hardcodes "30 days". */
export interface DashRange {
  /** Inclusive UTC start day, `yyyy-mm-dd`. */
  from: string;
  /** Inclusive UTC end day, `yyyy-mm-dd`. */
  to: string;
  /** Number of calendar days in the window (axis length). */
  days: number;
}

export interface DashboardData {
  totals: DashTotals;
  /** Same-length window immediately preceding `range`, for KPI deltas. */
  previous: DashTotals;
  /** Workspace-wide daily totals across the range (sum of series == totals). */
  series: DashDailyPoint[];
  platforms: DashPlatform[];
  campaigns: DashCampaign[];
  range: DashRange;
}

/** Optional per-campaign config, joined in by the Phase-3 campaign-meta sync. */
export interface CampaignMeta {
  status?: string | null;
  objective?: string | null;
  budget?: number | null;
  budgetType?: string | null;
}

const PLATFORM_LABEL: Record<string, string> = {
  google_ads: "Google Ads",
  ga4: "GA4",
  meta_ads: "Meta",
  tiktok_ads: "TikTok",
  linkedin_ads: "LinkedIn",
  search_console: "Search Console",
  pinterest_ads: "Pinterest",
  snapchat_ads: "Snapchat",
  reddit_ads: "Reddit",
  x_ads: "X",
  amazon_ads: "Amazon Ads",
  microsoft_ads: "Microsoft Ads",
  apple_search_ads: "Apple Search Ads",
};

function platformLabel(p: string): string {
  return PLATFORM_LABEL[p] ?? p;
}

/** Composite key for a campaign across platforms (campaign names contain spaces). */
const KEY_SEP = "␟"; // ␟ — a separator that can't appear in a campaign name
export function campaignKey(platform: string, campaign: string): string {
  return `${platform}${KEY_SEP}${campaign}`;
}

interface Agg {
  spend: number;
  revenue: number;
  conversions: number;
  clicks: number;
  impressions: number;
  roasSum: number;
  roasN: number;
  cpaSum: number;
  cpaN: number;
}

const newAgg = (): Agg => ({
  spend: 0,
  revenue: 0,
  conversions: 0,
  clicks: 0,
  impressions: 0,
  roasSum: 0,
  roasN: 0,
  cpaSum: 0,
  cpaN: 0,
});

function bump(a: Agg, metric: string, value: number): void {
  const m = metric.toLowerCase();
  if (m === "spend" || m === "cost") a.spend += value;
  else if (m === "revenue" || m === "conversion_value" || m === "conv_value") a.revenue += value;
  else if (m === "conversions" || m === "conv") a.conversions += value;
  else if (m === "clicks") a.clicks += value;
  else if (m === "impressions" || m === "impr") a.impressions += value;
  else if (m === "roas") {
    a.roasSum += value;
    a.roasN += 1;
  } else if (m === "cpa") {
    a.cpaSum += value;
    a.cpaN += 1;
  }
}

function roasOf(a: Agg): number {
  if (a.spend > 0 && a.revenue > 0) return round(a.revenue / a.spend, 2);
  return a.roasN > 0 ? round(a.roasSum / a.roasN, 2) : 0;
}
function cpaOf(a: Agg): number {
  if (a.conversions > 0 && a.spend > 0) return round(a.spend / a.conversions, 2);
  return a.cpaN > 0 ? round(a.cpaSum / a.cpaN, 2) : 0;
}
function ctrOf(a: Agg): number {
  return a.impressions > 0 ? round((a.clicks / a.impressions) * 100, 2) : 0;
}
function cpcOf(a: Agg): number {
  return a.clicks > 0 ? round(a.spend / a.clicks, 2) : 0;
}
function cpmOf(a: Agg): number {
  return a.impressions > 0 ? round((a.spend / a.impressions) * 1000, 2) : 0;
}
function cvrOf(a: Agg): number {
  return a.clicks > 0 ? round((a.conversions / a.clicks) * 100, 2) : 0;
}
function aovOf(a: Agg): number {
  return a.conversions > 0 ? round(a.revenue / a.conversions, 2) : 0;
}

function round(n: number, dp: number): number {
  const f = 10 ** dp;
  return Math.round(n * f) / f;
}

function totalsFrom(a: Agg): DashTotals {
  return {
    spend: round(a.spend, 2),
    revenue: round(a.revenue, 2),
    conversions: round(a.conversions, 0),
    clicks: round(a.clicks, 0),
    impressions: round(a.impressions, 0),
    roas: roasOf(a),
    cpa: cpaOf(a),
    ctr: ctrOf(a),
    cpc: cpcOf(a),
    cpm: cpmOf(a),
    cvr: cvrOf(a),
    aov: aovOf(a),
  };
}

function pointFrom(a: Agg, date: string): DashDailyPoint {
  return {
    date,
    spend: round(a.spend, 2),
    revenue: round(a.revenue, 2),
    conversions: round(a.conversions, 0),
    clicks: round(a.clicks, 0),
    impressions: round(a.impressions, 0),
    roas: roasOf(a),
  };
}

/** UTC calendar day key for a stored MetricFact date. */
function dayKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Inclusive [from, to] axis of `yyyy-mm-dd` UTC day keys (capped for safety). */
function dateAxis(from: Date, to: Date): string[] {
  const out: string[] = [];
  const cur = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate()));
  const end = Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), to.getUTCDate());
  // Hard cap at ~2 years so a malformed range can never blow up the response.
  for (let i = 0; i < 800 && cur.getTime() <= end; i += 1) {
    out.push(cur.toISOString().slice(0, 10));
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
  return out;
}

/** Sum every row into a single Agg → blended totals (used for the previous period). */
export function aggregateTotals(rows: MetricFactRow[]): DashTotals {
  const a = newAgg();
  for (const r of rows) bump(a, r.metric, r.value);
  return totalsFrom(a);
}

/**
 * Build the full dashboard dataset for a workspace over an explicit window.
 *
 * `range` is the inclusive [from, to] the rows were read for; it drives the
 * time axis so the chart and KPI sparklines have one continuous series with
 * real zeros on days that had no activity. `meta` optionally joins per-campaign
 * config (status/budget/objective) when the Phase-3 sync has populated it.
 */
export function buildDashboard(
  rows: MetricFactRow[],
  range: { from: Date; to: Date },
  meta?: Map<string, CampaignMeta>,
  adsByCampaign?: Map<string, DashAd[]>,
): DashboardData {
  const axis = dateAxis(range.from, range.to);
  const axisSet = new Set(axis);

  const global = newAgg();
  const globalByDay = new Map<string, Agg>();
  const byPlatform = new Map<string, Agg>();
  const byCampaign = new Map<
    string,
    { platform: string; campaign: string; agg: Agg; byDay: Map<string, Agg> }
  >();

  const ensureDay = (m: Map<string, Agg>, day: string): Agg => {
    const a = m.get(day) ?? newAgg();
    m.set(day, a);
    return a;
  };

  for (const r of rows) {
    const day = dayKey(r.date);
    // Defensive: ignore rows outside the requested axis (e.g. a boundary row).
    if (!axisSet.has(day)) continue;

    bump(global, r.metric, r.value);
    bump(ensureDay(globalByDay, day), r.metric, r.value);

    const p = byPlatform.get(r.platform) ?? newAgg();
    bump(p, r.metric, r.value);
    byPlatform.set(r.platform, p);

    const campaign = r.campaign && r.campaign.length > 0 ? r.campaign : "";
    if (campaign) {
      const key = campaignKey(r.platform, campaign);
      const c =
        byCampaign.get(key) ??
        { platform: r.platform, campaign, agg: newAgg(), byDay: new Map<string, Agg>() };
      bump(c.agg, r.metric, r.value);
      bump(ensureDay(c.byDay, day), r.metric, r.value);
      byCampaign.set(key, c);
    }
  }

  const series: DashDailyPoint[] = axis.map((day) => pointFrom(globalByDay.get(day) ?? newAgg(), day));

  const platforms: DashPlatform[] = [...byPlatform.entries()]
    .map(([platform, a]) => ({
      platform,
      label: platformLabel(platform),
      spend: round(a.spend, 2),
      revenue: round(a.revenue, 2),
      conversions: round(a.conversions, 0),
      clicks: round(a.clicks, 0),
      impressions: round(a.impressions, 0),
      roas: roasOf(a),
      cpa: cpaOf(a),
    }))
    .sort((x, y) => y.spend - x.spend);

  const campaigns: DashCampaign[] = [...byCampaign.values()]
    .map(({ platform, campaign, agg, byDay }) => {
      const m = meta?.get(campaignKey(platform, campaign));
      return {
        platform,
        label: platformLabel(platform),
        campaign,
        spend: round(agg.spend, 2),
        revenue: round(agg.revenue, 2),
        conversions: round(agg.conversions, 0),
        clicks: round(agg.clicks, 0),
        impressions: round(agg.impressions, 0),
        roas: roasOf(agg),
        cpa: cpaOf(agg),
        ctr: ctrOf(agg),
        cpc: cpcOf(agg),
        cpm: cpmOf(agg),
        cvr: cvrOf(agg),
        aov: aovOf(agg),
        status: m?.status ?? null,
        objective: m?.objective ?? null,
        budget: m?.budget ?? null,
        budgetType: m?.budgetType ?? null,
        series: axis.map((day) => pointFrom(byDay.get(day) ?? newAgg(), day)),
        ads: adsByCampaign?.get(campaignKey(platform, campaign)) ?? [],
      };
    })
    .sort((x, y) => y.spend - x.spend);

  return {
    totals: totalsFrom(global),
    previous: totalsFrom(newAgg()),
    series,
    platforms,
    campaigns,
    range: { from: axis[0] ?? dayKey(range.from), to: axis[axis.length - 1] ?? dayKey(range.to), days: axis.length },
  };
}

/** A realistic sample dashboard for DEMO_MODE / the offline preview. */
export function sampleDashboard(): DashboardData {
  const seeds: Array<{
    platform: string;
    campaign: string;
    spend: number;
    revenue: number;
    conversions: number;
    clicks: number;
    impressions: number;
    status: string;
    objective: string;
    budget: number;
  }> = [
    { platform: "google_ads", campaign: "Brand — Exact", spend: 4200, revenue: 23100, conversions: 200, clicks: 5400, impressions: 121000, status: "active", objective: "Search", budget: 180 },
    { platform: "google_ads", campaign: "Non-brand — Prospecting", spend: 6100, revenue: 18300, conversions: 160, clicks: 7200, impressions: 240000, status: "active", objective: "Search", budget: 250 },
    { platform: "meta_ads", campaign: "Retargeting — DPA", spend: 3100, revenue: 15500, conversions: 129, clicks: 9100, impressions: 410000, status: "active", objective: "Sales", budget: 120 },
    { platform: "meta_ads", campaign: "Cold — Lookalike 1%", spend: 5200, revenue: 9360, conversions: 80, clicks: 6400, impressions: 520000, status: "paused", objective: "Sales", budget: 200 },
    { platform: "tiktok_ads", campaign: "Spark Ads — UGC", spend: 2800, revenue: 7000, conversions: 70, clicks: 8800, impressions: 690000, status: "active", objective: "Conversions", budget: 100 },
    { platform: "linkedin_ads", campaign: "ABM — Enterprise", spend: 3600, revenue: 5400, conversions: 30, clicks: 2100, impressions: 88000, status: "active", objective: "Lead gen", budget: 130 },
  ];

  const DAYS = 30;
  const to = new Date();
  to.setUTCHours(0, 0, 0, 0);
  const from = new Date(to);
  from.setUTCDate(from.getUTCDate() - (DAYS - 1));

  // Deterministic intra-period shape (a gentle mid-period bump) so the demo
  // charts read like real spend curves without any randomness.
  const weights = Array.from({ length: DAYS }, (_, i) => 1 + 0.45 * Math.sin((i / (DAYS - 1)) * Math.PI));
  const wSum = weights.reduce((s, w) => s + w, 0);

  const rows: MetricFactRow[] = [];
  const meta = new Map<string, CampaignMeta>();
  const adsByCampaign = new Map<string, DashAd[]>();
  for (const s of seeds) {
    meta.set(campaignKey(s.platform, s.campaign), {
      status: s.status,
      objective: s.objective,
      budget: s.budget,
      budgetType: "daily",
    });
    for (let i = 0; i < DAYS; i += 1) {
      const d = new Date(from);
      d.setUTCDate(d.getUTCDate() + i);
      const f = weights[i] / wSum;
      const add = (metric: string, total: number) =>
        rows.push({ platform: s.platform, campaign: s.campaign, metric, value: total * f, date: new Date(d) });
      add("spend", s.spend);
      add("revenue", s.revenue);
      add("conversions", s.conversions);
      add("clicks", s.clicks);
      add("impressions", s.impressions);
    }
    // Two illustrative creatives per campaign (60/40 split) for the demo.
    const ad = (suffix: string, share: number, title: string, body: string, cta: string, status: string): DashAd => {
      const spend = round(s.spend * share, 2);
      const impressions = round(s.impressions * share, 0);
      const clicks = round(s.clicks * share, 0);
      const conversions = round(s.conversions * share, 0);
      return {
        externalId: `${s.campaign}-${suffix}`,
        name: `${s.campaign} · ${suffix}`,
        status,
        creativeType: suffix === "Video" ? "video" : "image",
        thumbnailUrl: null,
        title,
        body,
        callToAction: cta,
        linkUrl: null,
        spend,
        impressions,
        clicks,
        conversions,
        ctr: impressions > 0 ? round((clicks / impressions) * 100, 2) : 0,
        cpc: clicks > 0 ? round(spend / clicks, 2) : 0,
        cpa: conversions > 0 ? round(spend / conversions, 2) : 0,
      };
    };
    adsByCampaign.set(campaignKey(s.platform, s.campaign), [
      ad("Static A", 0.6, "Your best month yet", "See why 10k teams switched this quarter.", "Learn More", s.status),
      ad("Video", 0.4, "30s product tour", "Watch how it works in under a minute.", "Sign Up", "active"),
    ]);
  }

  const data = buildDashboard(rows, { from, to }, meta, adsByCampaign);
  // Show a believable prior-period delta on the sample KPIs (≈ +9% spend).
  const prev = newAgg();
  prev.spend = data.totals.spend * 0.915;
  prev.revenue = data.totals.revenue * 0.88;
  prev.conversions = data.totals.conversions * 0.93;
  prev.clicks = data.totals.clicks * 0.96;
  prev.impressions = data.totals.impressions * 0.98;
  data.previous = totalsFrom(prev);
  return data;
}
