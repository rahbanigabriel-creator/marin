import type { LeaksData, FunnelData } from "@/types/artifacts";
import { leakPct } from "@/lib/data/chartMath";
import { ArtifactShell } from "./ArtifactShell";

export function LeaksCard({ data }: { data: LeaksData }) {
  const maxWasted = Math.max(...data.items.map((l) => l.wasted));
  return (
    <div className="min-w-[260px] flex-[1.25] rounded-card border border-line-3 bg-surface-card p-[16px_18px]">
      <div className="mb-[14px] flex items-center justify-between">
        <div className="font-sans text-[14.5px] font-semibold">Where spend is leaking</div>
        <span
          className="rounded-[7px] font-mono text-[11.5px] font-semibold"
          style={{ color: "#B23A4B", background: "#F5E0E3", padding: "3px 8px" }}
        >
          {data.total}
        </span>
      </div>
      <div className="flex flex-col gap-[13px]">
        {data.items.map((l) => (
          <div key={l.name}>
            <div className="mb-[6px] flex items-center justify-between gap-2">
              <span className="flex min-w-0 items-center gap-2">
                <span
                  className="flex-none rounded-pill font-sans text-[11px] font-semibold"
                  style={{ color: "#857B6D", background: "#EFEEE7", padding: "2px 7px" }}
                >
                  {l.channel}
                </span>
                <span className="overflow-hidden text-ellipsis whitespace-nowrap font-sans text-[13px] font-medium text-ink-900">
                  {l.name}
                </span>
              </span>
              <span className="flex flex-none items-baseline gap-2">
                <span className="font-mono text-[13px] font-semibold text-neg-700">
                  €{l.wasted.toLocaleString("en-US")}
                </span>
                <span className="font-mono text-[11px] font-medium text-ink-300">
                  {l.roas}
                </span>
              </span>
            </div>
            <div className="h-[6px] overflow-hidden rounded-[4px] bg-track-1">
              <div
                className="h-full rounded-[4px]"
                style={{
                  background: "linear-gradient(90deg,#9A3D63,#C57E9C)",
                  width: `${leakPct(l.wasted, maxWasted)}%`,
                }}
              />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export function FunnelCard({ data }: { data: FunnelData }) {
  return (
    <div className="min-w-[230px] flex-1 rounded-card border border-line-3 bg-surface-card p-[16px_18px]">
      <div className="mb-[14px] font-sans text-[14.5px] font-semibold">Conversion funnel</div>
      <div className="flex flex-col gap-[11px]">
        {data.stages.map((f) => (
          <div key={f.label}>
            <div className="mb-[5px] flex items-baseline justify-between">
              <span className="font-sans text-[12.5px] font-medium text-ink-700">{f.label}</span>
              <span className="flex items-baseline gap-2">
                <span className="font-mono text-[10.5px] font-medium text-ink-200">{f.rate}</span>
                <span className="font-mono text-[13px] font-semibold text-ink-900">{f.value}</span>
              </span>
            </div>
            <div className="h-[9px] overflow-hidden rounded-[5px] bg-track-2">
              <div
                className="h-full rounded-[5px]"
                style={{ background: f.color, width: `${f.widthPct}%` }}
              />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export function LeaksFunnelRow({
  leaks,
  funnel,
}: {
  leaks: LeaksData;
  funnel: FunnelData;
}) {
  return (
    <ArtifactShell className="flex flex-wrap gap-[14px]">
      <LeaksCard data={leaks} />
      <FunnelCard data={funnel} />
    </ArtifactShell>
  );
}
