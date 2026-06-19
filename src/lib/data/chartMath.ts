/**
 * Chart scaling math, transcribed verbatim from AnswerCanvas.dc.html so the
 * hand-rolled SVG charts reproduce the prototype pixel-for-pixel.
 */

/** Sparkline polyline points string for a KPI card (viewBox 0 0 80 28). */
export function sparkPoints(arr: number[]): string {
  const W = 80;
  const H = 28;
  const p = 3;
  const mn = Math.min(...arr);
  const mx = Math.max(...arr);
  const d = mx - mn || 1;
  return arr
    .map((v, i) => {
      const x = p + ((W - 2 * p) * i) / (arr.length - 1);
      const y = p + (H - 2 * p) * (1 - (v - mn) / d);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
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

  return { bars, roasLine, lastX: last[0], lastY: last[1] };
}

/** Leak bar width percentages (relative to the largest leak). */
export function leakPct(wasted: number, maxWasted: number): number {
  return Math.round((wasted / maxWasted) * 100);
}
