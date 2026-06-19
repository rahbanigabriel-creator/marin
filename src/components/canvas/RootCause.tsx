import type { RootCauseData, Tone } from "@/types/artifacts";
import { ArtifactShell } from "./ArtifactShell";

function toneStyle(t: Tone) {
  if (t === "good") return { color: "#4C6B40", bg: "#E7EEE0" };
  if (t === "bad") return { color: "#B23A4B", bg: "#F5E0E3" };
  return { color: "#6B6359", bg: "#E9E8E1" };
}

/** Drivers with no measurable impact (e.g. "≈ €0") read neutral; the rest crimson. */
function impactColor(impact: string): string {
  return /€0|≈|0\b/.test(impact) ? "#857B6D" : "#B23A4B";
}

export function RootCause({ data }: { data: RootCauseData }) {
  const t = toneStyle(data.tone);

  return (
    <ArtifactShell className="rounded-card border border-line-3 bg-surface-card p-[16px_18px]">
      <div className="mb-[10px] flex items-center gap-[9px]">
        <div className="font-sans text-[14.5px] font-semibold text-ink-900">Why {data.metric} moved</div>
        <span
          className="rounded-pill font-mono text-[12px] font-semibold"
          style={{ background: t.bg, color: t.color, padding: "2px 8px" }}
        >
          {data.change}
        </span>
      </div>
      <div className="mb-[14px] font-sans text-[12.5px] leading-[1.5] text-ink-450">{data.summary}</div>
      <div className="flex flex-col gap-[10px]">
        {data.drivers.map((d, i) => (
          <div
            key={i}
            className="flex items-start gap-[12px] rounded-[12px] border border-line-4 bg-surface-rec p-[12px_14px]"
          >
            <span
              className="flex flex-none items-center justify-center font-mono text-[11px] font-semibold"
              style={{ width: 22, height: 22, borderRadius: "50%", background: "#EFEEE7", color: "#6B6359" }}
            >
              {i + 1}
            </span>
            <div className="min-w-0 flex-1">
              <div className="font-sans text-[13.5px] font-semibold text-ink-900">{d.label}</div>
              <div className="mt-[2px] font-sans text-[12.5px] leading-[1.45] text-ink-450">{d.detail}</div>
            </div>
            <span
              className="flex-none whitespace-nowrap font-mono text-[12.5px] font-semibold"
              style={{ color: impactColor(d.impact) }}
            >
              {d.impact}
            </span>
          </div>
        ))}
      </div>
    </ArtifactShell>
  );
}
