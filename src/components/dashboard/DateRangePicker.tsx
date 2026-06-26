"use client";

import { useEffect, useRef, useState } from "react";
import type { DashRange } from "@/lib/metrics/dashboard";
import { dayLabel } from "./format";

/**
 * Google/Meta-Ads-style date range control: preset chips (7/14/30/90 days) plus
 * a custom from/to popover. All dates computed in UTC and emitted as
 * `yyyy-mm-dd` strings so they round-trip cleanly through /api/dashboard.
 *
 * Note: presets >30D may show zero-padded days until the historical backfill
 * (Phase 2) widens stored data — that's honest, not a bug.
 */

export interface DateRangePickerProps {
  range: DashRange;
  onChange: (from: string, to: string) => void;
  disabled?: boolean;
}

const PRESETS: { label: string; days: number }[] = [
  { label: "7D", days: 7 },
  { label: "14D", days: 14 },
  { label: "30D", days: 30 },
  { label: "90D", days: 90 },
];

function todayIso(): string {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  return d.toISOString().slice(0, 10);
}

function isoMinusDays(toIso: string, days: number): string {
  const [y, m, d] = toIso.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() - (days - 1));
  return dt.toISOString().slice(0, 10);
}

export function DateRangePicker({ range, onChange, disabled }: DateRangePickerProps): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const [customFrom, setCustomFrom] = useState(range.from);
  const [customTo, setCustomTo] = useState(range.to);
  const popRef = useRef<HTMLDivElement | null>(null);
  const today = todayIso();

  useEffect(() => {
    setCustomFrom(range.from);
    setCustomTo(range.to);
  }, [range.from, range.to]);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (popRef.current && !popRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  const activePreset = range.to === today ? PRESETS.find((p) => p.days === range.days)?.days ?? null : null;

  const applyPreset = (days: number) => {
    if (disabled) return;
    const to = today;
    onChange(isoMinusDays(to, days), to);
  };

  const applyCustom = () => {
    if (disabled) return;
    let from = customFrom;
    let to = customTo;
    if (from > to) [from, to] = [to, from];
    if (to > today) to = today;
    onChange(from, to);
    setOpen(false);
  };

  return (
    <div className="relative flex flex-wrap items-center gap-[8px]">
      <div className="flex items-center gap-[4px]">
        {PRESETS.map((p) => {
          const on = activePreset === p.days;
          return (
            <button
              key={p.days}
              type="button"
              disabled={disabled}
              onClick={() => applyPreset(p.days)}
              className="cursor-pointer rounded-[8px] font-mono text-[12px] font-semibold transition-colors disabled:opacity-50"
              style={
                on
                  ? { background: "#9A3D63", color: "#fff", padding: "5px 11px", border: "1px solid #9A3D63" }
                  : { background: "#fff", color: "#5A544A", padding: "5px 11px", border: "1px solid #E5E3DB" }
              }
            >
              {p.label}
            </button>
          );
        })}
        <button
          type="button"
          disabled={disabled}
          onClick={() => setOpen((o) => !o)}
          className="cursor-pointer rounded-[8px] font-mono text-[12px] font-semibold transition-colors disabled:opacity-50"
          style={
            activePreset === null
              ? { background: "#9A3D63", color: "#fff", padding: "5px 11px", border: "1px solid #9A3D63" }
              : { background: "#fff", color: "#5A544A", padding: "5px 11px", border: "1px solid #E5E3DB" }
          }
        >
          Custom
        </button>
      </div>

      <span className="font-mono text-[11.5px] text-ink-300">
        {dayLabel(range.from)} – {dayLabel(range.to)} · {range.days} {range.days === 1 ? "day" : "days"}
      </span>

      {open ? (
        <div
          ref={popRef}
          className="absolute right-0 top-[calc(100%+8px)] z-30 rounded-card border border-line-3 bg-surface-card p-[14px] shadow-modal"
          style={{ minWidth: 240 }}
        >
          <div className="flex flex-col gap-[10px]">
            <label className="flex flex-col gap-[4px]">
              <span className="font-sans text-[11px] text-ink-400">From</span>
              <input
                type="date"
                value={customFrom}
                max={today}
                onChange={(e) => setCustomFrom(e.target.value)}
                className="rounded-[8px] border border-line-3 px-[8px] py-[5px] font-mono text-[12.5px] text-ink-800 outline-none focus:border-plum"
              />
            </label>
            <label className="flex flex-col gap-[4px]">
              <span className="font-sans text-[11px] text-ink-400">To</span>
              <input
                type="date"
                value={customTo}
                max={today}
                onChange={(e) => setCustomTo(e.target.value)}
                className="rounded-[8px] border border-line-3 px-[8px] py-[5px] font-mono text-[12.5px] text-ink-800 outline-none focus:border-plum"
              />
            </label>
            <button
              type="button"
              onClick={applyCustom}
              className="mt-[2px] cursor-pointer rounded-[8px] font-sans text-[13px] font-semibold text-white"
              style={{ background: "#9A3D63", border: "none", padding: "8px 12px" }}
            >
              Apply
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
