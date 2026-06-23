"use client";

import type { BriefData } from "@/types/artifacts";
import { ArtifactShell } from "./ArtifactShell";

/**
 * The flexible "brief" card — the workhorse the agent renders for answers that
 * don't depend on connected data (strategy, competitor analysis, audits, channel
 * plans, campaign briefs, SEO roadmaps). A clean title + tagged sections of
 * bullets, with an optional next-step / proposal footer.
 */
export function CanvasBrief({ data }: { data: BriefData }) {
  return (
    <ArtifactShell className="rounded-card border border-line-3 bg-surface-card p-[18px_20px]">
      <div className="mb-[14px]">
        {data.label && (
          <span
            className="mb-[9px] inline-block rounded-pill font-mono text-[10.5px] font-semibold tracking-[0.04em]"
            style={{ color: "#8A4A66", background: "#F2E2EA", padding: "3px 9px" }}
          >
            {data.label.toUpperCase()}
          </span>
        )}
        <div className="font-serif text-[19px] font-medium leading-[1.2] text-ink-900">
          {data.title}
        </div>
        {data.subtitle && (
          <div className="mt-[5px] font-sans text-[13px] leading-[1.5] text-ink-400">
            {data.subtitle}
          </div>
        )}
      </div>

      <div className="flex flex-col gap-[15px]">
        {data.sections.map((section, i) => (
          <div key={i}>
            {section.heading && (
              <div className="mb-[7px] font-sans text-[13px] font-semibold text-ink-900">
                {section.heading}
              </div>
            )}
            <ul className="flex flex-col gap-[6px]">
              {section.points.map((point, j) => (
                <li
                  key={j}
                  className="flex gap-[9px] font-sans text-[13px] leading-[1.5] text-ink-450"
                >
                  <span
                    className="mt-[7px] flex-none"
                    style={{ width: 5, height: 5, borderRadius: "50%", background: "#9A3D63" }}
                  />
                  <span className="min-w-0">{point}</span>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>

      {data.cta && (
        <div
          className="mt-[16px] rounded-[10px] border border-line-4 p-[11px_13px] font-sans text-[12.5px] leading-[1.5] text-plum-deep"
          style={{ background: "#FBF4F7" }}
        >
          {data.cta}
        </div>
      )}
    </ArtifactShell>
  );
}
