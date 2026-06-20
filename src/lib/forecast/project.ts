import type { ForecastResultData } from "@/types/artifacts";

/**
 * Pure, deterministic budget→outcome projection over a saturating-returns curve
 * (Michaelis–Menten shape). Anchored so the current ~€48.2k spend reproduces the
 * canonical ~€183k revenue / 3.8× ROAS. Front-end only — no model, no API.
 */
const REV_MAX = 335_000; // asymptotic monthly revenue
const HALF = 40_000; // budget at half-saturation
const AOV = 119; // average order value
const CURRENT_BUDGET = 48_200;

function revenueAt(b: number): number {
  return (REV_MAX * b) / (b + HALF);
}

/** Confidence widens as budget extrapolates beyond what's been observed. */
function bandAt(b: number): number {
  return 0.08 + (0.1 * b) / 100_000;
}

export function project(budget: number): ForecastResultData {
  const MIN = 5_000;
  const MAX = 100_000;
  const N = 24;
  const revenue = revenueAt(budget);
  const band = bandAt(budget);
  const curve = Array.from({ length: N + 1 }, (_, i) => {
    const b = MIN + ((MAX - MIN) * i) / N;
    const r = revenueAt(b);
    const bd = bandAt(b);
    return { budget: b, revenue: r, low: r * (1 - bd), high: r * (1 + bd) };
  });
  return {
    budget,
    roas: revenue / budget,
    revenue,
    conversions: Math.round(revenue / AOV),
    revenueLow: revenue * (1 - band),
    revenueHigh: revenue * (1 + band),
    curve,
  };
}

export const CURRENT_SPEND = CURRENT_BUDGET;
