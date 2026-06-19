import type { ComboChartData } from "@/types/artifacts";
import { comboChartGeometry } from "@/lib/data/chartMath";
import { ArtifactShell } from "./ArtifactShell";

export function ComboChart({ data }: { data: ComboChartData }) {
  const { bars, roasLine, lastX, lastY } = comboChartGeometry(data.spend, data.roas);

  return (
    <ArtifactShell className="rounded-card border border-line-3 bg-surface-card p-[16px_18px_12px]">
      <div className="mb-[14px] flex items-start justify-between">
        <div>
          <div className="font-sans text-[14.5px] font-semibold text-ink-900">
            {data.title}
          </div>
          <div className="mt-[2px] font-sans text-[12px] text-ink-300">{data.sub}</div>
        </div>
        <div className="flex items-center gap-[14px]">
          <span className="flex items-center gap-[6px] font-sans text-[11.5px] font-medium text-ink-500">
            <span
              style={{ width: 10, height: 10, borderRadius: 3, background: "#DBD7CC" }}
            />
            Spend
          </span>
          <span className="flex items-center gap-[6px] font-sans text-[11.5px] font-medium text-ink-500">
            <span
              style={{ width: 14, height: 2.5, borderRadius: 2, background: "#9A3D63" }}
            />
            ROAS
          </span>
        </div>
      </div>
      <svg
        viewBox="0 0 360 150"
        preserveAspectRatio="none"
        style={{ width: "100%", height: 170, overflow: "visible" }}
      >
        <line x1={16} y1={30} x2={344} y2={30} stroke="#EDECE4" strokeWidth={1} />
        <line x1={16} y1={66} x2={344} y2={66} stroke="#EDECE4" strokeWidth={1} />
        <line x1={16} y1={102} x2={344} y2={102} stroke="#EDECE4" strokeWidth={1} />
        <line x1={16} y1={126} x2={344} y2={126} stroke="#E5E3DA" strokeWidth={1.2} />
        {bars.map((b, i) => (
          <rect key={i} x={b.x} y={b.y} width={b.w} height={b.h} rx={2} fill="#DBD7CC" />
        ))}
        <polyline
          points={roasLine}
          fill="none"
          stroke="#9A3D63"
          strokeWidth={2.5}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <circle cx={lastX} cy={lastY} r={3.6} fill="#9A3D63" stroke="#FFFFFF" strokeWidth={1.5} />
      </svg>
    </ArtifactShell>
  );
}
