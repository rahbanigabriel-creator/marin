"use client";

import { useState } from "react";
import { RangeSlider } from "@/components/ui/RangeSlider";
import { project, CURRENT_SPEND } from "@/lib/forecast/project";
import { ForecastResult } from "@/components/canvas/ForecastResult";

export function ForecastScreen({ onClose }: { onClose: () => void }) {
  const [budget, setBudget] = useState(60000);
  const data = project(budget);
  const delta = budget - CURRENT_SPEND;

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto bg-surface-page p-[24px]">
      <div className="mx-auto w-full max-w-[720px]">
        <div className="mb-[16px] flex items-center justify-between">
          <div>
            <div className="font-serif text-[22px] font-medium tracking-[-0.01em] text-ink-900">
              Budget forecast
            </div>
            <div className="mt-[2px] font-sans text-[13px] text-ink-400">
              Drag to model monthly spend — projections update live.
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="cursor-pointer rounded-btn border border-line-1 bg-surface-chip font-sans text-[13px] font-semibold text-ink-700"
            style={{ padding: "8px 14px" }}
          >
            ← Back
          </button>
        </div>

        <div className="mb-[16px] rounded-card border border-line-2 bg-surface-card p-[18px]">
          <div className="mb-[8px] flex items-baseline justify-between">
            <span className="font-sans text-[12.5px] font-medium text-ink-400">Monthly budget</span>
            <span className="font-mono text-[15px] font-semibold text-ink-900">
              €{budget.toLocaleString("en-US")}
            </span>
          </div>
          <RangeSlider value={budget} min={5000} max={100000} step={1000} onChange={setBudget} />
          <div className="mt-[8px] flex justify-between font-mono text-[10.5px] text-ink-300">
            <span>€5k</span>
            <span style={{ color: delta === 0 ? undefined : delta > 0 ? "#4C6B40" : "#B23A4B" }}>
              {delta === 0
                ? "at current spend"
                : `${delta > 0 ? "+" : "−"}€${Math.abs(delta).toLocaleString("en-US")} vs current`}
            </span>
            <span>€100k</span>
          </div>
        </div>

        <ForecastResult data={data} />
      </div>
    </div>
  );
}
