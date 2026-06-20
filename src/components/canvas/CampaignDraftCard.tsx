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

function EditField({
  label,
  value,
  mono,
  onChange,
}: {
  label: string;
  value: string;
  mono?: boolean;
  onChange: (v: string) => void;
}) {
  return (
    <label className="flex flex-col gap-[5px]">
      <span className="font-sans text-[11px] font-medium text-ink-300">{label}</span>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={`rounded-[9px] border border-line-1 bg-surface-card p-[8px_10px] text-[13.5px] font-semibold text-ink-900 outline-none focus:border-plum ${
          mono ? "font-mono" : "font-sans"
        }`}
      />
    </label>
  );
}

export function CampaignDraftCard({ data }: { data: CampaignDraftData }) {
  const [launched, setLaunched] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [editing, setEditing] = useState(false);
  const [spec, setSpec] = useState(data.spec);
  const [draft, setDraft] = useState(data.spec);
  const [edited, setEdited] = useState(false);

  function openEditor() {
    setDraft(spec);
    setEditing(true);
  }

  function save() {
    setSpec(draft);
    setEdited(
      draft.objective !== data.spec.objective ||
        draft.budget !== data.spec.budget ||
        draft.audience !== data.spec.audience,
    );
    setEditing(false);
  }

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
            <div className="flex items-center gap-[8px]">
              <div className="font-sans text-[15px] font-semibold text-ink-900">{data.title}</div>
              {edited && (
                <span
                  className="flex-none rounded-pill font-mono text-[10px] font-semibold"
                  style={{ color: "#8A4A66", background: "#F2E2EA", padding: "2px 7px" }}
                >
                  Edited
                </span>
              )}
            </div>
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
        <SpecCell label="Objective" value={spec.objective} />
        <SpecCell label="Monthly budget" value={spec.budget} mono />
        <SpecCell label="Audience" value={spec.audience} />
        <SpecCell label="Est. ROAS" value={spec.estRoas} mono color="#4C6B40" />
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
            Live in your connected ad account · first results in ~24h
          </span>
        </div>
      ) : editing ? (
        <div className="animate-fadeUpFast flex flex-col gap-[12px]">
          <div
            className="grid gap-[10px]"
            style={{ gridTemplateColumns: "repeat(auto-fit,minmax(150px,1fr))" }}
          >
            <EditField
              label="Objective"
              value={draft.objective}
              onChange={(v) => setDraft((d) => ({ ...d, objective: v }))}
            />
            <EditField
              label="Monthly budget"
              value={draft.budget}
              mono
              onChange={(v) => setDraft((d) => ({ ...d, budget: v }))}
            />
            <EditField
              label="Audience"
              value={draft.audience}
              onChange={(v) => setDraft((d) => ({ ...d, audience: v }))}
            />
          </div>
          <div className="flex gap-[9px]">
            <button
              type="button"
              onClick={save}
              className="cursor-pointer rounded-[9px] font-sans text-[13px] font-semibold"
              style={{ border: "none", background: "#2B2722", color: "#F2F1EC", padding: "9px 18px" }}
            >
              Save draft
            </button>
            <button
              type="button"
              onClick={() => setEditing(false)}
              className="cursor-pointer rounded-[9px] font-sans text-[13px] font-semibold"
              style={{
                border: "1px solid #DDDBD2",
                background: "#FFFFFF",
                color: "#6B6359",
                padding: "9px 16px",
              }}
            >
              Cancel
            </button>
          </div>
        </div>
      ) : confirming ? (
        <div className="flex flex-col gap-[10px] rounded-[10px] border border-line-3 bg-surface-chip p-[12px_14px]">
          <span className="font-sans text-[12.5px] leading-[1.5] text-ink-700">
            This will publish to your connected ad account and start spending your budget. You can
            pause anytime.
          </span>
          <div className="flex gap-[9px]">
            <button
              type="button"
              onClick={() => {
                setConfirming(false);
                setLaunched(true);
              }}
              className="cursor-pointer rounded-[9px] font-sans text-[13px] font-semibold"
              style={{ border: "none", background: "#9A3D63", color: "#FFFFFF", padding: "9px 18px" }}
            >
              Confirm &amp; launch
            </button>
            <button
              type="button"
              onClick={() => setConfirming(false)}
              className="cursor-pointer rounded-[9px] font-sans text-[13px] font-semibold"
              style={{ border: "1px solid #DDDBD2", background: "#FFFFFF", color: "#6B6359", padding: "9px 16px" }}
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <div className="flex gap-[9px]">
          <button
            type="button"
            onClick={() => setConfirming(true)}
            className="cursor-pointer rounded-[9px] font-sans text-[13px] font-semibold"
            style={{ border: "none", background: "#9A3D63", color: "#FFFFFF", padding: "9px 18px" }}
          >
            Launch campaign
          </button>
          <button
            type="button"
            onClick={openEditor}
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
