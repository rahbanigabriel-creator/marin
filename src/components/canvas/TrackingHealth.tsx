import type { TrackingHealthData, CheckStatus } from "@/types/artifacts";
import { ArtifactShell } from "./ArtifactShell";

function checkStyle(s: CheckStatus) {
  if (s === "pass") return { dot: "#5E7B52", color: "#4C6B40", bg: "#EFEEE7", label: "Pass" };
  if (s === "fail") return { dot: "#B23A4B", color: "#B23A4B", bg: "#F5E0E3", label: "Fail" };
  return { dot: "#C9A24A", color: "#8A6D2A", bg: "#F3ECDD", label: "Warn" };
}

export function TrackingHealth({ data }: { data: TrackingHealthData }) {
  const issues = data.checks.filter((c) => c.status !== "pass").length;

  return (
    <ArtifactShell className="rounded-card border border-line-3 bg-surface-card p-[16px_18px]">
      <div className="mb-[4px] flex items-center justify-between">
        <div className="font-sans text-[14.5px] font-semibold text-ink-900">{data.title}</div>
        <span
          className="rounded-[7px] font-mono text-[11.5px] font-semibold"
          style={{
            color: issues ? "#B23A4B" : "#4C6B40",
            background: issues ? "#F5E0E3" : "#E7EEE0",
            padding: "3px 8px",
          }}
        >
          {issues ? `${issues} issues` : "All clear"}
        </span>
      </div>
      <div className="mb-[12px] font-sans text-[12.5px] text-ink-450">{data.summary}</div>
      <div className="flex flex-col">
        {data.checks.map((c, i) => {
          const s = checkStyle(c.status);
          return (
            <div
              key={i}
              className="flex items-center gap-[11px] p-[10px_2px]"
              style={i === 0 ? undefined : { borderTop: "1px solid var(--border-4)" }}
            >
              <span
                className="flex-none"
                style={{ width: 9, height: 9, borderRadius: "50%", background: s.dot }}
              />
              <span className="min-w-0 flex-1">
                <span className="font-sans text-[13px] font-medium text-ink-900">{c.label}</span>
                <span className="mt-[1px] block font-sans text-[12px] text-ink-300">{c.detail}</span>
              </span>
              <span
                className="flex-none rounded-pill font-sans text-[10.5px] font-semibold"
                style={{ color: s.color, background: s.bg, padding: "2px 8px" }}
              >
                {s.label}
              </span>
            </div>
          );
        })}
      </div>
    </ArtifactShell>
  );
}
