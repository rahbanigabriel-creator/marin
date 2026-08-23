"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import {
  COLUMNS,
  dailyValue,
  dayLabel,
  metricIsUnavailable,
  type MetricKey,
  type PaidDailyPoint,
} from "./format";

export interface MetricTrendChartProps {
  series: PaidDailyPoint[];
  metric: MetricKey;
  metricOptions?: MetricKey[];
  onMetricChange?: (metric: MetricKey) => void;
  height?: number;
  title?: string;
  compareSeries?: PaidDailyPoint[];
  currency?: string | null;
  unavailableReason?: string | null;
}

const PAD_L = 48;
const PAD_R = 14;
const PAD_T = 14;
const PAD_B = 24;

function pathFor(values: Array<number | null>, x: (index: number) => number, y: (value: number) => number): string {
  let penDown = false;
  return values.map((value, index) => {
    if (value == null) {
      penDown = false;
      return "";
    }
    const command = penDown ? "L" : "M";
    penDown = true;
    return `${command}${x(index).toFixed(2)},${y(value).toFixed(2)}`;
  }).filter(Boolean).join(" ");
}

export function MetricTrendChart({
  series,
  metric,
  metricOptions,
  onMetricChange,
  height = 260,
  title,
  compareSeries,
  currency,
  unavailableReason,
}: MetricTrendChartProps): React.JSX.Element {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const [width, setWidth] = useState(720);
  const [active, setActive] = useState<number | null>(null);
  const chartId = useId().replace(/:/g, "");
  const headingId = `${chartId}-heading`;

  useEffect(() => {
    const element = wrapRef.current;
    if (!element || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver((entries) => {
      const measured = entries[0]?.contentRect.width;
      if (measured && measured > 0) setWidth(Math.round(measured));
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => setActive(null), [metric, series]);

  const column = COLUMNS[metric];
  const values = useMemo(
    () => series.map((point) => {
      const value = dailyValue(point, metric);
      return metricIsUnavailable(metric, value, currency) ? null : value;
    }),
    [series, metric, currency],
  );
  const compareValues = useMemo(() => {
    if (!compareSeries || compareSeries.length !== series.length) return null;
    return compareSeries.map((point) => {
      const value = dailyValue(point, metric);
      return metricIsUnavailable(metric, value, currency) ? null : value;
    });
  }, [compareSeries, series.length, metric, currency]);

  const hasValues = values.some((value) => value != null);
  const geometry = useMemo(() => {
    const count = values.length;
    const innerWidth = Math.max(10, width - PAD_L - PAD_R);
    const innerHeight = Math.max(10, height - PAD_T - PAD_B);
    const available = [...values, ...(compareValues ?? [])].filter((value): value is number => value != null);
    const maxValue = Math.max(...available, 0);
    const axisMax = maxValue > 0 ? maxValue * 1.12 : 1;
    const x = (index: number) => count <= 1 ? PAD_L + innerWidth / 2 : PAD_L + (innerWidth * index) / (count - 1);
    const y = (value: number) => PAD_T + innerHeight * (1 - value / axisMax);
    const points = values.map((value, index) => ({
      x: Number(x(index).toFixed(2)),
      y: value == null ? null : Number(y(value).toFixed(2)),
      value,
    }));
    const line = pathFor(values, x, y);
    const compare = compareValues ? pathFor(compareValues, x, y) : null;
    const complete = values.length > 0 && values.every((value) => value != null);
    const area = complete
      ? `${line} L${x(values.length - 1).toFixed(2)},${PAD_T + innerHeight} L${x(0).toFixed(2)},${PAD_T + innerHeight} Z`
      : "";
    const yTicks = [0, 0.25, 0.5, 0.75, 1].map((fraction) => ({
      y: Number((PAD_T + innerHeight * (1 - fraction)).toFixed(2)),
      value: axisMax * fraction,
    }));
    const tickCount = Math.min(6, count);
    const xTicks = count === 0 ? [] : Array.from({ length: tickCount }, (_, tick) => {
      const index = tickCount === 1 ? 0 : Math.round((tick * (count - 1)) / (tickCount - 1));
      return { x: Number(x(index).toFixed(2)), label: dayLabel(series[index].date) };
    });
    const bands = points.map((point, index) => {
      const left = index === 0 ? PAD_L : (points[index - 1].x + point.x) / 2;
      const right = index === count - 1 ? PAD_L + innerWidth : (point.x + points[index + 1].x) / 2;
      return { x: left, width: Math.max(1, right - left) };
    });
    return { points, line, compare, area, yTicks, xTicks, bands, innerHeight };
  }, [values, compareValues, width, height, series]);

  const showSwitcher = !!(metricOptions && metricOptions.length > 1 && onMetricChange);
  const reason = unavailableReason ?? (series.length > 0 && !hasValues ? `${column.full} is unavailable for this source.` : null);

  return (
    <section className="w-full min-w-0 max-w-full overflow-hidden rounded-card border border-line-3 bg-surface-card p-[14px_16px]" aria-labelledby={headingId}>
      <div className="mb-[10px] flex flex-wrap items-center justify-between gap-[10px]">
        <div id={headingId} className="font-mono text-[10px] font-semibold uppercase tracking-[0.08em] text-ink-300">
          {title ?? column.full}
        </div>
        {showSwitcher ? (
          <div className="flex flex-wrap items-center gap-[5px]" aria-label="Chart metric">
            {metricOptions.map((option) => {
              const selected = option === metric;
              return (
                <button
                  key={option}
                  type="button"
                  onClick={() => onMetricChange(option)}
                  aria-pressed={selected}
                  className="cursor-pointer rounded-pill font-mono text-[11px] font-semibold transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-plum"
                  style={selected
                    ? { background: "#9A3D63", color: "#fff", padding: "3px 10px", border: "1px solid #9A3D63" }
                    : { background: "#F9F9F4", color: "#6B6359", padding: "3px 10px", border: "1px solid #E5E3DB" }}
                >
                  {COLUMNS[option].label}
                </button>
              );
            })}
          </div>
        ) : null}
      </div>

      <div ref={wrapRef} className="relative w-full min-w-0 max-w-full overflow-hidden" style={{ height }}>
        {reason ? (
          <div className="flex h-full items-center justify-center px-[20px] text-center font-sans text-[13px] text-ink-300">
            {reason}
          </div>
        ) : series.length === 0 ? (
          <div className="flex h-full items-center justify-center font-sans text-[13px] text-ink-300">No observations in this range.</div>
        ) : (
          <>
            <svg
              width={width}
              height={height}
              viewBox={`0 0 ${width} ${height}`}
              className="max-w-full"
              role="img"
              aria-labelledby={headingId}
            >
              <defs>
                <linearGradient id={`trend-${chartId}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="rgba(154,61,99,0.18)" />
                  <stop offset="100%" stopColor="rgba(154,61,99,0)" />
                </linearGradient>
              </defs>

              {geometry.yTicks.map((tick, index) => (
                <g key={index}>
                  <line x1={PAD_L} y1={tick.y} x2={width - PAD_R} y2={tick.y} stroke="#EDECE4" strokeWidth={1} />
                  <text x={PAD_L - 8} y={tick.y + 3} textAnchor="end" className="font-mono" style={{ fontSize: 9.5, fill: "#A8A296" }}>
                    {column.axisFmt(Number(tick.value.toFixed(2)), currency)}
                  </text>
                </g>
              ))}

              {geometry.xTicks.map((tick, index) => (
                <text key={index} x={tick.x} y={height - 6} textAnchor="middle" className="font-mono" style={{ fontSize: 9.5, fill: "#A8A296" }}>
                  {tick.label}
                </text>
              ))}

              {geometry.compare ? <path d={geometry.compare} fill="none" stroke="#C8A9B8" strokeWidth={1.5} strokeDasharray="4 3" /> : null}
              {geometry.area ? <path d={geometry.area} fill={`url(#trend-${chartId})`} stroke="none" /> : null}
              <path d={geometry.line} fill="none" stroke="#9A3D63" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />

              {active != null && geometry.points[active]?.value != null && geometry.points[active].y != null ? (
                <>
                  <line
                    x1={geometry.points[active].x}
                    y1={PAD_T}
                    x2={geometry.points[active].x}
                    y2={PAD_T + geometry.innerHeight}
                    stroke="#9A3D63"
                    strokeWidth={1}
                    strokeDasharray="3 3"
                    opacity={0.5}
                  />
                  <circle cx={geometry.points[active].x} cy={geometry.points[active].y} r={3.4} fill="#9A3D63" stroke="#fff" strokeWidth={1.6} />
                </>
              ) : null}

              {geometry.bands.map((band, index) => {
                const value = geometry.points[index]?.value;
                const label = value == null ? "Unavailable" : column.fmt(value, currency);
                return (
                  <rect
                    key={series[index].date}
                    x={band.x}
                    y={PAD_T}
                    width={band.width}
                    height={geometry.innerHeight}
                    fill="transparent"
                    tabIndex={value == null ? -1 : 0}
                    role={value == null ? undefined : "button"}
                    aria-label={value == null ? undefined : `${dayLabel(series[index].date)}: ${label}`}
                    onFocus={() => value != null && setActive(index)}
                    onBlur={() => setActive(null)}
                    onMouseEnter={() => value != null && setActive(index)}
                    onMouseLeave={() => setActive(null)}
                    style={{ cursor: value == null ? "default" : "crosshair", outline: "none" }}
                  />
                );
              })}
            </svg>

            {active != null && geometry.points[active]?.value != null && geometry.points[active].y != null ? (
              <div
                className="pointer-events-none absolute z-20 -translate-x-1/2 -translate-y-full whitespace-nowrap rounded-[7px] border border-line-3 bg-surface-card px-[9px] py-[6px] shadow-modal"
                style={{ left: geometry.points[active].x, top: geometry.points[active].y - 8 }}
              >
                <div className="font-mono text-[9.5px] font-medium text-ink-300">{dayLabel(series[active].date)}</div>
                <div className="font-sans text-[12.5px] font-semibold text-ink-900">{column.fmt(geometry.points[active].value, currency)}</div>
              </div>
            ) : null}
          </>
        )}
      </div>

      {series.length > 0 ? (
        <details className="mt-[8px] border-t border-line-3 pt-[8px]">
          <summary className="w-fit cursor-pointer font-sans text-[11.5px] font-medium text-ink-400 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-plum">
            View chart data
          </summary>
          <div className="mt-[8px] max-h-[190px] overflow-auto">
            <table className="w-full border-collapse text-left">
              <thead>
                <tr className="border-b border-line-3">
                  <th scope="col" className="p-[5px_8px] font-mono text-[10px] uppercase text-ink-300">Date</th>
                  <th scope="col" className="p-[5px_8px] text-right font-mono text-[10px] uppercase text-ink-300">{column.full}</th>
                </tr>
              </thead>
              <tbody>
                {series.map((point, index) => (
                  <tr key={point.date} className="border-b border-line-3 last:border-0">
                    <td className="p-[5px_8px] font-sans text-[11.5px] text-ink-400">{dayLabel(point.date)}</td>
                    <td className="p-[5px_8px] text-right font-mono text-[11.5px] text-ink-800">
                      {values[index] == null ? "Unavailable" : column.fmt(values[index], currency)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      ) : null}
    </section>
  );
}
