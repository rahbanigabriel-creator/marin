import type { PlatformComparisonData } from "@/types/artifacts";
import { ArtifactShell } from "./ArtifactShell";

function verdictStyle(v: "best" | "watch" | "cut") {
  if (v === "best") return { label: "Best", bg: "#E7EEE0", color: "#4C6B40" };
  if (v === "cut") return { label: "Cut", bg: "#F5E0E3", color: "#B23A4B" };
  return { label: "Watch", bg: "#E9E8E1", color: "#6B6359" };
}

function barFill(v: "best" | "watch" | "cut"): string {
  if (v === "best") return "linear-gradient(90deg,#5E7B52,#8A8B6F)";
  if (v === "cut") return "#C9A24A";
  return "linear-gradient(90deg,#9A3D63,#C57E9C)";
}

export function PlatformComparison({ data }: { data: PlatformComparisonData }) {
  const max = Math.max(...data.rows.map((r) => r.roasValue));

  return (
    <ArtifactShell className="rounded-card border border-line-3 bg-surface-card p-[16px_18px]">
      <div className="mb-[14px] flex items-center justify-between">
        <div className="font-sans text-[14.5px] font-semibold text-ink-900">{data.title}</div>
        <div className="font-sans text-[12px] text-ink-300">{data.sub}</div>
      </div>
      <div className="flex flex-col gap-[14px]">
        {data.rows.map((r) => {
          const v = verdictStyle(r.verdict);
          return (
            <div key={r.platform}>
              <div className="mb-[6px] flex items-center justify-between gap-2">
                <span className="flex min-w-0 items-center gap-[8px]">
                  <span
                    className="flex-none"
                    style={{ width: 9, height: 9, borderRadius: 3, background: r.color }}
                  />
                  <span className="font-sans text-[13px] font-medium text-ink-900">
                    {r.platform}
                  </span>
                  <span
                    className="flex-none rounded-pill font-sans text-[10.5px] font-semibold"
                    style={{ background: v.bg, color: v.color, padding: "2px 8px" }}
                  >
                    {v.label}
                  </span>
                </span>
                <span className="flex flex-none items-baseline gap-[12px]">
                  <span className="font-mono text-[11px] text-ink-300">{r.spend}</span>
                  <span className="font-mono text-[11px] text-ink-300">{r.cpa} CPA</span>
                  <span
                    className="font-mono text-[14px] font-semibold text-ink-900"
                    style={{ width: 44, textAlign: "right" }}
                  >
                    {r.roas}
                  </span>
                </span>
              </div>
              <div className="h-[8px] overflow-hidden rounded-[4px] bg-track-1">
                <div
                  className="h-full rounded-[4px]"
                  style={{ width: `${Math.round((r.roasValue / max) * 100)}%`, background: barFill(r.verdict) }}
                />
              </div>
            </div>
          );
        })}
      </div>
    </ArtifactShell>
  );
}
