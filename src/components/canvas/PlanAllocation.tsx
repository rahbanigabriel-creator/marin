import type { PlanAllocationData } from "@/types/artifacts";
import { ArtifactShell } from "./ArtifactShell";

function fmtEur(n: number): string {
  return "€" + Math.round(n).toLocaleString("en-US");
}

function Cell({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div className="bg-surface-card p-[10px_12px]">
      <div className="mb-[3px] font-sans text-[10.5px] font-medium text-ink-300">{label}</div>
      <div className="font-mono text-[15px] font-semibold" style={{ color: color ?? "#2B2722" }}>
        {value}
      </div>
    </div>
  );
}

export function PlanAllocation({ data }: { data: PlanAllocationData }) {
  return (
    <ArtifactShell className="rounded-card border border-line-3 bg-surface-card p-[16px_18px]">
      <div className="mb-[14px]">
        <div className="font-sans text-[14.5px] font-semibold text-ink-900">Your starter plan</div>
        <div className="mt-[2px] font-sans text-[12px] text-ink-300">
          {data.business} · {data.goal} · {fmtEur(data.budget)}/mo
        </div>
      </div>

      <div className="mb-[16px] flex flex-col gap-[12px]">
        {data.allocations.map((a) => (
          <div key={a.channel}>
            <div className="mb-[5px] flex items-center justify-between gap-2">
              <span className="flex min-w-0 items-center gap-[8px]">
                <span className="flex-none" style={{ width: 9, height: 9, borderRadius: 3, background: a.color }} />
                <span className="font-sans text-[13px] font-medium text-ink-900">{a.channel}</span>
                <span className="overflow-hidden text-ellipsis whitespace-nowrap font-sans text-[12px] text-ink-300">
                  {a.rationale}
                </span>
              </span>
              <span className="flex flex-none items-baseline gap-2">
                <span className="font-mono text-[13px] font-semibold text-ink-900">{fmtEur(a.amount)}</span>
                <span className="font-mono text-[11px] text-ink-300">{a.pct}%</span>
              </span>
            </div>
            <div className="h-[8px] overflow-hidden rounded-[4px] bg-track-1">
              <div className="h-full rounded-[4px]" style={{ width: `${a.pct}%`, background: a.color }} />
            </div>
          </div>
        ))}
      </div>

      <div
        className="mb-[16px] grid gap-[1px] overflow-hidden rounded-[11px] border border-fauxhair"
        style={{ gridTemplateColumns: "repeat(auto-fit,minmax(110px,1fr))", background: "#EAE8E0" }}
      >
        <Cell label="Projected revenue" value={fmtEur(data.projected.revenue)} />
        <Cell label="Conversions" value={data.projected.conversions.toLocaleString("en-US")} />
        <Cell label="Est. ROAS" value={data.projected.roas} color="#4C6B40" />
      </div>

      <div
        className="mb-[16px] flex items-start gap-[8px] rounded-[9px] p-[10px_12px]"
        style={{ background: "#F3ECDD" }}
      >
        <span className="flex-none font-sans text-[12px] font-semibold" style={{ color: "#8A6D2A" }}>
          Realistic floor
        </span>
        <span className="font-sans text-[12.5px] leading-[1.45] text-ink-700">{data.riskNote}</span>
      </div>

      <div className="mb-[8px] font-sans text-[11px] font-medium text-ink-300">First steps</div>
      <div className="flex flex-col gap-[8px]">
        {data.steps.map((s, i) => (
          <div key={i} className="flex items-start gap-[10px]">
            <span
              className="flex flex-none items-center justify-center font-mono text-[11px] font-semibold"
              style={{ width: 20, height: 20, borderRadius: "50%", background: "#F2E2EA", color: "#8A4A66" }}
            >
              {i + 1}
            </span>
            <span className="font-sans text-[13px] leading-[1.45] text-ink-800">{s}</span>
          </div>
        ))}
      </div>
    </ArtifactShell>
  );
}
