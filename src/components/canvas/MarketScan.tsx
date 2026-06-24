import type { MarketScanData } from "@/types/artifacts";
import { ArtifactShell } from "./ArtifactShell";

/**
 * The hero strategy card — a live-agent Market Scan. Optional headline stats, a
 * dark "Marpin's read" callout, ranked share-of-market bars with the user's own
 * row highlighted, an optional momentum line, and the openings where they can
 * win. Mirrors the mockup's Market Scan canvas but is filled by the live agent.
 */
export function MarketScan({ data }: { data: MarketScanData }) {
  const max = Math.max(...data.field.map((f) => f.sharePct), 1);

  return (
    <ArtifactShell className="rounded-card border border-line-3 bg-surface-card p-[16px_18px]">
      <div className="mb-[12px] flex items-center justify-between">
        <div className="font-sans text-[14.5px] font-semibold text-ink-900">{data.title}</div>
        <div className="font-mono text-[10.5px] font-semibold uppercase tracking-[0.08em] text-ink-300">
          Market scan
        </div>
      </div>

      {data.stats && data.stats.length > 0 && (
        <div className="mb-[14px] flex flex-wrap gap-[20px]">
          {data.stats.map((s) => (
            <div key={s.label} className="min-w-0">
              <div className="font-serif text-[24px] font-medium leading-[1.1] text-ink-900">{s.value}</div>
              <div className="mt-[2px] font-sans text-[11.5px] text-ink-400">
                {s.label}
                {s.sub ? <span className="text-ink-300"> · {s.sub}</span> : null}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Marpin's read — the dark callout */}
      <div
        className="mb-[16px] rounded-[10px] p-[13px_15px]"
        style={{ background: "#2B2722", color: "#F2F1EC" }}
      >
        <div className="mb-[4px] font-mono text-[9.5px] font-semibold uppercase tracking-[0.1em] text-clay">
          Marpin&apos;s read
        </div>
        <div className="font-serif text-[14.5px] italic leading-[1.45]">{data.read}</div>
      </div>

      {/* The field — ranked by share of market */}
      <div className="mb-[6px] font-mono text-[10px] font-semibold uppercase tracking-[0.08em] text-ink-300">
        The field · by market share
      </div>
      <div className="flex flex-col gap-[10px]">
        {data.field.map((f) => (
          <div key={f.name}>
            <div className="mb-[5px] flex items-center justify-between gap-2">
              <span
                className="min-w-0 truncate font-sans text-[13px]"
                style={{ color: f.you ? "#9A3D63" : "#2B2722", fontWeight: f.you ? 700 : 500 }}
              >
                {f.name}
                {f.you ? " · you" : ""}
              </span>
              <span
                className="flex-none font-mono text-[12.5px] font-semibold"
                style={{ color: f.you ? "#9A3D63" : "#2B2722", width: 52, textAlign: "right" }}
              >
                {f.sharePct}%
              </span>
            </div>
            <div className="h-[8px] overflow-hidden rounded-[4px] bg-track-1">
              <div
                className="h-full rounded-[4px]"
                style={{
                  width: `${Math.round((f.sharePct / max) * 100)}%`,
                  background: f.you ? "linear-gradient(90deg,#9A3D63,#C57E9C)" : "#B9B3A6",
                }}
              />
            </div>
          </div>
        ))}
      </div>

      {data.momentum && (
        <div className="mt-[16px] border-t border-line-2 pt-[12px]">
          <div className="mb-[7px] font-mono text-[10px] font-semibold uppercase tracking-[0.08em] text-ink-300">
            Momentum · you vs market
          </div>
          <div className="flex items-baseline gap-[18px]">
            <div>
              <span className="font-serif text-[20px] font-medium text-plum">{data.momentum.you}</span>
              <span className="ml-[6px] font-sans text-[11.5px] text-ink-400">you</span>
            </div>
            <div>
              <span className="font-serif text-[20px] font-medium text-ink-700">{data.momentum.market}</span>
              <span className="ml-[6px] font-sans text-[11.5px] text-ink-400">market avg</span>
            </div>
            {data.momentum.label ? (
              <div className="ml-auto font-sans text-[11.5px] text-ink-400">{data.momentum.label}</div>
            ) : null}
          </div>
        </div>
      )}

      {data.openings && data.openings.length > 0 && (
        <div className="mt-[16px] border-t border-line-2 pt-[12px]">
          <div className="mb-[8px] font-mono text-[10px] font-semibold uppercase tracking-[0.08em] text-ink-300">
            Where you can win
          </div>
          <div className="flex flex-col gap-[7px]">
            {data.openings.map((o, i) => (
              <div key={i} className="flex items-start gap-[9px]">
                <span
                  className="mt-[1px] flex-none font-mono text-[11px] font-semibold text-plum"
                  style={{ width: 16 }}
                >
                  {i + 1}
                </span>
                <span className="font-sans text-[13px] leading-[1.45] text-ink-700">{o}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {data.cta && (
        <div className="mt-[14px] font-sans text-[12.5px] font-medium text-plum-muted2">{data.cta}</div>
      )}
    </ArtifactShell>
  );
}
