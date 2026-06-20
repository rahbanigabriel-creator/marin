"use client";

import { useState } from "react";
import { RangeSlider } from "@/components/ui/RangeSlider";
import { project, DEFAULT_FORECAST, type ForecastConfig } from "@/lib/forecast/project";
import { ForecastResult } from "@/components/canvas/ForecastResult";

export function ForecastScreen({
  onClose,
  config = DEFAULT_FORECAST,
}: {
  onClose: () => void;
  config?: ForecastConfig;
}) {
  const sliderMax = Math.max(100000, Math.round(config.current * 1.6));
  const [budget, setBudget] = useState(Math.round(config.current));
  const data = project(budget, config);
  const delta = budget - config.current;

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto bg-surface-page p-[24px]">
      <div id="report-root" className="mx-auto w-full max-w-[720px]">
        <div className="mb-[16px] flex items-center justify-between">
          <div>
            <div className="font-serif text-[22px] font-medium tracking-[-0.01em] text-ink-900">
              Budget forecast
            </div>
            <div className="mt-[2px] font-sans text-[13px] text-ink-400">
              Drag to model monthly spend — projections update live.
            </div>
          </div>
          <div className="no-print flex gap-[8px]">
            <button
              type="button"
              onClick={() => window.print()}
              className="cursor-pointer rounded-btn font-sans text-[13px] font-semibold text-white"
              style={{ border: "none", background: "#2B2722", padding: "8px 14px" }}
            >
              ↧ Export PDF
            </button>
            <button
              type="button"
              onClick={onClose}
              className="cursor-pointer rounded-btn border border-line-1 bg-surface-chip font-sans text-[13px] font-semibold text-ink-700"
              style={{ padding: "8px 14px" }}
            >
              ← Back
            </button>
          </div>
        </div>

        <div className="mb-[16px] rounded-card border border-line-2 bg-surface-card p-[18px]">
          <div className="mb-[8px] flex items-baseline justify-between">
            <span className="font-sans text-[12.5px] font-medium text-ink-400">Monthly budget</span>
            <span className="font-mono text-[15px] font-semibold text-ink-900">
              €{budget.toLocaleString("en-US")}
            </span>
          </div>
          <RangeSlider value={budget} min={1000} max={sliderMax} step={1000} onChange={setBudget} />
          <div className="mt-[8px] flex justify-between font-mono text-[10.5px] text-ink-300">
            <span>€1k</span>
            <span style={{ color: delta === 0 ? undefined : delta > 0 ? "#4C6B40" : "#B23A4B" }}>
              {delta === 0
                ? "at current spend"
                : `${delta > 0 ? "+" : "−"}€${Math.abs(delta).toLocaleString("en-US")} vs current`}
            </span>
            <span>€{Math.round(sliderMax / 1000)}k</span>
          </div>
        </div>

        <ForecastResult data={data} />
      </div>
    </div>
  );
}
