import type { KpiCardData, Tone } from "@/types/artifacts";
import { sparkPoints } from "@/lib/data/chartMath";
import { ArtifactShell } from "./ArtifactShell";

function pillStyle(tone: Tone): React.CSSProperties {
  if (tone === "bad") return { background: "#F5E0E3", color: "#B23A4B" };
  if (tone === "good") return { background: "#E7EEE0", color: "#4C6B40" };
  return { background: "#E9E8E1", color: "#6B6359" };
}

function KpiCard({ kpi }: { kpi: KpiCardData }) {
  return (
    <div className="flex flex-col gap-[9px] rounded-[13px] border border-line-3 bg-surface-card p-[13px_14px]">
      <div className="flex items-center justify-between gap-2">
        <span className="font-sans text-[12.5px] font-medium text-ink-400">
          {kpi.label}
        </span>
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
      <svg
        viewBox="0 0 80 28"
        preserveAspectRatio="none"
        style={{ width: "100%", height: 24, overflow: "visible" }}
      >
        <polyline
          points={sparkPoints(kpi.spark)}
          fill="none"
          stroke={kpi.sparkColor}
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
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
