import type { ForecastResultData } from "@/types/artifacts";
import { forecastGeometry } from "@/lib/data/chartMath";
import { ArtifactShell } from "./ArtifactShell";

function fmtEur(n: number): string {
  return "€" + Math.round(n).toLocaleString("en-US");
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex-1 rounded-[9px] bg-surface-chip p-[9px_11px]">
      <div className="font-sans text-[10.5px] font-medium text-ink-300">{label}</div>
      <div className="mt-[2px] font-mono text-[14px] font-semibold text-ink-900">{value}</div>
    </div>
  );
}

export function ForecastResult({ data }: { data: ForecastResultData }) {
  const g = forecastGeometry(data.curve, data.budget);

  return (
    <ArtifactShell className="rounded-card border border-line-3 bg-surface-card p-[16px_18px_14px]">
      <div className="mb-[12px] flex items-start justify-between">
        <div>
          <div className="font-sans text-[14.5px] font-semibold text-ink-900">Projected revenue</div>
          <div className="mt-[2px] font-sans text-[12px] text-ink-300">
            At {fmtEur(data.budget)}/mo budget
          </div>
        </div>
        <div className="text-right">
          <div className="font-mono text-[22px] font-semibold leading-none text-ink-900">
            {fmtEur(data.revenue)}
          </div>
          <div className="mt-[3px] font-mono text-[11px] text-ink-300">
            {fmtEur(data.revenueLow)}–{fmtEur(data.revenueHigh)}
          </div>
        </div>
      </div>
      <svg
        viewBox="0 0 360 150"
        preserveAspectRatio="none"
        style={{ width: "100%", height: 150, overflow: "visible" }}
      >
        <path d={g.band} fill="#F2E2EA" opacity={0.65} />
        <path
          d={g.line}
          fill="none"
          stroke="#9A3D63"
          strokeWidth={2.5}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <circle cx={g.projX} cy={g.projY} r={4} fill="#9A3D63" stroke="#FFFFFF" strokeWidth={1.6} />
      </svg>
      <div className="mt-[12px] flex gap-[10px]">
        <Stat label="Proj. ROAS" value={data.roas.toFixed(1) + "×"} />
        <Stat label="Conversions" value={data.conversions.toLocaleString("en-US")} />
        <Stat label="Revenue" value={fmtEur(data.revenue)} />
      </div>
    </ArtifactShell>
  );
}
