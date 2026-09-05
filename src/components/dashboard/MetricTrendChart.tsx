"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { LuChartColumn, LuChartLine, LuChartNoAxesColumn } from "react-icons/lu";
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
  embedded?: boolean;
  /** Omit for the internal toggle; without a callback, fixes the mode and hides the toggle. */
  appearance?: "line" | "bar";
  onAppearanceChange?: (appearance: "line" | "bar") => void;
}

const PAD_R = 18;
const PAD_T = 18;
const PAD_B = 30;
const DAY_MS = 86_400_000;

function dayTime(date: string): number {
  return Date.parse(`${date.slice(0, 10)}T00:00:00Z`);
}

function consecutiveDays(previous: string, next: string): boolean {
  return dayTime(next) - dayTime(previous) === DAY_MS;
}

function pathFor(values: Array<number | null>, dates: string[], x: (index: number) => number, y: (value: number) => number): string {
  let penDown = false;
  return values.map((value, index) => {
    if (value == null) {
      penDown = false;
      return "";
    }
    const command = penDown && consecutiveDays(dates[index - 1], dates[index]) ? "L" : "M";
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
  embedded = false,
  appearance,
  onAppearanceChange,
}: MetricTrendChartProps): React.JSX.Element {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const tooltipRef = useRef<HTMLDivElement | null>(null);
  const bandRefs = useRef<Array<SVGRectElement | null>>([]);
  const focusedIndex = useRef<number | null>(null);
  const [width, setWidth] = useState(720);
  const [active, setActive] = useState<number | null>(null);
  const [tabStop, setTabStop] = useState(0);
  const [tooltipHeight, setTooltipHeight] = useState(62);
  const [internalAppearance, setInternalAppearance] = useState<"line" | "bar">("line");
  const chartAppearance = appearance ?? internalAppearance;
  const chartId = useId().replace(/:/g, "");
  const headingId = `${chartId}-heading`;
  const tooltipId = `${chartId}-tooltip`;

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

  useEffect(() => {
    setActive(null);
    setTabStop(0);
    focusedIndex.current = null;
  }, [metric, series, currency, unavailableReason]);

  const column = COLUMNS[metric];
  const rows = useMemo(() => {
    const result: Array<{ date: string; point: PaidDailyPoint | null; comparison: PaidDailyPoint | null }> = [];
    const comparable = compareSeries?.length === series.length;
    series.forEach((point, index) => {
      // Absent calendar days remain inspectable gaps, never synthetic observations.
      if (index > 0) {
        const end = dayTime(point.date);
        for (let day = dayTime(series[index - 1].date) + DAY_MS; day < end; day += DAY_MS) {
          result.push({ date: new Date(day).toISOString().slice(0, 10), point: null, comparison: null });
        }
      }
      result.push({ date: point.date, point, comparison: comparable ? compareSeries?.[index] ?? null : null });
    });
    return result;
  }, [series, compareSeries]);
  const values = useMemo(
    () => rows.map(({ point }) => {
      const value = point ? dailyValue(point, metric) : null;
      return unavailableReason || metricIsUnavailable(metric, value, currency) || !Number.isFinite(value) ? null : value;
    }),
    [rows, metric, currency, unavailableReason],
  );
  const compareValues = useMemo(() => {
    if (!compareSeries || compareSeries.length !== series.length) return null;
    return rows.map(({ comparison }) => {
      const value = comparison ? dailyValue(comparison, metric) : null;
      return unavailableReason || metricIsUnavailable(metric, value, currency) || !Number.isFinite(value) ? null : value;
    });
  }, [compareSeries, series.length, rows, metric, currency, unavailableReason]);

  const hasValues = values.some((value) => value != null);
  const hasComparison = !!compareValues?.some((value) => value != null);
  const geometry = useMemo(() => {
    const count = values.length;
    const innerHeight = Math.max(10, height - PAD_T - PAD_B);
    const available = [...values, ...(compareValues ?? [])].filter((value): value is number => value != null);
    const maxValue = Math.max(...available, 0);
    const minValue = Math.min(...available, 0);
    const axisPrecision = metric === "roas" || metric === "ctr" || metric === "cvr" ? 0.01 : 1;
    const rawStep = Math.max(axisPrecision, (maxValue - minValue || 1) * 1.08 / 4);
    const magnitude = 10 ** Math.floor(Math.log10(rawStep));
    const step = ([1, 2, 2.5, 5, 10].find((value) => value >= rawStep / magnitude) ?? 10) * magnitude;
    const axisMin = Math.floor(minValue / step) * step;
    const axisMax = Math.max(step, Math.ceil(maxValue / step) * step);
    const y = (value: number) => PAD_T + innerHeight * (1 - (value - axisMin) / (axisMax - axisMin));
    const yTicks = Array.from({ length: Math.round((axisMax - axisMin) / step) + 1 }, (_, index) => {
      const value = axisMin + index * step;
      return { y: y(value), label: column.axisFmt(Number(value.toPrecision(12)), currency) };
    }).filter((tick, index, ticks) => index === 0 || tick.label !== ticks[index - 1].label);
    const padLeft = Math.min(width * 0.35, Math.max(48, ...yTicks.map((tick) => tick.label.length * 6.2 + 14)));
    const innerWidth = Math.max(10, width - padLeft - PAD_R);
    const slotWidth = innerWidth / Math.max(1, count);
    const x = (index: number) => padLeft + slotWidth * (index + 0.5);
    const dates = rows.map((row) => row.date);
    const compareDates = rows.map((row) => row.comparison?.date ?? row.date);
    const makePoints = (data: Array<number | null>, pointDates: string[]) => {
      const sparse = data.filter((value) => value != null).length <= 10;
      return data.map((value, index) => ({
        x: Number(x(index).toFixed(2)),
        y: value == null ? null : Number(y(value).toFixed(2)),
        value,
        marker: sparse || (
          (data[index - 1] == null || !consecutiveDays(pointDates[index - 1], pointDates[index])) &&
          (data[index + 1] == null || !consecutiveDays(pointDates[index], pointDates[index + 1]))
        ),
      }));
    };
    const points = makePoints(values, dates);
    const comparisonPoints = makePoints(compareValues ?? [], compareDates);
    const line = pathFor(values, dates, x, y);
    const compare = compareValues ? pathFor(compareValues, compareDates, x, y) : null;
    const complete = values.length > 1 && values.every((value, index) => value != null && (index === 0 || consecutiveDays(dates[index - 1], dates[index])));
    const area = complete
      ? `${line} L${x(values.length - 1).toFixed(2)},${y(0)} L${x(0).toFixed(2)},${y(0)} Z`
      : "";
    const tickCount = Math.min(count, Math.max(1, Math.min(6, Math.floor(innerWidth / 70))));
    const xTicks = count === 0 ? [] : Array.from({ length: tickCount }, (_, tick) => {
      const index = tickCount === 1 ? 0 : Math.round((tick * (count - 1)) / (tickCount - 1));
      return { x: Number(x(index).toFixed(2)), label: dayLabel(rows[index].date) };
    });
    const bands = points.map((_, index) => ({ x: padLeft + index * slotWidth, width: slotWidth }));
    const barWidth = Math.min(30, slotWidth * (hasComparison ? 0.34 : 0.6));
    return { points, comparisonPoints, line, compare, area, yTicks, xTicks, bands, innerHeight, padLeft, barWidth, baseline: y(0) };
  }, [values, compareValues, width, height, rows, column, currency, metric, hasComparison]);

  const showSwitcher = !!(metricOptions && metricOptions.length > 1 && onMetricChange);
  const reason = unavailableReason ?? (series.length > 0 && !hasValues ? `${column.full} is unavailable for this source.` : null);
  const activePoint = active == null ? null : geometry.points[active];
  const tooltipWidth = Math.min(184, Math.max(0, width - 16));
  const tooltipLeft = activePoint ? Math.max(8, Math.min(activePoint.x - tooltipWidth / 2, width - tooltipWidth - 8)) : 8;
  const pointTop = activePoint?.y ?? PAD_T + geometry.innerHeight / 2;
  const tooltipTop = Math.max(8, Math.min(pointTop > tooltipHeight + 16 ? pointTop - tooltipHeight - 12 : pointTop + 12, height - tooltipHeight - 8));

  useEffect(() => {
    const element = tooltipRef.current;
    if (!element) return;
    const measure = () => setTooltipHeight(element.getBoundingClientRect().height);
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [active, hasComparison, reason]);

  return (
    <section className={`w-full min-w-0 max-w-full ${embedded ? "" : "rounded-card border border-line-3 bg-surface-card p-[14px_16px]"}`} aria-labelledby={headingId}>
      <div className="mb-[16px] flex flex-wrap items-center justify-between gap-[12px]">
        <div id={headingId} className="min-w-0 break-words font-sans text-[13px] font-semibold leading-[1.4] text-ink-800">
          {title ?? column.full}
        </div>
        <div className="flex max-w-full flex-wrap items-center gap-[12px]">
          {showSwitcher ? (
            <div className="flex max-w-full flex-wrap items-center gap-[4px]" role="group" aria-label="Chart metric">
              {metricOptions.map((option) => {
                const selected = option === metric;
                return (
                  <button
                    key={option}
                    type="button"
                    onClick={() => onMetricChange(option)}
                    aria-pressed={selected}
                    className={`min-h-[32px] cursor-pointer rounded-[5px] px-[9px] font-mono text-[11px] font-medium transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-plum ${selected ? "bg-plum-soft text-plum-deep" : "text-ink-400 hover:bg-surface-rec hover:text-ink-800"}`}
                  >
                    {COLUMNS[option].label}
                  </button>
                );
              })}
            </div>
          ) : null}
          {appearance == null || onAppearanceChange ? (
            <div role="group" aria-label="Chart appearance" className="flex shrink-0 items-center gap-[2px] rounded-[7px] border border-line-3 p-[3px]">
              {(["line", "bar"] as const).map((mode) => {
                const Icon = mode === "line" ? LuChartLine : LuChartColumn;
                const label = mode === "line" ? "Line chart" : "Bar chart";
                return (
                  <button
                    key={mode}
                    type="button"
                    aria-label={label}
                    title={label}
                    aria-pressed={chartAppearance === mode}
                    onClick={() => {
                      if (appearance == null) setInternalAppearance(mode);
                      onAppearanceChange?.(mode);
                    }}
                    className={`flex h-[30px] w-[32px] cursor-pointer items-center justify-center rounded-[4px] transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-plum ${chartAppearance === mode ? "bg-plum text-white" : "text-ink-400 hover:bg-surface-rec hover:text-ink-800"}`}
                  >
                    <Icon size={16} aria-hidden="true" />
                  </button>
                );
              })}
            </div>
          ) : null}
        </div>
      </div>

      {hasComparison && !reason ? (
        <div className="mb-[8px] flex flex-wrap gap-x-[16px] gap-y-[4px] font-sans text-[11px] text-ink-400">
          <span className="flex items-center gap-[6px]"><span aria-hidden="true" className="h-[2px] w-[14px] bg-plum" />Current period</span>
          <span className="flex items-center gap-[6px]"><span aria-hidden="true" className="w-[14px] border-t-2 border-dashed border-[#C8A9B8]" />Previous period</span>
        </div>
      ) : null}

      <div ref={wrapRef} className="relative w-full min-w-0 max-w-full overflow-hidden" style={{ height }}>
        {reason || series.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-[14px] px-[20px] text-center font-sans text-[13px] leading-[1.6] text-ink-400">
            <LuChartNoAxesColumn size={48} strokeWidth={1.1} className="shrink-0 text-plum-muted" aria-hidden="true" />
            <p className="max-w-[360px] break-words">{reason || "No observations in this range."}</p>
          </div>
        ) : (
          <>
            <svg
              width={width}
              height={height}
              viewBox={`0 0 ${width} ${height}`}
              className="max-w-full"
              role="group"
              aria-labelledby={headingId}
              onMouseLeave={() => setActive(focusedIndex.current)}
            >
              <defs>
                <linearGradient id={`trend-${chartId}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="rgba(154,61,99,0.10)" />
                  <stop offset="100%" stopColor="rgba(154,61,99,0)" />
                </linearGradient>
              </defs>

              {geometry.yTicks.map((tick, index) => (
                <g key={index}>
                  <line x1={geometry.padLeft} y1={tick.y} x2={width - PAD_R} y2={tick.y} stroke="#E9E5E7" strokeWidth={1} strokeDasharray={tick.y === geometry.baseline ? undefined : "3 5"} />
                  <text x={geometry.padLeft - 10} y={tick.y + 3.5} textAnchor="end" className="font-mono" style={{ fontSize: 10, fill: "var(--ink-400, #6B6359)" }}>
                    {tick.label}
                  </text>
                </g>
              ))}

              {geometry.xTicks.map((tick, index) => (
                <text key={index} x={tick.x} y={height - 7} textAnchor={geometry.xTicks.length === 1 ? "middle" : index === 0 ? "start" : index === geometry.xTicks.length - 1 ? "end" : "middle"} className="font-mono" style={{ fontSize: 10, fill: "var(--ink-400, #6B6359)" }}>
                  {tick.label}
                </text>
              ))}

              {chartAppearance === "line" ? (
                <g aria-hidden="true">
                  {geometry.area ? <path d={geometry.area} fill={`url(#trend-${chartId})`} stroke="none" /> : null}
                  {geometry.compare ? <path d={geometry.compare} fill="none" stroke="#C8A9B8" strokeWidth={1.8} strokeDasharray="4 4" /> : null}
                  <path d={geometry.line} fill="none" stroke="#9A3D63" strokeWidth={2.4} strokeLinejoin="round" strokeLinecap="round" />
                  {geometry.comparisonPoints.map((point, index) => point.y != null && point.marker ? (
                    <circle key={index} cx={point.x} cy={point.y} r={3} fill="#fff" stroke="#C8A9B8" strokeWidth={1.8} />
                  ) : null)}
                  {geometry.points.map((point, index) => point.y != null && point.marker ? (
                    <circle key={index} cx={point.x} cy={point.y} r={3.8} fill="#9A3D63" stroke="#fff" strokeWidth={1.8} />
                  ) : null)}
                </g>
              ) : (
                <g aria-hidden="true">
                  {[geometry.points, geometry.comparisonPoints].map((points, group) => points.map((point, index) => {
                    if (point.y == null) return null;
                    const x = point.x - geometry.barWidth / 2 + (hasComparison ? (group === 0 ? -0.6 : 0.6) * geometry.barWidth : 0);
                    const color = group === 0 ? "#9A3D63" : "#C8A9B8";
                    return point.value === 0 ? (
                      <line key={`${group}-${index}`} x1={x} x2={x + geometry.barWidth} y1={geometry.baseline} y2={geometry.baseline} stroke={color} strokeWidth={2} />
                    ) : (
                      <rect key={`${group}-${index}`} x={x} y={Math.min(point.y, geometry.baseline)} width={geometry.barWidth} height={Math.max(1, Math.abs(geometry.baseline - point.y))} rx={Math.min(3, geometry.barWidth / 3)} fill={color} opacity={active == null || active === index ? 1 : 0.65} />
                    );
                  }))}
                </g>
              )}

              {activePoint ? (
                <g aria-hidden="true">
                  <line
                    x1={activePoint.x}
                    y1={PAD_T}
                    x2={activePoint.x}
                    y2={PAD_T + geometry.innerHeight}
                    stroke="#9A3D63"
                    strokeWidth={1}
                    strokeDasharray="3 3"
                    opacity={0.5}
                  />
                  {activePoint.y != null && chartAppearance === "line" ? <circle cx={activePoint.x} cy={activePoint.y} r={5} fill="#9A3D63" stroke="#fff" strokeWidth={2} /> : null}
                </g>
              ) : null}

              {geometry.bands.map((band, index) => {
                const value = geometry.points[index]?.value;
                const label = value == null ? "Unavailable" : column.fmt(value, currency);
                return (
                  <rect
                    key={`${rows[index].date}-${index}`}
                    ref={(element) => { bandRefs.current[index] = element; }}
                    x={band.x}
                    y={PAD_T}
                    width={band.width}
                    height={geometry.innerHeight}
                    fill="transparent"
                    tabIndex={index === Math.min(tabStop, rows.length - 1) ? 0 : -1}
                    role="button"
                    aria-label={`${dayLabel(rows[index].date)}: ${label}`}
                    aria-describedby={active === index ? tooltipId : undefined}
                    onFocus={() => { focusedIndex.current = index; setTabStop(index); setActive(index); }}
                    onBlur={() => { focusedIndex.current = null; setActive(null); }}
                    onMouseEnter={() => setActive(index)}
                    onMouseLeave={() => setActive(focusedIndex.current)}
                    onClick={(event) => { event.currentTarget.focus(); setActive(index); }}
                    onKeyDown={(event) => {
                      let next = index;
                      if (event.key === "ArrowRight" || event.key === "ArrowDown") next = Math.min(rows.length - 1, index + 1);
                      else if (event.key === "ArrowLeft" || event.key === "ArrowUp") next = Math.max(0, index - 1);
                      else if (event.key === "Home") next = 0;
                      else if (event.key === "End") next = rows.length - 1;
                      else if (event.key === "Escape") { event.preventDefault(); setActive(null); return; }
                      else if (event.key !== "Enter" && event.key !== " ") return;
                      event.preventDefault();
                      bandRefs.current[next]?.focus();
                      setActive(next);
                    }}
                    className="focus-visible:stroke-plum"
                    style={{ cursor: "crosshair", outline: "none" }}
                  />
                );
              })}
            </svg>

            {active != null && activePoint ? (
              <div
                ref={tooltipRef}
                id={tooltipId}
                role="tooltip"
                className="pointer-events-none absolute z-20 overflow-auto rounded-[7px] border border-line-3 bg-surface-card px-[10px] py-[8px] shadow-modal"
                style={{ left: tooltipLeft, top: tooltipTop, width: tooltipWidth, maxHeight: Math.max(0, height - 16) }}
              >
                <div className="break-words font-mono text-[10px] font-medium leading-[16px] text-ink-400">{dayLabel(rows[active].date)}</div>
                <div className="break-words font-sans text-[13px] font-semibold leading-[20px] text-ink-900">{activePoint.value == null ? "Unavailable" : column.fmt(activePoint.value, currency)}</div>
                {hasComparison ? <div className="mt-[4px] break-words border-t border-line-3 pt-[4px] font-sans text-[11px] leading-[16px] text-ink-400">Previous: {compareValues?.[active] == null ? "Unavailable" : column.fmt(compareValues[active], currency)}</div> : null}
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
                {rows.map((point, index) => (
                  <tr key={`${point.date}-${index}`} className="border-b border-line-3 last:border-0">
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
