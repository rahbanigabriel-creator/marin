"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { LuCheck, LuChevronDown, LuPause, LuPencil, LuPlay, LuPlus, LuRefreshCw, LuX } from "react-icons/lu";
import type { CheckDto, PolicyDto, WorkspaceDto } from "@/lib/paid-agents/dto";
import type { PolicyCommand } from "@/lib/paid-agents/service";
import { goalLabel } from "@/lib/paid-agents/policy";
import { PaidGoalForm } from "./PaidGoalForm";
import { PaidAgentClientError, loadPaidAgents, loadPaidHistory, paidAgentCommand } from "./paid-agent-client";

const iconButton = "flex h-9 w-9 shrink-0 items-center justify-center rounded-[6px] border border-line-2 bg-white text-ink-700 hover:bg-surface-chip disabled:opacity-40";
const time = (value: string | null) => value ? new Date(value).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }) : "Not yet";
const message = (error: unknown) => error instanceof Error ? error.message : "Paid goals are unavailable";
const number = (value: number) => value.toLocaleString(undefined, { maximumFractionDigits: 2 });

export function PaidAgentsWorkspace({ canManage, onOpenConnections }: { canManage: boolean; onOpenConnections?: () => void }) {
  const [data, setData] = useState<WorkspaceDto | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const selectedRef = useRef<string | null>(null);
  selectedRef.current = selected;
  const [checks, setChecks] = useState<CheckDto[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [historyBusy, setHistoryBusy] = useState(false);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState<PolicyDto | "new" | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const inFlight = useRef(false);
  const request = useRef<{ signature: string; id: string } | null>(null);

  const refresh = useCallback(async (signal?: AbortSignal) => {
    try {
      const next = await loadPaidAgents(signal);
      if (signal?.aborted) return;
      setData(next); setError(null);
      setSelected((id) => next.policies.some((policy) => policy.id === id) ? id : next.policies[0]?.id ?? null);
    } catch (error) { if (!signal?.aborted) setError(message(error)); }
    finally { if (!signal?.aborted) setLoading(false); }
  }, []);
  const refreshHistory = useCallback(async (id: string, nextCursor?: string, signal?: AbortSignal) => {
    setHistoryBusy(true);
    try {
      const result = await loadPaidHistory(id, nextCursor, signal);
      if (signal?.aborted || selectedRef.current !== id) return;
      setChecks((existing) => nextCursor ? [...existing, ...result.checks.filter((check) => !existing.some((row) => row.id === check.id))] : result.checks);
      setCursor(result.nextCursor); setHistoryError(null);
    } catch (error) { if (!signal?.aborted && selectedRef.current === id) setHistoryError(message(error)); }
    finally { if (!signal?.aborted && selectedRef.current === id) setHistoryBusy(false); }
  }, []);
  useEffect(() => { const controller = new AbortController(); void refresh(controller.signal); return () => controller.abort(); }, [refresh]);
  useEffect(() => {
    setChecks([]); setCursor(null); setHistoryError(null);
    if (!selected) return;
    const controller = new AbortController(); void refreshHistory(selected, undefined, controller.signal); return () => controller.abort();
  }, [selected, refreshHistory]);
  const hasActive = data?.policies.some((policy) => policy.checks.some((check) => ["queued", "running"].includes(check.status))) ?? false;
  useEffect(() => {
    if (!hasActive) return;
    const controller = new AbortController(); let count = 0; let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      if (controller.signal.aborted) return;
      await refresh(controller.signal);
      if (selectedRef.current) await refreshHistory(selectedRef.current, undefined, controller.signal);
      if (!controller.signal.aborted && ++count < 90) timer = setTimeout(() => void poll(), 10_000);
    };
    timer = setTimeout(() => void poll(), 10_000);
    return () => { controller.abort(); clearTimeout(timer); };
  }, [hasActive, refresh, refreshHistory]);

  const mutate = async (command: PolicyCommand) => {
    if (inFlight.current) return;
    inFlight.current = true; setBusy(true); setError(null); setFormError(null); setNotice(null);
    const signature = JSON.stringify(command);
    if (request.current?.signature !== signature) request.current = { signature, id: crypto.randomUUID() };
    try {
      const result = await paidAgentCommand(command, request.current.id);
      request.current = null; setForm(null); setSelected(result.policyId);
      setNotice(command.kind === "review" ? "Review recorded. No campaign changes were made."
        : command.kind === "check" ? result.dispatched ? "Fresh account check queued." : "Check saved but worker delivery is unavailable. It has not been evaluated."
          : command.kind === "pause" ? "Goal paused. In-flight recommendations are cancelled; a provider read already in flight may finish." : "Goal saved.");
      await refresh();
      if (selectedRef.current === result.policyId) await refreshHistory(result.policyId);
    } catch (error) {
      if (error instanceof PaidAgentClientError && error.status < 500) request.current = null;
      if (error instanceof PaidAgentClientError && error.status === 409) await refresh();
      setError(message(error)); setFormError(message(error));
    } finally { inFlight.current = false; setBusy(false); }
  };
  const policy = data?.policies.find((row) => row.id === selected);
  const manager = canManage && data?.canManage;
  const permitted = manager && data?.entitled;
  return <div className="flex min-h-0 flex-1 flex-col bg-surface-page text-ink-900">
    <header className="flex flex-wrap items-center justify-between gap-3 border-b border-line-1 bg-surface-panel px-4 py-4 sm:px-6">
      <h1 className="text-[18px] font-semibold">Paid agents</h1>
      <div className="flex gap-2">
        <button type="button" title="Refresh paid goals" aria-label="Refresh paid goals" disabled={loading || busy} className={iconButton} onClick={() => { void refresh(); if (selected) void refreshHistory(selected); }}><LuRefreshCw aria-hidden /></button>
        {manager && <button type="button" disabled={!permitted || busy} onClick={() => { setFormError(null); setForm("new"); }} className="flex items-center gap-2 rounded-[6px] bg-ink-900 px-3 text-[13px] font-semibold text-white disabled:opacity-40"><LuPlus aria-hidden />New goal</button>}
      </div>
    </header>
    <div className="min-h-0 flex-1 overflow-auto px-4 py-4 sm:px-6">
      <p className="mb-4 text-[12px] text-ink-500">Recommendation only. Provider budget, activation, and pause actions are not supported. No automatic campaign changes.</p>
      {loading && <p role="status">Loading paid goals...</p>}
      {error && <div role="alert" className="mb-4 border-l-2 border-neg-700 pl-3 text-[13px] text-neg-700">{error}</div>}
      {notice && <p role="status" className="mb-4 text-[13px]">{notice}</p>}
      {data && !data.entitled && <p role="status" className="mb-4 text-[13px]">Paid agent checks require a plan with agent actions. <a className="underline" href="/settings/billing">Review plan</a></p>}
      {data && !data.workerAvailable && <p role="status" className="mb-4 border-l-2 border-amber-500 pl-3 text-[13px]">Scheduler unavailable. Goals can be saved, but checks are not running. Next-check times are planned, not confirmed execution.</p>}
      {data && !data.connections.some((c) => c.status === "connected") && <div className="mb-4 text-[13px]"><p>No connected Google Ads or Meta Ads account is available.</p>{manager && onOpenConnections && <button type="button" onClick={onOpenConnections} className="mt-3 flex items-center gap-2 rounded-[6px] border border-line-2 bg-white px-3 py-2"><LuPlus aria-hidden />Connect ad account</button>}</div>}
      {data && data.policies.length === 0 && <div className="border-y border-line-1 py-12"><h2 className="text-[16px] font-semibold">No paid goals yet</h2></div>}
      {data && data.policies.length > 0 && <div className="grid min-w-0 gap-6 xl:grid-cols-[minmax(260px,340px)_minmax(0,1fr)]">
        <section aria-label="Saved paid goals" className="min-w-0">
          {data.policies.map((row) => <button type="button" key={row.id} onClick={() => setSelected(row.id)} aria-pressed={selected === row.id} className={`block w-full min-w-0 border-b border-line-1 px-3 py-4 text-left ${selected === row.id ? "border-l-2 border-l-emerald-700 bg-white" : "border-l-2 border-l-transparent hover:bg-white"}`}>
            <span className="block break-words text-[14px] font-semibold">{row.name}</span>
            <span className="mt-1 block break-words text-[12px] text-ink-500">{row.platform === "google_ads" ? "Google Ads" : "Meta Ads"} / {row.accountName}</span>
            <span className="mt-2 block text-[13px]">{goalLabel(row.goal)} {row.goal === "min_roas" ? ">=" : "<="} {number(row.threshold)} {row.goal === "min_roas" ? "x" : row.currency}</span>
            <span className="mt-2 block text-[12px] text-ink-500">{row.status === "paused" ? "Paused" : "Active"} / {row.checks[0]?.status.replaceAll("_", " ") ?? "Awaiting first check"}</span>
          </button>)}
        </section>
        {policy && <section aria-label="Goal details" className="min-w-0">
          <div className="flex flex-wrap items-start justify-between gap-3 border-b border-line-1 pb-4">
            <div className="min-w-0"><h2 className="break-words text-[16px] font-semibold">{policy.name}</h2><p className="mt-1 break-words text-[12px] text-ink-500">Account {policy.accountId} / {policy.currency} / {policy.timezone}</p></div>
            {manager && <div className="flex flex-wrap gap-2">
              <button type="button" className={iconButton} disabled={busy || !permitted} title="Edit goal" aria-label="Edit goal" onClick={() => { setFormError(null); setForm(policy); }}><LuPencil aria-hidden /></button>
              <button type="button" className={iconButton} disabled={busy || (policy.status === "paused" && !permitted)} title={policy.status === "active" ? "Pause goal" : "Resume goal"} aria-label={policy.status === "active" ? "Pause goal" : "Resume goal"} onClick={() => void mutate({ kind: policy.status === "active" ? "pause" : "resume", policyId: policy.id, version: policy.version })}>{policy.status === "active" ? <LuPause aria-hidden /> : <LuPlay aria-hidden />}</button>
              <button type="button" disabled={busy || !permitted || policy.status !== "active" || !data.workerAvailable || policy.checks.some((c) => ["queued", "running"].includes(c.status))} onClick={() => void mutate({ kind: "check", policyId: policy.id, version: policy.version })} className="flex h-9 items-center gap-2 rounded-[6px] border border-line-2 bg-white px-3 text-[13px] disabled:opacity-40"><LuRefreshCw aria-hidden />Check now</button>
            </div>}
          </div>
          <dl className="grid grid-cols-1 gap-3 border-b border-line-1 py-4 text-[12px] sm:grid-cols-2">
            <div><dt className="text-ink-500">Sample / window</dt><dd className="mt-1">{number(policy.minSpend)} {policy.currency}, {policy.minConversions} conversions / {policy.windowDays} completed days</dd></div>
            <div><dt className="text-ink-500">Cadence</dt><dd className="mt-1">Every {policy.cadenceHours} hours</dd></div>
            <div><dt className="text-ink-500">Last check started</dt><dd className="mt-1">{time(policy.lastCheckAt)}</dd></div>
            <div><dt className="text-ink-500">Next planned check</dt><dd className="mt-1">{policy.status === "paused" ? "Paused" : time(policy.nextCheckAt)}</dd></div>
          </dl>
          <h3 className="mb-1 mt-5 text-[14px] font-semibold">Check history</h3>
          {historyError && <p role="alert" className="py-3 text-[13px] text-neg-700">{historyError}</p>}
          {!checks.length && <p role="status" className="py-4 text-[13px] text-ink-500">{historyBusy ? "Loading checks..." : "No checks recorded."}</p>}
          {checks.map((check) => <article key={check.id} className="border-b border-line-1 py-4 text-[13px]">
            <div className="flex flex-wrap justify-between gap-2"><strong className={check.status === "healthy" ? "text-emerald-700" : check.status === "needs_review" ? "text-amber-800" : "text-ink-700"}>{check.status === "healthy" ? "Threshold met" : check.status === "needs_review" ? "Review recommended" : check.status.replaceAll("_", " ")}</strong><time className="text-[12px] text-ink-500">{time(check.createdAt)}</time></div>
            <p className="mt-2">{check.reason}</p>
            {check.result?.observed != null && <p className="mt-2 font-medium">Observed {number(check.result.observed)} {check.snapshot.goal === "min_roas" ? "x" : check.snapshot.currency} / {goalLabel(check.snapshot.goal).toLowerCase()} {number(check.snapshot.threshold)}</p>}
            {check.result?.recommendation && <p className="mt-2">{check.result.recommendation}</p>}
            <p className="mt-2 break-words text-[12px] text-ink-500">Policy version {check.policyVersion}{check.result?.range ? ` / ${check.result.range.from.slice(0, 10)} to ${check.result.range.to.slice(0, 10)}` : ""}{check.result?.syncedAt ? ` / Synced ${time(check.result.syncedAt)}` : ""}</p>
            {check.reviewStatus !== "none" && <p className="mt-2 text-[12px]">Review: {check.reviewStatus}{check.reviewStatus === "pending" ? ` / Expires ${time(check.reviewExpiresAt)}` : ""}</p>}
            {check.reviewStatus === "pending" && policy.status === "active" && check.policyVersion === policy.version && permitted && <div className="mt-3 flex flex-wrap gap-2">
              <button type="button" disabled={busy} onClick={() => void mutate({ kind: "review", policyId: policy.id, version: policy.version, checkId: check.id, decision: "acknowledged" })} className="flex items-center gap-2 rounded-[6px] border border-line-2 bg-white px-3 py-2 disabled:opacity-40"><LuCheck aria-hidden />Acknowledge recommendation</button>
              <button type="button" disabled={busy} aria-label="Dismiss recommendation" title="Dismiss recommendation" className={iconButton} onClick={() => void mutate({ kind: "review", policyId: policy.id, version: policy.version, checkId: check.id, decision: "dismissed" })}><LuX aria-hidden /></button>
            </div>}
          </article>)}
          {cursor && <button type="button" disabled={historyBusy} onClick={() => void refreshHistory(policy.id, cursor)} className="mt-3 flex items-center gap-2 text-[13px]"><LuChevronDown aria-hidden />Older checks</button>}
        </section>}
      </div>}
    </div>
    {form && data && <PaidGoalForm policy={form === "new" ? null : form} connections={data.connections} busy={busy} error={formError} onDismiss={() => { if (!busy) setForm(null); }} onSave={async (input) => { await mutate(form === "new" ? { kind: "create", policy: input } : { kind: "edit", policyId: form.id, version: form.version, policy: input }); }} />}
  </div>;
}
