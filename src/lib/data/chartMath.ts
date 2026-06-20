/**
 * Chart scaling math, transcribed verbatim from AnswerCanvas.dc.html so the
 * hand-rolled SVG charts reproduce the prototype pixel-for-pixel.
 */

export interface SparkPoint {
  x: number;
  y: number;
  value: number;
}

export interface SparkGeometry {
  /** per-datum points (viewBox coords) carrying the raw value for tooltips */
  points: SparkPoint[];
  /** polyline `points` string */
  line: string;
}

/** Sparkline geometry for a KPI card (viewBox 0 0 80 28). */
export function sparkGeometry(arr: number[]): SparkGeometry {
  const W = 80;
  const H = 28;
  const p = 3;
  const mn = Math.min(...arr);
  const mx = Math.max(...arr);
  const d = mx - mn || 1;
  const points = arr.map((v, i) => {
    const x = +(p + ((W - 2 * p) * i) / (arr.length - 1)).toFixed(1);
    const y = +(p + (H - 2 * p) * (1 - (v - mn) / d)).toFixed(1);
    return { x, y, value: v };
  });
  return { points, line: points.map((pt) => `${pt.x},${pt.y}`).join(" ") };
}

export interface Bar {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface ComboChartGeometry {
  bars: Bar[];
  roasLine: string;
  lastX: number;
  lastY: number;
  /** ROAS vertices (viewBox coords), one per day */
  points: Array<{ x: number; y: number }>;
  /** full-height hover/click columns: left x, width, and center x per day */
  bands: Array<{ x: number; w: number; cx: number }>;
}

/** Combo chart geometry (viewBox 0 0 360 150). */
export function comboChartGeometry(spend: number[], roas: number[]): ComboChartGeometry {
  const W = 360;
  const H = 150;
  const padX = 16;
  const padTop = 14;
  const padBot = 24;
  const n = spend.length;
  const innerW = W - padX * 2;

  const maxS = Math.max(...spend) * 1.12;
  const bw = (innerW / n) * 0.5;
  const bars: Bar[] = spend.map((v, i) => {
    const cx = padX + (innerW * (i + 0.5)) / n;
    const h = (v / maxS) * (H - padTop - padBot);
    return {
      x: +(cx - bw / 2).toFixed(1),
      y: +(H - padBot - h).toFixed(1),
      w: +bw.toFixed(1),
      h: +h.toFixed(1),
    };
  });

  const mnR = Math.min(...roas);
  const mxR = Math.max(...roas);
  const dR = mxR - mnR || 1;
  const pts: Array<[number, number]> = roas.map((v, i) => {
    const cx = padX + (innerW * (i + 0.5)) / n;
    const y = padTop + (1 - (v - mnR) / dR) * (H - padTop - padBot);
    return [+cx.toFixed(1), +y.toFixed(1)];
  });
  const roasLine = pts.map((p) => p.join(",")).join(" ");
  const last = pts[pts.length - 1];

  const points = pts.map(([x, y]) => ({ x, y }));
  const bands = spend.map((_, i) => ({
    x: +(padX + (innerW * i) / n).toFixed(1),
    w: +(innerW / n).toFixed(1),
    cx: +(padX + (innerW * (i + 0.5)) / n).toFixed(1),
  }));

  return { bars, roasLine, lastX: last[0], lastY: last[1], points, bands };
}

/** Leak bar width percentages (relative to the largest leak). */
export function leakPct(wasted: number, maxWasted: number): number {
  return Math.round((wasted / maxWasted) * 100);
}

export interface ForecastGeometry {
  /** revenue polyline path */
  line: string;
  /** filled confidence-band area path */
  band: string;
  /** projected-point marker */
  projX: number;
  projY: number;
}

/** Forecast curve geometry (viewBox 0 0 360 150). */
export function forecastGeometry(
  curve: { budget: number; revenue: number; low: number; high: number }[],
  projBudget: number,
): ForecastGeometry {
  const W = 360;
  const H = 150;
  const padX = 16;
  const padTop = 14;
  const padBot = 18;
  const minB = curve[0].budget;
  const maxB = curve[curve.length - 1].budget;
  const maxY = Math.max(...curve.map((p) => p.high)) || 1;
  const X = (b: number) => padX + ((W - 2 * padX) * (b - minB)) / (maxB - minB || 1);
  const Y = (v: number) => padTop + (H - padTop - padBot) * (1 - v / maxY);

  const line = curve
    .map((p, i) => `${i ? "L" : "M"}${X(p.budget).toFixed(1)},${Y(p.revenue).toFixed(1)}`)
    .join(" ");
  const top = curve
    .map((p, i) => `${i ? "L" : "M"}${X(p.budget).toFixed(1)},${Y(p.high).toFixed(1)}`)
    .join(" ");
  const bottom = [...curve]
    .reverse()
    .map((p) => `L${X(p.budget).toFixed(1)},${Y(p.low).toFixed(1)}`)
    .join(" ");

  const closest = curve.reduce((a, b) =>
    Math.abs(b.budget - projBudget) < Math.abs(a.budget - projBudget) ? b : a,
  );

  return {
    line,
    band: `${top} ${bottom} Z`,
    projX: +X(projBudget).toFixed(1),
    projY: +Y(closest.revenue).toFixed(1),
  };
}
