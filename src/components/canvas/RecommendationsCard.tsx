"use client";

import { useState } from "react";
import type { RecommendationsData, RecommendationTag } from "@/types/artifacts";
import { ArtifactShell } from "./ArtifactShell";

function tagStyle(tag: RecommendationTag): React.CSSProperties {
  if (tag === "Quick win") return { background: "#E7EEE0", color: "#4C6B40" };
  if (tag === "Growth") return { background: "#F5E0E3", color: "#B23A4B" };
  return { background: "#E9E8E1", color: "#6B6359" };
}

export function RecommendationsCard({ data }: { data: RecommendationsData }) {
  const [approved, setApproved] = useState<Record<string, boolean>>({});
  const [skipped, setSkipped] = useState<Record<string, boolean>>({});
  const activeCount = data.items.length - Object.values(skipped).filter(Boolean).length;

  return (
    <ArtifactShell className="rounded-card border border-line-3 bg-surface-card p-[16px_18px]">
      <div className="mb-[14px] flex items-center gap-[9px]">
        <div className="font-sans text-[14.5px] font-semibold">Recommended actions</div>
        <span
          className="rounded-pill font-mono text-[11px] font-semibold"
          style={{ color: "#6B6359", background: "#EFEEE7", padding: "2px 7px" }}
        >
          {activeCount}
        </span>
      </div>
      <div className="flex flex-col gap-[10px]">
        {data.items.map((r) => {
          const isApproved = !!approved[r.id];
          const isSkipped = !!skipped[r.id];

          if (isSkipped) {
            return (
              <div
                key={r.id}
                className="animate-fadeUpFast flex items-center justify-between gap-[14px] rounded-[12px] border border-line-4 bg-surface-rec p-[10px_14px]"
              >
                <span className="flex min-w-0 items-center gap-[8px]">
                  <span className="flex-none font-sans text-[13px] text-ink-200">✕</span>
                  <span className="overflow-hidden text-ellipsis whitespace-nowrap font-sans text-[13px] font-medium text-ink-300 line-through">
                    {r.title}
                  </span>
                  <span className="flex-none font-sans text-[12px] text-ink-200">Skipped</span>
                </span>
                <button
                  type="button"
                  onClick={() => setSkipped((s) => ({ ...s, [r.id]: false }))}
                  className="flex-none cursor-pointer rounded-chip font-sans text-[12px] font-semibold"
                  style={{
                    border: "1px solid #DDDBD2",
                    background: "transparent",
                    color: "#8A8072",
                    padding: "5px 11px",
                  }}
                >
                  Undo
                </button>
              </div>
            );
          }

          return (
            <div
              key={r.id}
              className="flex items-center gap-[14px] rounded-[12px] border border-line-4 bg-surface-rec p-[13px_14px]"
            >
              <div className="min-w-0 flex-1">
                <div className="mb-[5px] flex items-center gap-2">
                  <span
                    className="flex-none rounded-pill font-sans text-[10.5px] font-semibold"
                    style={{ padding: "2px 8px", ...tagStyle(r.tag) }}
                  >
                    {r.tag}
                  </span>
                  <span className="font-sans text-[13.5px] font-semibold text-ink-900">
                    {r.title}
                  </span>
                </div>
                <div className="font-sans text-[12.5px] leading-[1.45] text-ink-450">
                  {r.body}
                </div>
              </div>
              <div className="flex flex-none flex-col items-end gap-2">
                <span className="whitespace-nowrap font-mono text-[13px] font-semibold text-pos-700">
                  {r.impact}
                </span>
                {isApproved ? (
                  <span
                    className="flex items-center gap-[5px] rounded-chip font-sans text-[12px] font-semibold"
                    style={{ color: "#4C6B40", background: "#E7EEE0", padding: "6px 12px" }}
                  >
                    ✓ Approved
                  </span>
                ) : (
                  <div className="flex gap-[7px]">
                    <button
                      type="button"
                      onClick={() => setApproved((s) => ({ ...s, [r.id]: true }))}
                      className="cursor-pointer rounded-chip font-sans text-[12px] font-semibold"
                      style={{
                        border: "none",
                        background: "#2B2722",
                        color: "#F2F1EC",
                        padding: "6px 13px",
                      }}
                    >
                      Approve
                    </button>
                    <button
                      type="button"
                      onClick={() => setSkipped((s) => ({ ...s, [r.id]: true }))}
                      className="cursor-pointer rounded-chip font-sans text-[12px] font-semibold"
                      style={{
                        border: "1px solid #DDDBD2",
                        background: "transparent",
                        color: "#8A8072",
                        padding: "6px 11px",
                      }}
                    >
                      Skip
                    </button>
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </ArtifactShell>
  );
}
