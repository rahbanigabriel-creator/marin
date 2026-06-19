"use client";

import { useState } from "react";
import type { KpiCardData, Tone } from "@/types/artifacts";
import { sparkGeometry } from "@/lib/data/chartMath";
import { ArtifactShell } from "./ArtifactShell";

function pillStyle(tone: Tone): React.CSSProperties {
  if (tone === "bad") return { background: "#F5E0E3", color: "#B23A4B" };
  if (tone === "good") return { background: "#E7EEE0", color: "#4C6B40" };
  return { background: "#E9E8E1", color: "#6B6359" };
}

function fmtSpark(v: number): string {
  return v % 1 === 0 ? String(v) : String(+v.toFixed(2));
}

function KpiCard({ kpi }: { kpi: KpiCardData }) {
  const { points, line } = sparkGeometry(kpi.spark);
  const [active, setActive] = useState<number | null>(null);
  const bandW = 80 / (points.length - 1);

  return (
    <div className="flex flex-col gap-[9px] rounded-[13px] border border-line-3 bg-surface-card p-[13px_14px]">
      <div className="flex items-center justify-between gap-2">
        <span className="font-sans text-[12.5px] font-medium text-ink-400">{kpi.label}</span>
        <span
          className="rounded-pill font-mono text-[11px] font-semibold"
          style={{ padding: "2px 7px", ...pillStyle(kpi.tone) }}
        >
          {kpi.delta}
        </span>
      </div>
      <div className="font-mono text-[25px] font-semibold leading-none tracking-[-0.02em] text-ink-900">
        {kpi.value}
      </div>
      <div className="relative" style={{ height: 24 }} onMouseLeave={() => setActive(null)}>
        <svg
          viewBox="0 0 80 28"
          preserveAspectRatio="none"
          style={{ width: "100%", height: 24, overflow: "visible" }}
        >
          <polyline
            points={line}
            fill="none"
            stroke={kpi.sparkColor}
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          {active !== null && (
            <circle
              cx={points[active].x}
              cy={points[active].y}
              r={2.6}
              fill={kpi.sparkColor}
              stroke="#FFFFFF"
              strokeWidth={1.4}
            />
          )}
          {/* full-height hover columns */}
          {points.map((pt, i) => (
            <rect
              key={i}
              x={pt.x - bandW / 2}
              y={0}
              width={bandW}
              height={28}
              fill="transparent"
              style={{ cursor: "pointer" }}
              onMouseEnter={() => setActive(i)}
            />
          ))}
        </svg>
        {active !== null && (
          <div
            className="pointer-events-none absolute z-20 -translate-x-1/2 -translate-y-full whitespace-nowrap rounded-[7px] border border-line-3 bg-surface-card px-[8px] py-[5px] shadow-modal"
            style={{
              left: `${(points[active].x / 80) * 100}%`,
              top: (points[active].y / 28) * 24 - 6,
            }}
          >
            <div className="font-mono text-[9.5px] font-medium text-ink-300">
              {active === points.length - 1 ? "now" : `${points.length - 1 - active}d ago`}
            </div>
            <div className="font-sans text-[12px] font-semibold text-ink-900">
              {fmtSpark(points[active].value)}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export function KpiRow({ kpis }: { kpis: KpiCardData[] }) {
  return (
    <ArtifactShell
      className="grid gap-[10px]"
      style={{ gridTemplateColumns: "repeat(auto-fit,minmax(148px,1fr))" }}
    >
      {kpis.map((k) => (
        <KpiCard key={k.label} kpi={k} />
      ))}
    </ArtifactShell>
  );
}
