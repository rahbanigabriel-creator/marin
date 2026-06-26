"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import type { DashDailyPoint } from "@/lib/metrics/dashboard";
import { COLUMNS, dailyValue, dayLabel, type MetricKey } from "./format";

/**
 * The hero time-series chart at the top of the Campaigns command center.
 * Hand-rolled inline SVG (the codebase has no chart lib) — matches ComboChart's
 * crosshair/tooltip pattern but generalized to a variable-length date axis with
 * a responsive, measured pixel width so strokes/dots are never distorted.
 */

export interface MetricTrendChartProps {
  series: DashDailyPoint[];
  /** Which metric to plot (controlled by the parent). */
  metric: MetricKey;
  /** Chips offered in the switcher (<=1 or omitted → no switcher). */
  metricOptions?: MetricKey[];
  onMetricChange?: (m: MetricKey) => void;
  /** Chart body height in px. */
  height?: number;
  /** Optional small heading above the chart. */
  title?: string;
  /** Optional previous-period series, drawn as a faint dashed line. */
  compareSeries?: DashDailyPoint[];
}

const PAD_L = 48;
const PAD_R = 14;
const PAD_T = 14;
const PAD_B = 24;

export function MetricTrendChart({
  series,
  metric,
  metricOptions,
  onMetricChange,
  height = 260,
  title,
  compareSeries,
}: MetricTrendChartProps): React.JSX.Element {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const [w, setW] = useState(720);
  const [active, setActive] = useState<number | null>(null);
  const gradId = useId().replace(/:/g, "");

  useEffect(() => {
    const el = wrapRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver((entries) => {
      const cw = entries[0]?.contentRect.width;
      if (cw && cw > 0) setW(Math.round(cw));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const col = COLUMNS[metric];
  const values = useMemo(() => series.map((p) => dailyValue(p, metric)), [series, metric]);
  const compareValues = useMemo(
    () => (compareSeries && compareSeries.length === series.length ? compareSeries.map((p) => dailyValue(p, metric)) : null),
    [compareSeries, series.length, metric],
  );

  const hasData = values.length > 0 && values.some((v) => v > 0);

  const geo = useMemo(() => {
    const n = values.length;
    const innerW = Math.max(10, w - PAD_L - PAD_R);
    const innerH = Math.max(10, height - PAD_T - PAD_B);
    const maxV = Math.max(...values, compareValues ? Math.max(...compareValues) : 0, 0.0001) * 1.12;
    const x = (i: number) => (n <= 1 ? PAD_L + innerW / 2 : PAD_L + (innerW * i) / (n - 1));
    const y = (v: number) => PAD_T + innerH * (1 - v / maxV);

    const pts = values.map((v, i) => ({ x: +x(i).toFixed(2), y: +y(v).toFixed(2), v }));
    const line = pts.map((p, i) => `${i ? "L" : "M"}${p.x},${p.y}`).join(" ");
    const area =
      pts.length > 0
        ? `${line} L${pts[pts.length - 1].x},${PAD_T + innerH} L${pts[0].x},${PAD_T + innerH} Z`
        : "";
    const cmp = compareValues
      ? compareValues.map((v, i) => `${i ? "L" : "M"}${(+x(i).toFixed(2))},${(+y(v).toFixed(2))}`).join(" ")
      : null;

    // ~4 y gridlines including 0 and max
    const yTicks = [0, 0.25, 0.5, 0.75, 1].map((f) => ({
      y: +(PAD_T + innerH * (1 - f)).toFixed(2),
      v: maxV * f,
    }));
    // ~5-6 x ticks evenly spaced
    const tickN = Math.min(6, n);
    const xTicks =
      n === 0
        ? []
        : Array.from({ length: tickN }, (_, k) => {
            const i = tickN === 1 ? 0 : Math.round((k * (n - 1)) / (tickN - 1));
            return { x: +x(i).toFixed(2), label: dayLabel(series[i].date) };
          });

    const bands = pts.map((p, i) => {
      const left = i === 0 ? PAD_L : (pts[i - 1].x + p.x) / 2;
      const right = i === n - 1 ? PAD_L + innerW : (p.x + pts[i + 1].x) / 2;
      return { x: left, w: Math.max(1, right - left) };
    });

    return { pts, line, area, cmp, yTicks, xTicks, bands, innerH };
  }, [values, compareValues, w, height, series]);

  const showSwitcher = !!(metricOptions && metricOptions.length > 1 && onMetricChange);

  return (
    <div className="rounded-card border border-line-3 bg-surface-card p-[16px_18px]">
      <div className="mb-[10px] flex flex-wrap items-center justify-between gap-[10px]">
        {title ? (
          <div className="font-mono text-[10px] font-semibold uppercase tracking-[0.08em] text-ink-300">{title}</div>
        ) : (
          <span />
        )}
        {showSwitcher ? (
          <div className="flex flex-wrap items-center gap-[5px]">
            {metricOptions!.map((m) => {
              const on = m === metric;
              return (
                <button
                  key={m}
                  type="button"
                  onClick={() => onMetricChange!(m)}
                  className="cursor-pointer rounded-pill font-mono text-[11px] font-semibold transition-colors"
                  style={
                    on
                      ? { background: "#9A3D63", color: "#fff", padding: "3px 10px", border: "1px solid #9A3D63" }
                      : { background: "#F9F9F4", color: "#6B6359", padding: "3px 10px", border: "1px solid #E5E3DB" }
                  }
                >
                  {COLUMNS[m].label}
                </button>
              );
            })}
          </div>
        ) : null}
      </div>

      <div ref={wrapRef} className="relative w-full" style={{ height }}>
        {!hasData ? (
          <div className="flex h-full items-center justify-center font-sans text-[13px] text-ink-300">
            No activity in this range.
          </div>
        ) : (
          <>
            <svg width={w} height={height} viewBox={`0 0 ${w} ${height}`} style={{ overflow: "visible" }}>
              <defs>
                <linearGradient id={`trend-${gradId}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="rgba(154,61,99,0.18)" />
                  <stop offset="100%" stopColor="rgba(154,61,99,0)" />
                </linearGradient>
              </defs>

              {/* gridlines + y ticks */}
              {geo.yTicks.map((t, i) => (
                <g key={i}>
                  <line x1={PAD_L} y1={t.y} x2={w - PAD_R} y2={t.y} stroke="#EDECE4" strokeWidth={1} />
                  <text
                    x={PAD_L - 8}
                    y={t.y + 3}
                    textAnchor="end"
                    className="font-mono"
                    style={{ fontSize: 9.5, fill: "#A8A296" }}
                  >
                    {col.axisFmt(+t.v.toFixed(2))}
                  </text>
                </g>
              ))}

              {/* x ticks */}
              {geo.xTicks.map((t, i) => (
                <text
                  key={i}
                  x={t.x}
                  y={height - 6}
                  textAnchor="middle"
                  className="font-mono"
                  style={{ fontSize: 9.5, fill: "#A8A296" }}
                >
                  {t.label}
                </text>
              ))}

              {/* compare (previous period) */}
              {geo.cmp ? (
                <path d={geo.cmp} fill="none" stroke="#C8A9B8" strokeWidth={1.5} strokeDasharray="4 3" />
              ) : null}

              {/* area + line */}
              <path d={geo.area} fill={`url(#trend-${gradId})`} stroke="none" />
              <path d={geo.line} fill="none" stroke="#9A3D63" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />

              {/* crosshair + marker */}
              {active !== null && geo.pts[active] ? (
                <>
                  <line
                    x1={geo.pts[active].x}
                    y1={PAD_T}
                    x2={geo.pts[active].x}
                    y2={PAD_T + geo.innerH}
                    stroke="#9A3D63"
                    strokeWidth={1}
                    strokeDasharray="3 3"
                    opacity={0.5}
                  />
                  <circle cx={geo.pts[active].x} cy={geo.pts[active].y} r={3.4} fill="#9A3D63" stroke="#fff" strokeWidth={1.6} />
                </>
              ) : null}

              {/* hover bands */}
              {geo.bands.map((b, i) => (
                <rect
                  key={i}
                  x={b.x}
                  y={PAD_T}
                  width={b.w}
                  height={geo.innerH}
                  fill="transparent"
                  style={{ cursor: "crosshair" }}
                  onMouseEnter={() => setActive(i)}
                  onMouseLeave={() => setActive(null)}
                />
              ))}
            </svg>

            {active !== null && geo.pts[active] ? (
              <div
                className="pointer-events-none absolute z-20 -translate-x-1/2 -translate-y-full whitespace-nowrap rounded-[7px] border border-line-3 bg-surface-card px-[9px] py-[6px] shadow-modal"
                style={{ left: geo.pts[active].x, top: geo.pts[active].y - 8 }}
              >
                <div className="font-mono text-[9.5px] font-medium text-ink-300">{dayLabel(series[active].date)}</div>
                <div className="font-sans text-[12.5px] font-semibold text-ink-900">{col.fmt(+values[active].toFixed(2))}</div>
              </div>
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}
