import type { ForecastResultData } from "@/types/artifacts";

/**
 * Pure, deterministic budget→outcome projection over a saturating-returns curve
 * (Michaelis–Menten shape). Each "company" has its own config so a scenario's
 * verdict, KPIs, and forecast all reconcile. Front-end only — no model, no API.
 */
export interface ForecastConfig {
  /** asymptotic monthly revenue */
  revMax: number;
  /** budget at half-saturation */
  half: number;
  /** average order value */
  aov: number;
  /** current monthly spend (baseline) */
  current: number;
}

/** Northwind / founder baseline: ~€48.2k spend → ~€183k revenue, 3.8× ROAS. */
export const DEFAULT_FORECAST: ForecastConfig = {
  revMax: 335_000,
  half: 40_000,
  aov: 119,
  current: 48_200,
};

/** Vertex / CEO baseline: €150k spend → €612k revenue, 4.1× blended MER. */
export const CEO_FORECAST: ForecastConfig = {
  revMax: 816_000,
  half: 50_000,
  aov: 140,
  current: 150_000,
};

function revenueAt(b: number, c: ForecastConfig): number {
  return (c.revMax * b) / (b + c.half);
}

/** Confidence widens as budget extrapolates beyond what's been observed. */
function bandAt(b: number): number {
  return 0.08 + (0.1 * b) / 100_000;
}

export function project(budget: number, cfg: ForecastConfig = DEFAULT_FORECAST): ForecastResultData {
  const MIN = 1_000;
  const MAX = Math.max(100_000, Math.round(cfg.current * 1.6));
  const N = 24;
  const revenue = revenueAt(budget, cfg);
  const band = bandAt(budget);
  const curve = Array.from({ length: N + 1 }, (_, i) => {
    const b = MIN + ((MAX - MIN) * i) / N;
    const r = revenueAt(b, cfg);
    const bd = bandAt(b);
    return { budget: b, revenue: r, low: r * (1 - bd), high: r * (1 + bd) };
  });
  return {
    budget,
    roas: revenue / budget,
    revenue,
    conversions: Math.round(revenue / cfg.aov),
    revenueLow: revenue * (1 - band),
    revenueHigh: revenue * (1 + band),
    curve,
  };
}

export const CURRENT_SPEND = DEFAULT_FORECAST.current;
