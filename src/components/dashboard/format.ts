import type { DashDailyPoint, DashTotals, DashCampaign } from "@/lib/metrics/dashboard";

/**
 * Shared formatting + column registry for the Campaigns command center. Single
 * source of truth so the KPI tiles, the trend chart, the sortable table, and the
 * drill-down panel all format identically. No fabrication: every number comes
 * straight from the dashboard payload; helpers only format/derive.
 */

/* ── Plain formatters ──────────────────────────────────────────────────── */

/** Integer euros with thousands separators: 4200 → "€4,200". */
export function euro0(n: number): string {
  return "€" + Math.round(n).toLocaleString("en-US");
}
/** Euros with 2dp for small rates: 12.4 → "€12.40". */
export function euro2(n: number): string {
  return "€" + n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
/** Integer count with thousands separators. */
export function num0(n: number): string {
  return Math.round(n).toLocaleString("en-US");
}
/** Compact count for axes/tooltips: 121000 → "121k", 1_200_000 → "1.2M". */
export function compact(n: number): string {
  const abs = Math.abs(n);
  if (abs >= 1_000_000) return (n / 1_000_000).toFixed(n % 1_000_000 === 0 ? 0 : 1) + "M";
  if (abs >= 1_000) return (n / 1_000).toFixed(n % 1_000 === 0 ? 0 : 1) + "k";
  return String(Math.round(n));
}
/** Compact euros for axes: 4200 → "€4.2k". */
export function euroCompact(n: number): string {
  return "€" + compact(n);
}
/** ROAS multiple: 5.5 → "5.5×". */
export function roasX(n: number): string {
  return `${n}×`;
}
/** Percent: 3.61 → "3.61%". */
export function pct(n: number): string {
  return `${n}%`;
}

/** ROAS → semantic ink (green strong / clay mid / crimson weak). */
export function roasColor(roas: number): string {
  if (roas >= 3) return "#4C6B40";
  if (roas >= 1.5) return "#6B6359";
  return "#B23A4B";
}

/* ── Column registry ───────────────────────────────────────────────────── */

/** Every metric column the table / KPIs / drill-down can render. */
export type MetricKey =
  | "spend"
  | "revenue"
  | "roas"
  | "cpa"
  | "conversions"
  | "clicks"
  | "impressions"
  | "ctr"
  | "cpc"
  | "cpm"
  | "cvr"
  | "aov";

export interface ColumnDef {
  key: MetricKey;
  /** Short header label. */
  label: string;
  /** Full name for the column chooser. */
  full: string;
  /** Direction that counts as an improvement (drives delta tone). */
  betterWhen: "up" | "down" | "flat";
  /** Cell/value formatter. */
  fmt: (v: number) => string;
  /** Compact formatter for axis ticks. */
  axisFmt: (v: number) => string;
  /** Colorize the value by ROAS thresholds. */
  roasColored?: boolean;
}

export const COLUMNS: Record<MetricKey, ColumnDef> = {
  spend: { key: "spend", label: "Spend", full: "Spend", betterWhen: "flat", fmt: euro0, axisFmt: euroCompact },
  revenue: { key: "revenue", label: "Revenue", full: "Revenue", betterWhen: "up", fmt: euro0, axisFmt: euroCompact },
  roas: { key: "roas", label: "ROAS", full: "ROAS (revenue ÷ spend)", betterWhen: "up", fmt: roasX, axisFmt: roasX, roasColored: true },
  cpa: { key: "cpa", label: "CPA", full: "Cost per acquisition", betterWhen: "down", fmt: euro2, axisFmt: euroCompact },
  conversions: { key: "conversions", label: "Conv.", full: "Conversions", betterWhen: "up", fmt: num0, axisFmt: compact },
  clicks: { key: "clicks", label: "Clicks", full: "Clicks", betterWhen: "up", fmt: num0, axisFmt: compact },
  impressions: { key: "impressions", label: "Impr.", full: "Impressions", betterWhen: "up", fmt: num0, axisFmt: compact },
  ctr: { key: "ctr", label: "CTR", full: "Click-through rate", betterWhen: "up", fmt: pct, axisFmt: pct },
  cpc: { key: "cpc", label: "CPC", full: "Cost per click", betterWhen: "down", fmt: euro2, axisFmt: euroCompact },
  cpm: { key: "cpm", label: "CPM", full: "Cost per 1,000 impressions", betterWhen: "down", fmt: euro2, axisFmt: euroCompact },
  cvr: { key: "cvr", label: "CVR", full: "Conversion rate", betterWhen: "up", fmt: pct, axisFmt: pct },
  aov: { key: "aov", label: "AOV", full: "Average order value", betterWhen: "up", fmt: euro2, axisFmt: euroCompact },
};

/** Column order for the table + chooser. */
export const COLUMN_ORDER: MetricKey[] = [
  "spend", "revenue", "roas", "cpa", "conversions",
  "clicks", "impressions", "ctr", "cpc", "cpm", "cvr", "aov",
];

/** Columns visible by default (the Google/Meta-Ads-style starter set). */
export const DEFAULT_COLUMNS: MetricKey[] = ["spend", "revenue", "roas", "cpa", "conversions"];

/* ── Derivation from the daily series ──────────────────────────────────── */

/**
 * Value of any metric on a single day, derived from the series point's additive
 * components (so CPA/CTR/CPC/… get a real daily curve, not a flat number).
 */
export function dailyValue(p: DashDailyPoint, key: MetricKey): number {
  switch (key) {
    case "spend": return p.spend;
    case "revenue": return p.revenue;
    case "conversions": return p.conversions;
    case "clicks": return p.clicks;
    case "impressions": return p.impressions;
    case "roas": return p.roas;
    case "cpa": return p.conversions > 0 ? p.spend / p.conversions : 0;
    case "ctr": return p.impressions > 0 ? (p.clicks / p.impressions) * 100 : 0;
    case "cpc": return p.clicks > 0 ? p.spend / p.clicks : 0;
    case "cpm": return p.impressions > 0 ? (p.spend / p.impressions) * 1000 : 0;
    case "cvr": return p.clicks > 0 ? (p.conversions / p.clicks) * 100 : 0;
    case "aov": return p.conversions > 0 ? p.revenue / p.conversions : 0;
    default: return 0;
  }
}

/** Numeric accessor for a campaign row by metric key. */
export function campaignValue(c: DashCampaign, key: MetricKey): number {
  return c[key];
}

/** Numeric accessor for the blended totals by metric key. */
export function totalValue(t: DashTotals, key: MetricKey): number {
  return t[key];
}

/* ── Deltas (vs previous period) ───────────────────────────────────────── */

export type Tone = "good" | "bad" | "neutral";

export interface Delta {
  /** e.g. "+8.2%", "−3.4%", or "—" when there's no prior baseline. */
  label: string;
  tone: Tone;
}

/** Percentage change of `curr` vs `prev`, toned by whether up is better. */
export function deltaFor(key: MetricKey, curr: number, prev: number): Delta {
  if (!prev || prev === 0 || !Number.isFinite(prev)) return { label: "—", tone: "neutral" };
  const change = (curr - prev) / prev;
  if (!Number.isFinite(change)) return { label: "—", tone: "neutral" };
  const sign = change > 0 ? "+" : change < 0 ? "−" : "";
  const label = `${sign}${Math.abs(change * 100).toFixed(1)}%`;
  const better = COLUMNS[key].betterWhen;
  let tone: Tone = "neutral";
  if (better !== "flat" && Math.abs(change) >= 0.0005) {
    const improved = better === "up" ? change > 0 : change < 0;
    tone = improved ? "good" : "bad";
  }
  return { label, tone };
}

/** Short, friendly UTC day label for axes/tooltips: "2026-06-14" → "Jun 14". */
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export function dayLabel(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return iso;
  return `${MONTHS[Number(m[2]) - 1]} ${Number(m[3])}`;
}
