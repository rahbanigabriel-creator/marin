"use client";

import { useEffect, useId, useRef, useState } from "react";
import { LuActivity, LuCheck, LuX } from "react-icons/lu";

import type { AgentRunStepDto } from "@/lib/agent-runs/dto";
import type {
  AgentApprovalDecision,
  PaidMonitorConnectionDto,
} from "@/lib/agent-runs/types";

import {
  PAID_MONITOR_WINDOW_DAYS,
  type PaidMonitorWindowDays,
} from "./agent-run-client";
import { formatAgentLabel, shortHashSuffix } from "./agent-run-policy";

const DEFAULT_GOAL =
  "Create a practical seven-day organic content plan for my brand, ready for review and scheduling.";

interface StartAgentRunDialogProps {
  open: boolean;
  busy: boolean;
  error: string | null;
  onDismiss: () => void;
  onStart: (goal: string) => Promise<void>;
}

export function StartAgentRunDialog({
  open,
  busy,
  error,
  onDismiss,
  onStart,
}: StartAgentRunDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const descriptionId = useId();
  const [goal, setGoal] = useState(DEFAULT_GOAL);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      setGoal(DEFAULT_GOAL);
      dialog.showModal();
    } else if (!open && dialog.open) {
      dialog.close();
    }
  }, [open]);

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby={titleId}
      aria-describedby={descriptionId}
      onCancel={(event) => {
        if (busy) event.preventDefault();
        else onDismiss();
      }}
      onClose={() => {
        if (open && !busy) onDismiss();
      }}
      className="m-auto w-[min(560px,calc(100vw-32px))] rounded-[8px] border border-line-1 bg-surface-card p-0 text-ink-900 shadow-modal backdrop:bg-black/30"
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (!busy && goal.trim()) void onStart(goal.trim());
        }}
      >
        <div className="flex items-start justify-between border-b border-line-3 px-5 py-4">
          <div>
            <h2 id={titleId} className="font-sans text-[18px] font-semibold tracking-[0]">
              Start an organic plan
            </h2>
            <p id={descriptionId} className="mt-1 font-sans text-[13px] text-ink-400">
              Marpin will create one bounded seven-day draft plan for the current business.
            </p>
          </div>
          <button
            type="button"
            onClick={onDismiss}
            disabled={busy}
            aria-label="Close"
            title="Close"
            className="flex h-9 w-9 flex-none items-center justify-center rounded-[8px] border border-line-2 bg-transparent text-ink-500 hover:bg-surface-chip disabled:cursor-not-allowed disabled:opacity-50"
          >
            <LuX aria-hidden />
          </button>
        </div>

        <div className="px-5 py-5">
          <label htmlFor={`${titleId}-goal`} className="font-sans text-[13px] font-semibold text-ink-800">
            Goal
          </label>
          <textarea
            id={`${titleId}-goal`}
            value={goal}
            onChange={(event) => setGoal(event.target.value)}
            maxLength={4_000}
            rows={6}
            autoFocus
            disabled={busy}
            className="mt-2 w-full resize-y rounded-[8px] border border-line-2 bg-white px-3 py-3 font-sans text-[14px] leading-6 text-ink-900 outline-none focus:border-plum focus:ring-2 focus:ring-plum-soft disabled:opacity-60"
          />
          <div className="mt-1 text-right font-mono text-[10px] text-ink-300">
            {goal.length.toLocaleString("en-US")} / 4,000
          </div>
          {error && (
            <p role="alert" className="mt-3 rounded-[8px] bg-neg-bg px-3 py-2 font-sans text-[12.5px] text-neg-700">
              {error}
            </p>
          )}
        </div>

        <div className="flex justify-end gap-2 border-t border-line-3 px-5 py-4">
          <button
            type="button"
            onClick={onDismiss}
            disabled={busy}
            className="h-10 rounded-[8px] border border-line-2 bg-transparent px-4 font-sans text-[13px] font-semibold text-ink-600 hover:bg-surface-chip disabled:cursor-not-allowed disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={busy || goal.trim().length === 0}
            className="h-10 rounded-[8px] border-none bg-plum px-4 font-sans text-[13px] font-semibold text-white hover:bg-plum-deep disabled:cursor-not-allowed disabled:opacity-50"
          >
            {busy ? "Starting..." : "Start plan"}
          </button>
        </div>
      </form>
    </dialog>
  );
}

const DEFAULT_PAID_MONITOR_GOAL =
  "Review recent paid campaign health, flag material risks, and identify evidence-backed optimization opportunities.";

