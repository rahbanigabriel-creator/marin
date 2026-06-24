"use client";

import { useState } from "react";
import type { ActionPlanData, ActionStatus, ActionStep } from "@/types/artifacts";
import { ArtifactShell } from "./ArtifactShell";

type StepState = { status: ActionStatus; resultUrl?: string; error?: string };

/**
 * The executable action plan — the operating surface. Situation summary, then
 * prioritized steps each with a one-click button driven by its execMode:
 * prepare → copy the ready-to-ship brief; guided → open the platform prefilled;
 * api → run it via /api/actions/execute (server runs by actionId only). Owns its
 * own step state so status updates are local, decoupled from the answer stream.
 */
export function CanvasActionPlan({ data }: { data: ActionPlanData }) {
  const [states, setStates] = useState<Record<string, StepState>>(() =>
    Object.fromEntries(data.steps.map((s) => [s.actionId, { status: s.status } as StepState])),
  );

  const patch = (id: string, s: StepState) => setStates((m) => ({ ...m, [id]: s }));

  async function run(step: ActionStep) {
    // prepare → just copy the ready-made content; nothing leaves the browser.
    if (step.execMode === "prepare") {
      try {
        await navigator.clipboard.writeText(step.description);
      } catch {
        /* clipboard blocked — the text is on screen anyway */
      }
      patch(step.actionId, { status: "manual" });
      return;
    }
    patch(step.actionId, { status: "executing" });
    try {
      const res = await fetch("/api/actions/execute", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ actionId: step.actionId }),
      });
      const json = (await res.json()) as {
        ok?: boolean;
        reason?: string;
        status?: ActionStatus;
        resultUrl?: string;
        error?: string;
      };
      if (!res.ok || json.ok === false) {
        patch(step.actionId, { status: "failed", error: json.reason || json.error || "Couldn't run this yet." });
        return;
      }
      const status = json.status ?? "succeeded";
      patch(step.actionId, { status, resultUrl: json.resultUrl, error: json.error });
      // guided steps return a prefilled deep-link — open it for the user.
      if (status === "manual" && json.resultUrl) window.open(json.resultUrl, "_blank", "noopener");
    } catch {
      patch(step.actionId, { status: "failed", error: "Network error — try again." });
    }
  }

  return (
    <ArtifactShell className="rounded-card border border-line-3 bg-surface-card p-[18px_20px]">
      <span
        className="mb-[9px] inline-block rounded-pill font-mono text-[10.5px] font-semibold tracking-[0.04em]"
        style={{ color: "#8A4A66", background: "#F2E2EA", padding: "3px 9px" }}
      >
        ACTION PLAN
      </span>
      <div className="font-serif text-[19px] font-medium leading-[1.2] text-ink-900">{data.title}</div>
      {data.subtitle && (
        <div className="mt-[5px] font-sans text-[13px] leading-[1.5] text-ink-400">{data.subtitle}</div>
      )}

      {data.situation && data.situation.length > 0 && (
        <div className="mt-[14px] flex flex-col gap-[12px]">
          {data.situation.map((sec, i) => (
            <div key={i}>
              <div className="mb-[6px] font-sans text-[13px] font-semibold text-ink-900">{sec.heading}</div>
              <ul className="flex flex-col gap-[5px]">
                {sec.points.map((p, j) => (
                  <li key={j} className="flex gap-[8px] font-sans text-[13px] leading-[1.5] text-ink-450">
                    <span
                      className="mt-[7px] flex-none"
                      style={{ width: 5, height: 5, borderRadius: "50%", background: "#9A3D63" }}
                    />
                    <span className="min-w-0">{p}</span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}

      <div className="mt-[16px] flex flex-col gap-[10px]">
        {data.steps.map((step, i) => {
          const st = states[step.actionId] ?? { status: step.status };
          const done = st.status === "succeeded" || st.status === "manual";
          const running = st.status === "executing";
          return (
            <div
              key={step.actionId}
              className="flex items-start gap-[12px] rounded-[12px] border border-line-4 bg-surface-rec p-[13px_14px]"
            >
              <div className="flex-none pt-[2px] font-mono text-[12px] font-semibold text-ink-300">{i + 1}</div>
              <div className="min-w-0 flex-1">
                <div className="font-sans text-[13.5px] font-semibold text-ink-900">{step.title}</div>
                <div className="mt-[3px] whitespace-pre-wrap font-sans text-[12.5px] leading-[1.5] text-ink-450">
                  {step.description}
                </div>
                {step.needsAsset && (
                  <div className="mt-[5px] font-sans text-[11.5px] text-ink-300">
                    Needs an image/video — asset upload is coming; use the brief for now.
                  </div>
                )}
                {st.error && (
                  <div className="mt-[5px] font-sans text-[11.5px] font-medium" style={{ color: "#B23A4B" }}>
                    {st.error}
                  </div>
                )}
              </div>
              <div className="flex flex-none flex-col items-end">
                {done ? (
                  st.resultUrl ? (
                    <a
                      href={st.resultUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="rounded-chip font-sans text-[12px] font-semibold"
                      style={{ color: "#4C6B40", background: "#E7EEE0", padding: "6px 12px" }}
                    >
                      ✓ Open ▸
                    </a>
                  ) : (
                    <span
                      className="rounded-chip font-sans text-[12px] font-semibold"
                      style={{ color: "#4C6B40", background: "#E7EEE0", padding: "6px 12px" }}
                    >
                      ✓ {step.execMode === "prepare" ? "Copied" : "Done"}
                    </span>
                  )
                ) : (
                  <button
                    type="button"
                    disabled={running}
                    onClick={() => run(step)}
                    className="cursor-pointer whitespace-nowrap rounded-chip font-sans text-[12px] font-semibold disabled:opacity-60"
                    style={{ border: "none", background: "#2B2722", color: "#F2F1EC", padding: "6px 13px" }}
                  >
                    {running ? "Working…" : step.ctaLabel}
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </ArtifactShell>
  );
}
