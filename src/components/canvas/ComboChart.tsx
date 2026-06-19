"use client";

import { useState } from "react";
import type { ComboChartData } from "@/types/artifacts";
import { comboChartGeometry } from "@/lib/data/chartMath";
import { ArtifactShell } from "./ArtifactShell";

const VBW = 360;
const VBH = 150;
const HPX = 170;

export function ComboChart({ data }: { data: ComboChartData }) {
  const { bars, roasLine, lastX, lastY, points, bands } = comboChartGeometry(
    data.spend,
    data.roas,
  );
  const [active, setActive] = useState<number | null>(null);
  const [pinned, setPinned] = useState(false);
  const n = data.spend.length;

  function hover(i: number) {
    if (!pinned) setActive(i);
  }

  function clickBand(i: number) {
    setActive(i);
    setPinned((p) => (active === i ? !p : true));
  }

  return (
    <ArtifactShell className="rounded-card border border-line-3 bg-surface-card p-[16px_18px_12px]">
      <div className="mb-[14px] flex items-start justify-between">
        <div>
          <div className="font-sans text-[14.5px] font-semibold text-ink-900">{data.title}</div>
          <div className="mt-[2px] font-sans text-[12px] text-ink-300">{data.sub}</div>
        </div>
        <div className="flex items-center gap-[14px]">
          <span className="flex items-center gap-[6px] font-sans text-[11.5px] font-medium text-ink-500">
            <span style={{ width: 10, height: 10, borderRadius: 3, background: "#DBD7CC" }} />
            Spend
          </span>
          <span className="flex items-center gap-[6px] font-sans text-[11.5px] font-medium text-ink-500">
            <span style={{ width: 14, height: 2.5, borderRadius: 2, background: "#9A3D63" }} />
            ROAS
          </span>
        </div>
      </div>
      <div
        className="relative"
        style={{ height: HPX }}
        onMouseLeave={() => {
          if (!pinned) setActive(null);
        }}
      >
        <svg
          viewBox="0 0 360 150"
          preserveAspectRatio="none"
          style={{ width: "100%", height: HPX, overflow: "visible" }}
        >
          <line x1={16} y1={30} x2={344} y2={30} stroke="#EDECE4" strokeWidth={1} />
          <line x1={16} y1={66} x2={344} y2={66} stroke="#EDECE4" strokeWidth={1} />
          <line x1={16} y1={102} x2={344} y2={102} stroke="#EDECE4" strokeWidth={1} />
          <line x1={16} y1={126} x2={344} y2={126} stroke="#E5E3DA" strokeWidth={1.2} />
          {bars.map((b, i) => (
            <rect
              key={i}
              x={b.x}
              y={b.y}
              width={b.w}
              height={b.h}
              rx={2}
              fill={i === active ? "#C7BFAE" : "#DBD7CC"}
            />
          ))}
          <polyline
            points={roasLine}
            fill="none"
            stroke="#9A3D63"
            strokeWidth={2.5}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          {active !== null && (
            <>
              <line
                x1={bands[active].cx}
                x2={bands[active].cx}
                y1={14}
                y2={126}
                stroke="#D8D2C6"
                strokeWidth={1}
                strokeDasharray="3 3"
              />
              <circle
                cx={points[active].x}
                cy={points[active].y}
                r={4}
                fill="#9A3D63"
                stroke="#FFFFFF"
                strokeWidth={1.6}
              />
            </>
          )}
          <circle cx={lastX} cy={lastY} r={3.6} fill="#9A3D63" stroke="#FFFFFF" strokeWidth={1.5} />
          {/* full-height hover/click columns */}
          {bands.map((band, i) => (
            <rect
              key={`hit-${i}`}
              x={band.x}
              y={0}
              width={band.w}
              height={150}
              fill="transparent"
              style={{ cursor: "pointer" }}
              onMouseEnter={() => hover(i)}
              onClick={() => clickBand(i)}
            />
          ))}
        </svg>
        {active !== null && (
          <div
            className="pointer-events-none absolute z-20 -translate-x-1/2 -translate-y-full whitespace-nowrap rounded-[8px] border border-line-3 bg-surface-card px-[10px] py-[7px] shadow-modal"
            style={{
              left: `${(bands[active].cx / VBW) * 100}%`,
              top: (points[active].y / VBH) * HPX - 8,
            }}
          >
            <div className="font-mono text-[10px] font-medium text-ink-300">
              Day {active + 1} of {n}
              {pinned ? " · pinned" : ""}
            </div>
            <div className="mt-[3px] flex items-center gap-[12px]">
              <span className="flex items-center gap-[5px] font-sans text-[12px] font-semibold text-ink-900">
                <span style={{ width: 9, height: 9, borderRadius: 2, background: "#DBD7CC" }} />
                €{data.spend[active].toFixed(1)}k
              </span>
              <span className="flex items-center gap-[5px] font-sans text-[12px] font-semibold text-plum">
                <span style={{ width: 12, height: 2.5, borderRadius: 2, background: "#9A3D63" }} />
                {data.roas[active].toFixed(1)}×
              </span>
            </div>
          </div>
        )}
      </div>
    </ArtifactShell>
  );
}
