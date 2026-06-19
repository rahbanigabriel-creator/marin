"use client";

import { useState } from "react";
import type { CampaignDraftData } from "@/types/artifacts";
import { ArtifactShell } from "./ArtifactShell";

function SpecCell({ label, value, mono, color }: { label: string; value: string; mono?: boolean; color?: string }) {
  return (
    <div className="bg-surface-card p-[11px_13px]">
      <div className="mb-[4px] font-sans text-[11px] font-medium text-ink-300">{label}</div>
      <div
        className={`text-[13.5px] font-semibold ${mono ? "font-mono" : "font-sans"}`}
        style={{ color: color ?? "#2B2722" }}
      >
        {value}
      </div>
    </div>
  );
}

export function CampaignDraftCard({ data }: { data: CampaignDraftData }) {
  const [launched, setLaunched] = useState(false);

  return (
    <ArtifactShell
      className="rounded-card border border-line-6 p-[18px_18px_16px]"
      style={{ background: "linear-gradient(180deg,#FFFFFF,#F9F9F4)" }}
    >
      <div className="mb-[14px] flex items-center justify-between gap-[10px]">
        <div className="flex items-center gap-[9px]">
          <span
            style={{
              width: 7,
              height: 7,
              borderRadius: "50%",
              background: "#9A3D63",
              boxShadow: "0 0 0 4px #F5E0E3",
            }}
          />
          <div>
            <div className="font-sans text-[15px] font-semibold text-ink-900">{data.title}</div>
            <div className="mt-[1px] font-sans text-[12px] text-ink-300">{data.sub}</div>
          </div>
        </div>
      </div>

      <div
        className="mb-[14px] grid overflow-hidden rounded-[11px] border border-fauxhair"
        style={{
          gridTemplateColumns: "repeat(auto-fit,minmax(130px,1fr))",
          gap: 1,
          background: "#EAE8E0",
        }}
      >
        <SpecCell label="Objective" value={data.spec.objective} />
        <SpecCell label="Monthly budget" value={data.spec.budget} mono />
        <SpecCell label="Audience" value={data.spec.audience} />
        <SpecCell label="Est. ROAS" value={data.spec.estRoas} mono color="#4C6B40" />
      </div>

      <div className="mb-[8px] font-sans text-[11px] font-medium text-ink-300">
        Creative variants
      </div>
      <div className="mb-[16px] flex gap-[10px]">
        {data.creatives.map((c) => (
          <div
            key={c}
            className="flex flex-none flex-col items-center justify-end rounded-[9px] border border-line-6 pb-[8px]"
            style={{
              width: 74,
              height: 120,
              backgroundImage:
                "repeating-linear-gradient(135deg,#EFEEE7 0 8px,#E9E7DE 8px 16px)",
            }}
          >
            <span className="font-mono text-[9px] font-medium text-ink-200">{c}</span>
          </div>
        ))}
        <div className="flex min-w-0 flex-1 flex-col justify-center gap-[7px]">
          <div className="font-sans text-[12.5px] leading-[1.5] text-ink-450">
            {data.explainer}
          </div>
        </div>
      </div>

      {launched ? (
        <div
          className="flex items-center gap-[9px] rounded-[9px] p-[10px_14px]"
          style={{ background: "#E7EEE0" }}
        >
          <span className="font-sans text-[13px] font-semibold text-pos-700">
            ✓ Campaign launched
          </span>
          <span className="font-sans text-[12.5px] text-pos-soft">
            Live in TikTok Ads Manager · first results in ~24h
          </span>
        </div>
      ) : (
        <div className="flex gap-[9px]">
          <button
            type="button"
            onClick={() => setLaunched(true)}
            className="cursor-pointer rounded-[9px] font-sans text-[13px] font-semibold"
            style={{ border: "none", background: "#9A3D63", color: "#FFFFFF", padding: "9px 18px" }}
          >
            Launch campaign
          </button>
          <button
            type="button"
            className="cursor-pointer rounded-[9px] font-sans text-[13px] font-semibold"
            style={{
              border: "1px solid #DDDBD2",
              background: "#FFFFFF",
              color: "#6B6359",
              padding: "9px 16px",
            }}
          >
            Open editor
          </button>
        </div>
      )}
    </ArtifactShell>
  );
}
