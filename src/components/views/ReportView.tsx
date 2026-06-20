"use client";

import { useState } from "react";
import type { Scenario } from "@/types/scenario";
import { gatesForStep } from "@/lib/streaming/stepModel";
import { AnswerCanvas } from "@/components/canvas/AnswerCanvas";
import { ThinkingDots } from "@/components/ui/ThinkingDots";

interface ReportViewProps {
  step: number;
  typed: string;
  question: string;
  scenario: Scenario;
  workspace: string;
}

export function ReportView({ step, typed, question, scenario, workspace }: ReportViewProps) {
  const g = gatesForStep(step, typed.length, scenario.lead.length);
  const [copied, setCopied] = useState(false);

  function copyLink() {
    setCopied(true);
    if (navigator.clipboard) navigator.clipboard.writeText(window.location.href).catch(() => {});
  }

  return (
    <div className="min-h-0 flex-1 overflow-y-auto bg-surface-page">
      <div className="mx-auto w-full max-w-report p-[18px_32px_40px]">
        {/* export bar — not part of the printed document */}
        <div className="no-print mb-[18px] flex items-center justify-between">
          <span className="font-mono text-[11px] font-medium tracking-[0.04em] text-ink-300">
            Last 30 days
          </span>
          <div className="flex gap-[8px]">
            <button
              type="button"
              onClick={copyLink}
              className="cursor-pointer rounded-[9px] border border-line-1 bg-surface-chip font-sans text-[12px] font-semibold text-ink-700"
              style={{ padding: "7px 12px" }}
            >
              {copied ? "✓ Link copied" : "Copy link"}
            </button>
            <button
              type="button"
              onClick={() => window.print()}
              className="cursor-pointer rounded-[9px] font-sans text-[12px] font-semibold text-white"
              style={{ border: "none", background: "#2B2722", padding: "7px 14px" }}
            >
              ↧ Export PDF
            </button>
          </div>
        </div>

        {/* the printable document */}
        <div id="report-root">
          <div className="mb-[14px] flex items-center justify-between border-b border-line-3 pb-[12px]">
            <div className="flex items-center gap-[8px]">
              <div
                className="flex items-center justify-center font-serif text-[13px] font-semibold"
                style={{ width: 24, height: 24, borderRadius: 6, background: "#9A3D63", color: "#FBF6EE" }}
              >
                m
              </div>
              <span className="font-mono text-[12px] font-semibold tracking-[0.05em] text-plum-muted2">
                MARIN REPORT
              </span>
            </div>
            <span className="font-mono text-[11px] font-medium text-ink-300">
              {workspace} · last 30 days
            </span>
          </div>

          <h1 className="m-0 mb-[10px] max-w-[760px] font-serif text-[30px] font-medium leading-[1.18] tracking-[-0.01em] text-ink-900">
            {question}
          </h1>
          <div className="mb-[24px] font-sans text-[13.5px] text-ink-400">
            Prepared for {workspace} · sourced from Google Ads, Meta Ads &amp; GA4
          </div>

          {g.showTyped && (
            <div className="mb-[20px]">
              <div className="mb-[6px] font-mono text-[10.5px] font-semibold tracking-[0.06em] text-ink-300">
                EXECUTIVE SUMMARY
              </div>
              <div className="max-w-[720px] border-l-[3px] border-plum-hairline pl-[16px] font-sans text-[16px] leading-[1.7] text-ink-800">
                {typed}
              </div>
            </div>
          )}

          {g.showClosing && (
            <div
              className="mb-[26px] flex max-w-[720px] items-start gap-[10px] rounded-[10px] p-[12px_16px]"
              style={{ background: "#F5E0E3" }}
            >
              <span className="flex-none font-sans text-[13px] font-semibold text-plum-deep">
                Recommended decision
              </span>
              <span className="font-sans text-[13.5px] leading-[1.5] text-ink-800">
                {scenario.closing.thread}
              </span>
            </div>
          )}

          {g.canvasReady ? (
            <AnswerCanvas step={step} artifacts={scenario.artifacts} />
          ) : (
            <div className="flex items-center gap-[10px] py-[30px] text-ink-200">
              <ThinkingDots size={8} />
              <span className="ml-[4px] font-sans text-[13px] font-medium">Building report…</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
