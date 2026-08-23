"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { LuSparkles, LuX } from "react-icons/lu";

import type { PaidLaunchTemplate } from "@/lib/paid-drafts/types";

import {
  PLATFORM_LABEL,
  TEMPLATE_LABEL,
  templatesForPlatform,
  type PaidConnectionOption,
} from "./paid-draft-form";

const focusRing = "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-plum";
const field = `w-full rounded-[7px] border border-line-1 bg-surface-card px-[10px] py-[8px] text-[13px] text-ink-900 outline-none focus:border-plum-border disabled:bg-track-1 ${focusRing}`;

export function PaidDraftGenerationDialog({
  connections,
  busy,
  error,
  onClose,
  onGenerate,
}: {
  connections: PaidConnectionOption[];
  busy: boolean;
  error: string | null;
  onClose: () => void;
  onGenerate: (input: { connectionId: string; template: PaidLaunchTemplate; instruction: string }) => void;
}): React.JSX.Element {
  const [connectionId, setConnectionId] = useState(connections[0]?.id ?? "");
  const connection = useMemo(
    () => connections.find((item) => item.id === connectionId) ?? connections[0],
    [connectionId, connections],
  );
  const templates = useMemo(
    () => connection ? templatesForPlatform(connection.platform) : [],
    [connection],
  );
  const [template, setTemplate] = useState<PaidLaunchTemplate>(templates[0] ?? "google_search_rsa");
  const [instruction, setInstruction] = useState("");
  const dialogRef = useRef<HTMLDialogElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const titleId = useId();
  const descriptionId = useId();

  useEffect(() => {
    if (!templates.includes(template)) setTemplate(templates[0]);
  }, [template, templates]);

  useEffect(() => {
    const dialog = dialogRef.current;
    previousFocusRef.current = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    if (dialog && !dialog.open) dialog.showModal();
    return () => {
      if (dialog?.open) dialog.close();
      previousFocusRef.current?.focus();
    };
  }, []);

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby={titleId}
      aria-describedby={descriptionId}
      onCancel={(event) => {
        event.preventDefault();
        if (!busy) onClose();
      }}
      onMouseDown={(event) => {
        const rect = event.currentTarget.getBoundingClientRect();
        const outside = event.clientX < rect.left || event.clientX > rect.right
          || event.clientY < rect.top || event.clientY > rect.bottom;
        if (outside && !busy) onClose();
      }}
      className="m-auto w-[min(600px,calc(100vw-24px))] rounded-[8px] border border-line-1 bg-surface-card p-0 text-ink-900 shadow-modal backdrop:bg-black/35"
    >
        <header className="flex items-start justify-between gap-[12px] border-b border-line-2 px-[16px] py-[14px]">
          <div><p className="m-0 font-mono text-[9.5px] font-semibold uppercase tracking-[0.08em] text-ink-300">AI-assisted starting point</p><h2 id={titleId} className="mb-0 mt-[3px] text-[18px] font-semibold text-ink-900">Generate campaign draft</h2></div>
          <button type="button" aria-label="Close AI campaign generation" disabled={busy} onClick={onClose} className={`grid h-[32px] w-[32px] place-items-center rounded-[6px] border border-line-2 bg-transparent text-ink-500 disabled:opacity-45 ${focusRing}`}><LuX aria-hidden /></button>
        </header>
        <div className="px-[16px] py-[15px]">
          <p id={descriptionId} className="m-0 text-[12px] leading-[1.55] text-ink-500">Marpin uses Brand Memory, eligible workspace assets, and your instruction to create a saved draft. It consumes AI credits, creates no provider campaign, and spends no budget.</p>
          <div className="mt-[14px] grid gap-[12px] sm:grid-cols-2">
            <label className="grid gap-[5px]"><span className="text-[11px] font-semibold text-ink-500">Connected paid account</span><select aria-label="AI draft connected account" disabled={busy} value={connectionId} onChange={(event) => setConnectionId(event.target.value)} className={field}>{connections.map((item) => <option key={item.id} value={item.id}>{PLATFORM_LABEL[item.platform]} · {item.accountName}</option>)}</select></label>
            <label className="grid gap-[5px]"><span className="text-[11px] font-semibold text-ink-500">Campaign type</span><select aria-label="AI draft campaign type" disabled={busy} value={template} onChange={(event) => setTemplate(event.target.value as PaidLaunchTemplate)} className={field}>{templates.map((item) => <option key={item} value={item}>{TEMPLATE_LABEL[item]}</option>)}</select></label>
            <label className="grid gap-[5px] sm:col-span-2"><span className="text-[11px] font-semibold text-ink-500">Direction · optional</span><textarea aria-label="AI draft direction" rows={5} maxLength={2000} disabled={busy} value={instruction} onChange={(event) => setInstruction(event.target.value)} placeholder="Audience, offer, angle, constraints, or launch context" className={`${field} resize-y leading-[1.5]`} /><span className="text-right font-mono text-[9.5px] text-ink-300">{instruction.length}/2000</span></label>
          </div>
          {error ? <p role="alert" className="mb-0 mt-[12px] border-l-[3px] border-neg-700 bg-neg-bg px-[10px] py-[8px] text-[12px] text-neg-700">{error}</p> : null}
        </div>
        <footer className="flex flex-wrap justify-end gap-[8px] border-t border-line-2 px-[16px] py-[12px]">
          <button autoFocus type="button" disabled={busy} onClick={onClose} className={`h-[36px] rounded-[7px] border border-line-1 bg-surface-card px-[12px] text-[12px] font-semibold text-ink-600 disabled:opacity-50 ${focusRing}`}>Cancel</button>
          <button type="button" disabled={busy || !connection || !template} onClick={() => connection && onGenerate({ connectionId: connection.id, template, instruction })} className={`inline-flex h-[36px] items-center gap-[6px] rounded-[7px] bg-plum px-[12px] text-[12px] font-semibold text-white disabled:opacity-50 ${focusRing}`}><LuSparkles aria-hidden /> {busy ? "Generating…" : "Generate saved draft"}</button>
        </footer>
    </dialog>
  );
}
