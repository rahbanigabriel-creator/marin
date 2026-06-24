/**
 * Artifact payload types — the response schema the Answer Canvas renders.
 * These mirror the canonical objects in AnswerCanvas.dc.html exactly and are
 * shared by both the mock streaming demo and the (future) real /api/chat
 * streamed responses.
 */

export type Tone = "good" | "bad" | "neutral";
export type ChipTone = "good" | "bad" | "neutral" | "clay";

export interface KpiCardData {
  label: string;
  value: string;
  delta: string;
  tone: Tone;
  /** spark polyline stroke color */
  sparkColor: string;
  /** raw sparkline data; the card normalizes within its own min/max */
  spark: number[];
}

export interface ComboChartData {
  title: string;
  sub: string;
  /** 14 daily spend values */
  spend: number[];
  /** 14 daily ROAS values */
  roas: number[];
}

export interface Leak {
  channel: string;
  name: string;
  /** wasted euros per month */
  wasted: number;
  /** ROAS label, e.g. "0.9×" */
  roas: string;
}

export interface LeaksData {
  total: string;
  items: Leak[];
}

export interface FunnelStage {
  label: string;
  value: string;
  /** bar width percentage 0–100 */
  widthPct: number;
  /** conversion rate label, e.g. "3.6% CTR" or "—" */
  rate: string;
  color: string;
}

export interface FunnelData {
  stages: FunnelStage[];
}

export type RecommendationTag = "Quick win" | "Growth" | "Cleanup";

export interface Recommendation {
  id: string;
  tag: RecommendationTag;
  title: string;
  body: string;
  impact: string;
}

export interface RecommendationsData {
  items: Recommendation[];
}

export interface CampaignDraftData {
  title: string;
  sub: string;
  spec: {
    objective: string;
    budget: string;
    audience: string;
    estRoas: string;
  };
  /** creative variant labels, e.g. "9:16 · A" */
  creatives: string[];
  explainer: string;
}

export interface ResultChip {
  label: string;
  tone: ChipTone;
}

/** The complete visual answer payload assembled for one question. */
export interface AnswerData {
  lead: string;
  chips: ResultChip[];
  kpis: KpiCardData[];
  chart: ComboChartData;
  leaks: LeaksData;
  funnel: FunnelData;
  recommendations: RecommendationsData;
  campaign: CampaignDraftData;
  /** closing line variants per view */
  closing: {
    split: string;
    thread: string;
  };
}

/* ── Additional artifact payloads (mockup scenarios) ───────────────────── */

export interface PlatformComparisonData {
  title: string;
  sub: string;
  rows: {
    platform: string;
    /** brand swatch */
    color: string;
    spend: string;
    roas: string;
    /** ROAS as a number, for the relative bar */
    roasValue: number;
    cpa: string;
    verdict: "best" | "watch" | "cut";
  }[];
}

/**
 * Market scan / competitor landscape — the hero strategy card. Ranked share-of-
 * market bars (the user's own row highlighted), a one-line "Marpin's read", and
 * the concrete openings where they can win. The agent fills this from live
 * research; it is the live-agent analogue of the mockup's Market Scan canvas.
 */
export interface MarketScanData {
  title: string;
  /** Marpin's one-line take, rendered as the dark callout. */
  read: string;
  /** Optional headline stats (market size, your share, growth). */
  stats?: { label: string; value: string; sub?: string }[];
  /** Ranked competitors by share of market; the user's row sets you:true. */
  field: { name: string; sharePct: number; you?: boolean }[];
  /** Optional momentum line — the user's growth vs the market's. */
  momentum?: { label: string; you: string; market: string };
  /** Concrete openings — where they can win. */
  openings?: string[];
  /** Optional closing next-step (phrased as a proposal if it spends/posts). */
  cta?: string;
}

export type VerdictStatus = "healthy" | "at-risk" | "declining";

export interface HealthVerdictData {
  status: VerdictStatus;
  headline: string;
  sub: string;
  metrics: { label: string; value: string; tone: Tone }[];
  recommendation: string;
}

export interface RootCauseData {
  /** the metric that moved, e.g. "CPA" */
  metric: string;
  /** the change, e.g. "+18%" */
  change: string;
  tone: Tone;
  summary: string;
  /** ordered cause cascade */
  drivers: { label: string; detail: string; impact: string }[];
}

export type CheckStatus = "pass" | "warn" | "fail";

export interface TrackingHealthData {
  title: string;
  summary: string;
  checks: { label: string; status: CheckStatus; detail: string }[];
}

export interface ForecastPoint {
  budget: number;
  revenue: number;
  low: number;
  high: number;
}

export interface ForecastResultData {
  budget: number;
  roas: number;
  revenue: number;
  conversions: number;
  revenueLow: number;
  revenueHigh: number;
  /** revenue at the current/baseline spend, for the "vs today" delta */
  baselineRevenue: number;
  /** one-line methodology basis */
  basis: string;
  /** revenue-vs-budget curve with confidence band, for the chart */
  curve: ForecastPoint[];
}

/**
 * A flexible, structured "brief" card — the workhorse artifact for answers that
 * don't depend on the user's connected data: strategy, competitor analysis,
 * website/brand audits, channel plans, campaign briefs, SEO/content roadmaps.
 * The agent renders one or more of these so the canvas is rich with ZERO data
 * connected. Intentionally simple (heading + bullets) so the model fills it
 * reliably; richer typed cards (campaign, comparison) layer on top later.
 */
export interface BriefData {
  title: string;
  subtitle?: string;
  /** short tag shown on the card, e.g. "Strategy", "Competitors", "Audit". */
  label?: string;
  sections: { heading: string; points: string[] }[];
  /** optional closing call-to-action / next step line. */
  cta?: string;
}

/* ── Action-OS: the executable action plan (clickable workspace) ───────────── */

/** How a step executes: real API call · prepare-and-open-prefilled · guided/manual. */
export type ExecMode = "api" | "prepare" | "guided";
export type ActionStatus = "proposed" | "executing" | "succeeded" | "failed" | "manual";

/** What the AGENT proposes (intent only — it never sets execMode/approval/id). */
export interface ProposedStep {
  title: string;
  description: string; // the full pre-written post / ad brief / SEO fix
  platform?: string; // ConnectorPlatform key, or omit for SEO/manual
  kind: string; // post | tweet | ad_draft | page | pin | seo_meta | manual | ...
  needsAsset?: boolean; // model hint; the server may override
}

/** What the CANVAS renders — server-enriched, one persisted Action row each. */
export interface ActionStep {
  actionId: string; // server-minted; the execute id + idempotency key
  title: string;
  description: string;
  platform?: string;
  kind: string;
  execMode: ExecMode; // SERVER-computed from the capability table
  ctaLabel: string; // "Post" | "Open in LinkedIn ▸" | "Copy brief"
  requiresApproval: boolean; // SERVER-computed (money / public post)
  needsAsset: boolean;
  status: ActionStatus; // starts "proposed"
}

export interface ActionPlanData {
  title: string;
  subtitle?: string;
  /** (a) current situation summary (e.g. you vs competitors). */
  situation?: { heading: string; points: string[] }[];
  /** (b) prioritized, one-by-one executable steps. */
  steps: ActionStep[];
}

export interface PlanAllocationData {
  goal: string;
  business: string;
  /** monthly budget in € */
  budget: number;
  allocations: { channel: string; color: string; amount: number; pct: number; rationale: string }[];
  projected: { conversions: number; revenue: number; roas: string };
  /** plain-language downside / floor for a non-expert */
  riskNote: string;
  steps: string[];
}