interface StartPaidMonitorDialogProps {
  open: boolean;
  busy: boolean;
  loading: boolean;
  error: string | null;
  connections: PaidMonitorConnectionDto[];
  onDismiss: () => void;
  onStart: (input: {
    connectionId: string;
    goal: string;
    days: PaidMonitorWindowDays;
  }) => Promise<void>;
}

function paidPlatformLabel(platform: PaidMonitorConnectionDto["platform"]): string {
  return platform === "google_ads" ? "Google Ads" : "Meta Ads";
}

function paidSyncLabel(value: string | null): string {
  if (!value) return "No successful sync recorded";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "Unknown sync time";
  return `Last synced ${new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "UTC",
  }).format(date)} UTC`;
}

export function StartPaidMonitorDialog({
  open,
  busy,
  loading,
  error,
  connections,
  onDismiss,
  onStart,
}: StartPaidMonitorDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const descriptionId = useId();
  const [goal, setGoal] = useState(DEFAULT_PAID_MONITOR_GOAL);
  const [connectionId, setConnectionId] = useState("");
  const [days, setDays] = useState<PaidMonitorWindowDays>(14);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      setGoal(DEFAULT_PAID_MONITOR_GOAL);
      setDays(14);
      dialog.showModal();
    } else if (!open && dialog.open) {
      dialog.close();
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    if (!connections.some((connection) => connection.id === connectionId)) {
      setConnectionId(connections[0]?.id ?? "");
    }
  }, [connectionId, connections, open]);

  const selected = connections.find((connection) => connection.id === connectionId) ?? null;

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby={titleId}
      aria-describedby={descriptionId}
      onCancel={(event) => {
        if (busy) event.preventDefault();
        else onDismiss();
      }}
      onClose={() => {
        if (open && !busy) onDismiss();
      }}
      className="m-auto w-[min(600px,calc(100vw-32px))] rounded-[8px] border border-line-1 bg-surface-card p-0 text-ink-900 shadow-modal backdrop:bg-black/30"
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (!busy && connectionId && goal.trim()) {
            void onStart({ connectionId, goal: goal.trim(), days });
          }
        }}
      >
        <div className="flex items-start justify-between border-b border-line-3 px-5 py-4">
          <div className="flex min-w-0 items-start gap-3">
            <span className="mt-0.5 flex h-8 w-8 flex-none items-center justify-center rounded-[8px] bg-[#E8EFF4] text-[#335B72]">
              <LuActivity aria-hidden />
            </span>
            <div>
              <h2 id={titleId} className="font-sans text-[18px] font-semibold tracking-[0]">
                Monitor paid campaigns
              </h2>
              <p id={descriptionId} className="mt-1 font-sans text-[13px] leading-5 text-ink-400">
                Run one evidence-backed health check against saved Google Ads or Meta Ads data.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onDismiss}
            disabled={busy}
            aria-label="Close"
            title="Close"
            className="flex h-9 w-9 flex-none items-center justify-center rounded-[8px] border border-line-2 bg-transparent text-ink-500 hover:bg-surface-chip disabled:cursor-not-allowed disabled:opacity-50"
          >
            <LuX aria-hidden />
          </button>
        </div>

        <div className="space-y-5 px-5 py-5">
          <p className="border-l-2 border-[#4A7C96] pl-3 font-sans text-[12.5px] leading-5 text-ink-500">
            One-time, read-only check. Marpin reads persisted metrics only; it does not contact ad platforms, change campaigns, or schedule future checks.
          </p>

          <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_160px]">
            <div className="min-w-0">
              <label htmlFor={`${titleId}-account`} className="font-sans text-[13px] font-semibold text-ink-800">
                Connected account
              </label>
              <select
                id={`${titleId}-account`}
                value={connectionId}
                onChange={(event) => setConnectionId(event.target.value)}
                disabled={busy || loading || connections.length === 0}
                className="mt-2 h-11 w-full rounded-[8px] border border-line-2 bg-white px-3 font-sans text-[13px] text-ink-800 outline-none focus:border-plum focus:ring-2 focus:ring-plum-soft disabled:opacity-60"
              >
                {loading && <option value="">Loading accounts...</option>}
                {!loading && connections.length === 0 && <option value="">No active paid account</option>}
                {connections.map((connection) => (
                  <option key={connection.id} value={connection.id}>
                    {paidPlatformLabel(connection.platform)} - {connection.accountName}
                  </option>
                ))}
              </select>
              {selected && (
                <p className="mt-1 truncate font-mono text-[10px] text-ink-300">
                  {selected.accountId} · {paidSyncLabel(selected.lastSuccessfulSyncAt)}
                </p>
              )}
            </div>

            <div>
              <label htmlFor={`${titleId}-window`} className="font-sans text-[13px] font-semibold text-ink-800">
                Recent window
              </label>
              <select
                id={`${titleId}-window`}
                value={days}
                onChange={(event) => {
                  const next = Number(event.target.value);
                  if (PAID_MONITOR_WINDOW_DAYS.includes(next as PaidMonitorWindowDays)) {
                    setDays(next as PaidMonitorWindowDays);
                  }
                }}
                disabled={busy}
                className="mt-2 h-11 w-full rounded-[8px] border border-line-2 bg-white px-3 font-sans text-[13px] text-ink-800 outline-none focus:border-plum focus:ring-2 focus:ring-plum-soft disabled:opacity-60"
              >
                {PAID_MONITOR_WINDOW_DAYS.map((option) => (
                  <option key={option} value={option}>Last {option} days</option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <label htmlFor={`${titleId}-goal`} className="font-sans text-[13px] font-semibold text-ink-800">
              Monitoring goal
            </label>
            <textarea
              id={`${titleId}-goal`}
              value={goal}
              onChange={(event) => setGoal(event.target.value)}
              maxLength={4_000}
              rows={4}
              disabled={busy}
              className="mt-2 w-full resize-y rounded-[8px] border border-line-2 bg-white px-3 py-3 font-sans text-[14px] leading-6 text-ink-900 outline-none focus:border-plum focus:ring-2 focus:ring-plum-soft disabled:opacity-60"
            />
          </div>

          {!loading && connections.length === 0 && !error && (
            <p role="status" className="rounded-[8px] bg-[#FFF8E6] px-3 py-2 font-sans text-[12.5px] text-[#725510]">
              Connect and sync Google Ads or Meta Ads in Paid accounts before starting a monitor.
            </p>
          )}
          {error && (
            <p role="alert" className="rounded-[8px] bg-neg-bg px-3 py-2 font-sans text-[12.5px] text-neg-700">
              {error}
            </p>
          )}
        </div>

        <div className="flex justify-end gap-2 border-t border-line-3 px-5 py-4">
          <button
            type="button"
            onClick={onDismiss}
            disabled={busy}
            className="h-10 rounded-[8px] border border-line-2 bg-transparent px-4 font-sans text-[13px] font-semibold text-ink-600 hover:bg-surface-chip disabled:cursor-not-allowed disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={busy || loading || !connectionId || goal.trim().length === 0}
            className="h-10 rounded-[8px] border-none bg-plum px-4 font-sans text-[13px] font-semibold text-white hover:bg-plum-deep disabled:cursor-not-allowed disabled:opacity-50"
          >
            {busy ? "Starting..." : "Run health check"}
          </button>
        </div>
      </form>
    </dialog>
  );
}

interface CancelAgentRunDialogProps {
  open: boolean;
  runGoal: string;
  busy: boolean;
  onDismiss: () => void;
  onConfirm: () => Promise<void>;
}

export function CancelAgentRunDialog({
  open,
  runGoal,
  busy,
  onDismiss,
  onConfirm,
}: CancelAgentRunDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const descriptionId = useId();

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    else if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby={titleId}
      aria-describedby={descriptionId}
      onCancel={(event) => {
        if (busy) event.preventDefault();
        else onDismiss();
      }}
      onClose={() => {
        if (open && !busy) onDismiss();
      }}
      className="m-auto w-[min(480px,calc(100vw-32px))] rounded-[8px] border border-line-1 bg-surface-card p-0 text-ink-900 shadow-modal backdrop:bg-black/30"
    >
      <div className="border-b border-line-3 px-5 py-4">
        <h2 id={titleId} className="font-sans text-[18px] font-semibold tracking-[0]">Cancel this run?</h2>
        <p id={descriptionId} className="mt-1 font-sans text-[13px] leading-5 text-ink-400">
          A running step may finish before the bounded worker observes the cancellation.
        </p>
      </div>
      <div className="px-5 py-5">
        <p className="font-sans text-[13px] leading-5 text-ink-700">{runGoal}</p>
      </div>
      <div className="flex justify-end gap-2 border-t border-line-3 px-5 py-4">
        <button
          type="button"
          onClick={onDismiss}
          disabled={busy}
          className="h-10 rounded-[8px] border border-line-2 bg-transparent px-4 font-sans text-[13px] font-semibold text-ink-600 hover:bg-surface-chip disabled:cursor-not-allowed disabled:opacity-50"
        >
          Keep running
        </button>
        <button
          type="button"
          onClick={() => void onConfirm()}
          disabled={busy}
          className="h-10 rounded-[8px] border-none bg-neg-700 px-4 font-sans text-[13px] font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
        >
          {busy ? "Stopping..." : "Cancel run"}
        </button>
      </div>
    </dialog>
  );
}

