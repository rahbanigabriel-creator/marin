"use client";

import { useEffect, useRef, useState } from "react";
import { LuCheck, LuX } from "react-icons/lu";
import type { PolicyDto, WorkspaceDto } from "@/lib/paid-agents/dto";
import { CADENCES, GOALS, WINDOWS, goalLabel, parsePolicy, type PolicyInput } from "@/lib/paid-agents/policy";

const field = "mt-1 w-full min-w-0 rounded-[6px] border border-line-2 bg-white px-3 py-2 text-[14px] text-ink-900";

export function PaidGoalForm({ policy, connections, busy, error, onSave, onDismiss }: {
  policy: PolicyDto | null;
  connections: WorkspaceDto["connections"];
  busy: boolean;
  error: string | null;
  onSave: (input: PolicyInput) => Promise<void>;
  onDismiss: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [connectionId, setConnectionId] = useState(policy?.connectionId ?? connections.find((c) => c.status === "connected")?.id ?? "");
  const [goal, setGoal] = useState(policy?.goal ?? "min_roas");
  const [validation, setValidation] = useState<string | null>(null);
  const account = connections.find((c) => c.id === connectionId);
  useEffect(() => { dialog.current?.showModal(); }, []);

  return <dialog ref={dialog} aria-labelledby="paid-goal-title" onCancel={(event) => { if (busy) event.preventDefault(); else onDismiss(); }} className="m-auto max-h-[90dvh] w-[calc(100%-32px)] max-w-[560px] overflow-y-auto rounded-[8px] border border-line-2 bg-white p-5 text-ink-900 shadow-xl backdrop:bg-black/35">
    <header className="mb-4 flex items-center justify-between gap-3">
      <h2 id="paid-goal-title" className="text-[18px] font-semibold">{policy ? "Edit paid goal" : "New paid goal"}</h2>
      <button type="button" disabled={busy} onClick={onDismiss} aria-label="Close goal form" title="Close" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[6px] hover:bg-surface-chip"><LuX aria-hidden /></button>
    </header>
    <form onSubmit={(event) => {
      event.preventDefault();
      if (busy) return;
      const data = new FormData(event.currentTarget);
      try {
        const input = parsePolicy({ name: data.get("name"), connectionId, goal, threshold: Number(data.get("threshold")), windowDays: Number(data.get("windowDays")), minSpend: Number(data.get("minSpend")), minConversions: Number(data.get("minConversions")), cadenceHours: Number(data.get("cadenceHours")) });
        setValidation(null); void onSave(input);
      } catch (error) { setValidation(error instanceof Error ? error.message : "Check the goal fields"); }
    }}>
      <fieldset disabled={busy} className="grid min-w-0 grid-cols-1 gap-4 text-[13px] sm:grid-cols-2">
        <label className="sm:col-span-2">Goal name<input name="name" required maxLength={100} defaultValue={policy?.name ?? "Paid performance guardrail"} className={field} autoFocus /></label>
        <label className="sm:col-span-2">Ad account<select aria-label="Ad account" value={connectionId} onChange={(event) => setConnectionId(event.target.value)} className={field} required>
          <option value="">Select account</option>
          {connections.map((connection) => <option key={connection.id} value={connection.id} disabled={connection.status !== "connected"}>{connection.platform === "google_ads" ? "Google Ads" : "Meta Ads"} - {connection.displayName ?? connection.externalAccountId}{connection.status !== "connected" ? ` (${connection.status})` : ""}</option>)}
        </select></label>
        <label>Goal type<select value={goal} onChange={(event) => setGoal(event.target.value)} className={field}>{GOALS.map((value) => <option key={value} value={value}>{goalLabel(value)}</option>)}</select></label>
        <label>{goal === "min_roas" ? "Minimum ROAS (x)" : `Maximum ${goal === "max_cpa" ? "CPA" : "window spend"} (${account?.currency ?? "account currency"})`}<input key={goal} name="threshold" aria-label="Goal threshold" type="number" min="0.01" max="1000000000" step="0.01" required defaultValue={policy?.goal === goal ? policy.threshold : goal === "min_roas" ? 2 : goal === "max_cpa" ? 30 : 1000} className={field} /></label>
        <label>Completed-day window<select name="windowDays" defaultValue={policy?.windowDays ?? 7} className={field}>{WINDOWS.map((value) => <option key={value} value={value}>{value} {value === 1 ? "day" : "days"}</option>)}</select></label>
        <label>Check cadence<select name="cadenceHours" defaultValue={policy?.cadenceHours ?? 24} className={field}>{CADENCES.map((value) => <option key={value} value={value}>Every {value} hours</option>)}</select></label>
        <label>Minimum spend ({account?.currency ?? "account currency"})<input name="minSpend" type="number" min="1" max="1000000000" step="0.01" defaultValue={policy?.minSpend ?? 50} required className={field} /></label>
        <label>Minimum conversions<input name="minConversions" type="number" min="1" max="1000000" step="1" defaultValue={policy?.minConversions ?? 5} required className={field} /></label>
      </fieldset>
      <p className="mt-4 text-[12px] text-ink-500">Account timezone: {account?.timezone ?? "unavailable"}. Recommendation only. No automatic campaign changes. Spend alerts are not spending limits.</p>
      {(error || validation) && <p role="alert" className="mt-3 text-[13px] text-neg-700">{error ?? validation}</p>}
      <footer className="mt-5 flex justify-end gap-2">
        <button type="button" disabled={busy} onClick={onDismiss} className="rounded-[6px] border border-line-2 px-3 py-2 text-[13px]">Cancel</button>
        <button type="submit" disabled={busy || account?.status !== "connected"} className="flex items-center gap-2 rounded-[6px] bg-ink-900 px-3 py-2 text-[13px] text-white disabled:opacity-50"><LuCheck aria-hidden />{busy ? "Saving..." : "Save goal"}</button>
      </footer>
    </form>
  </dialog>;
}
