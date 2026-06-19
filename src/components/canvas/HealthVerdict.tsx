import type { HealthVerdictData, VerdictStatus, Tone } from "@/types/artifacts";
import { ArtifactShell } from "./ArtifactShell";

function statusStyle(s: VerdictStatus) {
  if (s === "healthy") return { dot: "#5E7B52", bg: "#E7EEE0", color: "#4C6B40", label: "Healthy" };
  if (s === "declining") return { dot: "#B23A4B", bg: "#F5E0E3", color: "#B23A4B", label: "Declining" };
  return { dot: "#C9A24A", bg: "#F3ECDD", color: "#8A6D2A", label: "At risk" };
}

function metricColor(t: Tone): string {
  if (t === "good") return "#4C6B40";
  if (t === "bad") return "#B23A4B";
  return "#2B2722";
}

export function HealthVerdict({ data }: { data: HealthVerdictData }) {
  const s = statusStyle(data.status);

  return (
    <ArtifactShell className="rounded-card border border-line-3 bg-surface-card p-[18px]">
      <div className="mb-[12px] flex items-center gap-[9px]">
        <span
          style={{ width: 9, height: 9, borderRadius: "50%", background: s.dot, boxShadow: `0 0 0 4px ${s.bg}` }}
        />
        <span
          className="rounded-pill font-mono text-[10.5px] font-semibold tracking-[0.04em]"
          style={{ background: s.bg, color: s.color, padding: "2px 8px" }}
        >
          {s.label}
        </span>
      </div>
      <div className="font-serif text-[22px] font-medium leading-[1.2] tracking-[-0.01em] text-ink-900">
        {data.headline}
      </div>
      <div className="mt-[6px] font-sans text-[13px] text-ink-400">{data.sub}</div>
      <div
        className="my-[16px] grid gap-[1px] overflow-hidden rounded-[11px] border border-fauxhair"
        style={{ gridTemplateColumns: "repeat(auto-fit,minmax(120px,1fr))", background: "#EAE8E0" }}
      >
        {data.metrics.map((m) => (
          <div key={m.label} className="bg-surface-card p-[11px_13px]">
            <div className="mb-[4px] font-sans text-[11px] font-medium text-ink-300">{m.label}</div>
            <div className="font-mono text-[18px] font-semibold" style={{ color: metricColor(m.tone) }}>
              {m.value}
            </div>
          </div>
        ))}
      </div>
      <div
        className="flex items-start gap-[8px] rounded-[9px] p-[10px_12px]"
        style={{ background: "#F9F9F4" }}
      >
        <span className="flex-none font-sans text-[13px] text-plum">→</span>
        <span className="font-sans text-[13px] font-medium text-ink-800">{data.recommendation}</span>
      </div>
    </ArtifactShell>
  );
}