interface ApprovalDecisionDialogProps {
  runGoal: string;
  step: AgentRunStepDto;
  decision: AgentApprovalDecision | null;
  busy: boolean;
  onDismiss: () => void;
  onConfirm: (decision: AgentApprovalDecision) => Promise<void>;
}

export function ApprovalDecisionDialog({
  runGoal,
  step,
  decision,
  busy,
  onDismiss,
  onConfirm,
}: ApprovalDecisionDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const descriptionId = useId();
  const binding = step.approvalBinding;

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (decision && !dialog.open) dialog.showModal();
    else if (!decision && dialog.open) dialog.close();
  }, [decision]);

  if (!binding) return null;
  const accepting = decision === "accepted";

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby={titleId}
      aria-describedby={descriptionId}
      onCancel={(event) => {
        if (busy) event.preventDefault();
        else onDismiss();
      }}
      onClose={() => {
        if (decision && !busy) onDismiss();
      }}
      className="m-auto w-[min(520px,calc(100vw-32px))] rounded-[8px] border border-line-1 bg-surface-card p-0 text-ink-900 shadow-modal backdrop:bg-black/30"
    >
      <div className="border-b border-line-3 px-5 py-4">
        <h2 id={titleId} className="font-sans text-[18px] font-semibold tracking-[0]">
          {accepting ? "Approve exact operation" : "Reject operation"}
        </h2>
        <p id={descriptionId} className="mt-1 font-sans text-[13px] text-ink-400">
          {accepting
            ? "Only the exact version shown below will be approved. Server policy remains authoritative."
            : "Rejecting this request cancels the run without performing the operation."}
        </p>
      </div>

      <div className="space-y-4 px-5 py-5">
        <div>
          <div className="font-mono text-[10px] font-semibold uppercase text-ink-300">Run goal</div>
          <p className="mt-1 font-sans text-[14px] leading-6 text-ink-800">{runGoal}</p>
        </div>
        <dl className="grid grid-cols-[minmax(110px,auto)_1fr] gap-x-4 gap-y-2 border-y border-line-3 py-3 font-sans text-[12.5px]">
          <dt className="text-ink-400">Operation</dt>
          <dd className="font-semibold text-ink-800">{formatAgentLabel(binding.kind)}</dd>
          <dt className="text-ink-400">Object</dt>
          <dd className="font-semibold text-ink-800">{formatAgentLabel(binding.objectType)}</dd>
          <dt className="text-ink-400">Version</dt>
          <dd className="font-mono text-ink-700">{binding.objectVersion}</dd>
          <dt className="text-ink-400">Snapshot</dt>
          <dd className="font-mono text-ink-700">{shortHashSuffix(binding.snapshotHash)}</dd>
          <dt className="text-ink-400">Account</dt>
          <dd className="text-ink-700">
            {binding.accountId ? "Bound to the reviewed connected account" : "No account binding"}
          </dd>
        </dl>
      </div>

      <div className="flex justify-end gap-2 border-t border-line-3 px-5 py-4">
        <button
          type="button"
          onClick={onDismiss}
          disabled={busy}
          className="h-10 rounded-[8px] border border-line-2 bg-transparent px-4 font-sans text-[13px] font-semibold text-ink-600 hover:bg-surface-chip disabled:cursor-not-allowed disabled:opacity-50"
        >
          Back
        </button>
        <button
          type="button"
          onClick={() => decision && void onConfirm(decision)}
          disabled={busy || !decision}
          className={`flex h-10 items-center gap-2 rounded-[8px] border-none px-4 font-sans text-[13px] font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50 ${
            accepting ? "bg-plum hover:bg-plum-deep" : "bg-neg-700"
          }`}
        >
          {accepting ? <LuCheck aria-hidden /> : <LuX aria-hidden />}
          {busy ? "Saving..." : accepting ? "Approve this version" : "Reject and cancel"}
        </button>
      </div>
    </dialog>
  );
}
