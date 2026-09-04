"use client";

import { useMemo, useState } from "react";
import {
  LuActivity,
  LuBan,
  LuCheck,
  LuClock3,
  LuRefreshCw,
  LuShieldCheck,
  LuTriangleAlert,
} from "react-icons/lu";

import type { AgentRunDto, AgentRunStepDto } from "@/lib/agent-runs/dto";
import type { AgentApprovalDecision } from "@/lib/agent-runs/types";

import { ApprovalDecisionDialog, CancelAgentRunDialog } from "./AgentRunDialogs";
import {
  agentRunActionPolicy,
  agentRunStatusLabel,
  agentRunStatusTone,
  dispatchMessage,
  formatAgentLabel,
  pendingApprovalStep,
  safeFailureMessage,
  shortHashSuffix,
} from "./agent-run-policy";

interface AgentRunDetailProps {
  run: AgentRunDto;
  canManage: boolean;
  busyAction: string | null;
  onCancel: (run: AgentRunDto) => Promise<void>;
  onRetry: (run: AgentRunDto) => Promise<void>;
  onApproval: (
    run: AgentRunDto,
    step: AgentRunStepDto,
    decision: AgentApprovalDecision,
  ) => Promise<void>;
}

const STATUS_TONE_CLASSES = {
  neutral: "bg-surface-chip text-ink-500",
  progress: "bg-[#E8EFF4] text-[#335B72]",
  warning: "bg-[#FFF1C9] text-[#725510]",
  success: "bg-pos-bg text-pos-700",
  danger: "bg-neg-bg text-neg-700",
};

function utcDateTime(value: string): string {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "Unknown time";
  return `${new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "UTC",
  }).format(date)} UTC`;
}

function stepStatusLabel(status: AgentRunStepDto["status"]): string {
  const labels: Record<AgentRunStepDto["status"], string> = {
    queued: "Queued",
    running: "Running",
    waiting_approval: "Needs approval",
    succeeded: "Completed",
    failed: "Stopped",
    cancelled: "Cancelled",
    outcome_unknown: "Outcome unknown",
  };
  return labels[status];
}

function UsageMeter({
  label,
  value,
  maximum,
}: {
  label: string;
  value: number;
  maximum: number;
}) {
  return (
    <div className="min-w-0">
      <div className="flex items-baseline justify-between gap-2 font-sans text-[12px]">
        <span className="truncate text-ink-500">{label}</span>
        <span className="flex-none font-mono text-[11px] text-ink-700">
          {value} / {maximum}
        </span>
      </div>
      <progress
        aria-label={`${label}: ${value} of ${maximum}`}
        value={Math.min(value, maximum)}
        max={Math.max(maximum, 1)}
        className="mt-1 h-1.5 w-full overflow-hidden rounded-[6px] accent-[#8A3459]"
      />
    </div>
  );
}

export function AgentRunDetail({
  run,
  canManage,
  busyAction,
  onCancel,
  onRetry,
  onApproval,
}: AgentRunDetailProps) {
  const [approvalDecision, setApprovalDecision] = useState<AgentApprovalDecision | null>(null);
  const [cancelOpen, setCancelOpen] = useState(false);
  const policy = agentRunActionPolicy(run, canManage);
  const approvalStep = pendingApprovalStep(run);
  const busy = busyAction !== null;
  const usage = useMemo(
    () => [
      { label: "Steps", value: run.usage.steps, maximum: run.limits.maxSteps },
      { label: "Tool calls", value: run.usage.toolCalls, maximum: run.limits.maxToolCalls },
      { label: "Model turns", value: run.usage.modelTurns, maximum: run.limits.maxModelTurns },
      { label: "Web reads", value: run.usage.webReads, maximum: run.limits.maxWebReads },
      { label: "Credits", value: run.usage.credits, maximum: run.limits.maxCredits },
    ],
    [run],
  );
  const tone = agentRunStatusTone(run);
  const paidMonitorTarget = run.target?.kind === "paid_monitor" ? run.target : null;

  return (
    <article className="min-w-0 flex-1 overflow-y-auto bg-surface-panel" aria-labelledby="agent-run-goal">
      <header className="border-b border-line-1 px-5 py-5 sm:px-7">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0 max-w-[760px]">
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <span
                className={`rounded-[6px] px-2 py-1 font-sans text-[11px] font-semibold ${STATUS_TONE_CLASSES[tone]}`}
              >
                {agentRunStatusLabel(run)}
              </span>
              <span className="font-mono text-[10px] uppercase text-ink-300">
                {formatAgentLabel(run.mode)} · attempt {run.attempt}
              </span>
            </div>
            <h2 id="agent-run-goal" className="font-sans text-[20px] font-semibold leading-7 tracking-[0] text-ink-900">
              {run.goal}
            </h2>
            <p className="mt-2 font-sans text-[12px] text-ink-400">
              Started {utcDateTime(run.createdAt)} · deadline {utcDateTime(run.deadlineAt)}
            </p>
          </div>

          {canManage && (policy.canCancel || policy.canRetry) && (
            <div className="flex flex-none items-center gap-2">
              {policy.canRetry && (
                <button
                  type="button"
                  onClick={() => void onRetry(run)}
                  disabled={busy}
                  className="flex h-9 items-center gap-2 rounded-[8px] border border-line-2 bg-white px-3 font-sans text-[12.5px] font-semibold text-ink-700 hover:bg-surface-chip disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <LuRefreshCw aria-hidden className={busyAction === "retry" ? "animate-spin" : ""} />
                  Retry
                </button>
              )}
              {policy.canCancel && (
                <button
                  type="button"
                  onClick={() => setCancelOpen(true)}
                  disabled={busy}
                  className="flex h-9 items-center gap-2 rounded-[8px] border border-line-2 bg-white px-3 font-sans text-[12.5px] font-semibold text-neg-700 hover:bg-neg-bg disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <LuBan aria-hidden />
                  {busyAction === "cancel" ? "Stopping..." : "Cancel"}
                </button>
              )}
            </div>
          )}
        </div>

        {!canManage && (
          <p className="mt-4 border-l-2 border-line-2 pl-3 font-sans text-[12.5px] text-ink-400">
            Read-only access. Workspace owners and admins can start or change agent runs.
          </p>
        )}
      </header>

      <section aria-labelledby="dispatch-heading" className="border-b border-line-1 px-5 py-4 sm:px-7">
        <h3 id="dispatch-heading" className="sr-only">Worker dispatch</h3>
        <div className="flex items-start gap-3">
          {run.dispatchStatus === "unavailable" ? (
            <LuTriangleAlert className="mt-0.5 flex-none text-neg-700" aria-hidden />
          ) : run.status === "succeeded" ? (
            <LuCheck className="mt-0.5 flex-none text-pos-700" aria-hidden />
          ) : (
            <LuClock3 className="mt-0.5 flex-none text-ink-400" aria-hidden />
          )}
          <div>
            <div className="font-sans text-[12px] font-semibold text-ink-800">
              Worker: {formatAgentLabel(run.dispatchStatus)}
            </div>
            <p className="mt-0.5 font-sans text-[12.5px] leading-5 text-ink-400">
              {dispatchMessage(run)}
            </p>
          </div>
        </div>
      </section>

      {paidMonitorTarget && (
        <section aria-labelledby="paid-monitor-heading" className="border-b border-line-1 bg-[#F4F7F9] px-5 py-4 sm:px-7">
          <div className="flex items-start gap-3">
            <LuActivity className="mt-0.5 flex-none text-[#335B72]" aria-hidden />
            <div className="min-w-0">
              <h3 id="paid-monitor-heading" className="font-sans text-[12.5px] font-semibold text-ink-800">
                One-time paid campaign monitor
              </h3>
              <p className="mt-1 break-words font-sans text-[12.5px] leading-5 text-ink-500">
                {formatAgentLabel(paidMonitorTarget.platform)} · {paidMonitorTarget.accountName} · {paidMonitorTarget.from} to {paidMonitorTarget.to}
              </p>
              <p className="mt-1 font-sans text-[11.5px] leading-5 text-ink-400">
                This run reads persisted metrics only. It does not contact providers, change campaigns, or schedule recurring checks.
              </p>
            </div>
          </div>
        </section>
      )}

      {run.failure && (
        <section aria-labelledby="failure-heading" className="border-b border-line-1 bg-neg-bg px-5 py-4 sm:px-7">
          <h3 id="failure-heading" className="font-sans text-[12px] font-semibold text-neg-700">
            Run stopped safely
          </h3>
          <p className="mt-1 font-sans text-[12.5px] leading-5 text-neg-700">
            {safeFailureMessage(run.failure.code)}
          </p>
        </section>
      )}

      {run.status === "waiting_input" && (
        <section aria-labelledby="input-heading" className="border-b border-line-1 bg-[#FFF8E6] px-5 py-4 sm:px-7">
          <h3 id="input-heading" className="font-sans text-[12px] font-semibold text-[#725510]">
            This run needs input
          </h3>
          <p className="mt-1 font-sans text-[12.5px] leading-5 text-[#725510]">
            Input responses are not enabled in this workspace yet. Review the timeline or cancel the run.
          </p>
        </section>
      )}

      {approvalStep?.approvalBinding && (
        <section aria-labelledby="approval-heading" className="border-b border-line-1 bg-[#FFF8E6] px-5 py-4 sm:px-7">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="max-w-[680px]">
              <div className="flex items-center gap-2 text-[#725510]">
                <LuShieldCheck aria-hidden />
                <h3 id="approval-heading" className="font-sans text-[13px] font-semibold">
                  Exact approval required
                </h3>
              </div>
              <p className="mt-1 font-sans text-[12.5px] leading-5 text-[#725510]">
                {formatAgentLabel(approvalStep.approvalBinding.kind)} · version {approvalStep.approvalBinding.objectVersion} · snapshot {shortHashSuffix(approvalStep.approvalBinding.snapshotHash)}
              </p>
              <p className="mt-1 font-sans text-[11.5px] text-[#725510]">
                Expires {utcDateTime(approvalStep.approvalBinding.expiresAt)}
              </p>
            </div>
            {policy.canDecideApproval && (
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setApprovalDecision("rejected")}
                  disabled={busy}
                  className="h-9 rounded-[8px] border border-[#C9A84B] bg-transparent px-3 font-sans text-[12.5px] font-semibold text-[#725510] disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Reject
                </button>
                <button
                  type="button"
                  onClick={() => setApprovalDecision("accepted")}
                  disabled={busy || new Date(approvalStep.approvalBinding.expiresAt).getTime() <= Date.now()}
                  className="h-9 rounded-[8px] border-none bg-plum px-3 font-sans text-[12.5px] font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Review and approve
                </button>
              </div>
            )}
          </div>
        </section>
      )}

      <section aria-labelledby="usage-heading" className="border-b border-line-1 px-5 py-5 sm:px-7">
        <h3 id="usage-heading" className="font-sans text-[14px] font-semibold text-ink-900">
          Bounded usage
        </h3>
        <div className="mt-4 grid gap-x-6 gap-y-4 sm:grid-cols-2 xl:grid-cols-5">
          {usage.map((item) => <UsageMeter key={item.label} {...item} />)}
        </div>
      </section>

      <div className="grid min-h-[360px] lg:grid-cols-2">
        <section aria-labelledby="steps-heading" className="border-b border-line-1 px-5 py-5 sm:px-7 lg:border-b-0 lg:border-r">
          <div className="flex items-baseline justify-between gap-3">
            <h3 id="steps-heading" className="font-sans text-[14px] font-semibold text-ink-900">Steps</h3>
            <span className="font-mono text-[10px] text-ink-300">{run.steps.length} recorded</span>
          </div>
          {run.steps.length === 0 ? (
            <p className="mt-4 font-sans text-[12.5px] text-ink-400">No worker steps have been recorded.</p>
          ) : (
            <ol className="mt-3 divide-y divide-line-3">
              {run.steps.map((step) => (
                <li key={step.id} className="grid grid-cols-[28px_minmax(0,1fr)] gap-3 py-3">
                  <div className="flex h-7 w-7 items-center justify-center rounded-[6px] bg-surface-chip font-mono text-[10px] text-ink-500">
                    {step.ordinal}
                  </div>
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="truncate font-sans text-[12.5px] font-semibold text-ink-800">
                        {formatAgentLabel(step.toolName)}
                      </span>
                      <span className="font-mono text-[9.5px] uppercase text-ink-300">
                        {stepStatusLabel(step.status)} · {formatAgentLabel(step.risk)}
                      </span>
                    </div>
                    {step.error && (
                      <p className="mt-1 font-sans text-[11.5px] leading-5 text-neg-700">
                        {safeFailureMessage(step.error.code)}
                      </p>
                    )}
                    {step.output && (
                      <p className="mt-1 font-sans text-[11.5px] text-ink-400">
                        {formatAgentLabel(step.output.objectType)} created
                        {step.output.objectVersion ? ` · version ${step.output.objectVersion}` : ""}
                        {step.output.snapshotHash ? ` · ${shortHashSuffix(step.output.snapshotHash)}` : ""}
                      </p>
                    )}
                  </div>
                </li>
              ))}
            </ol>
          )}
        </section>

        <section aria-labelledby="timeline-heading" className="px-5 py-5 sm:px-7">
          <div className="flex items-baseline justify-between gap-3">
            <h3 id="timeline-heading" className="font-sans text-[14px] font-semibold text-ink-900">Public timeline</h3>
            <span className="font-mono text-[10px] text-ink-300">{run.events.length} events</span>
          </div>
          {run.events.length === 0 ? (
            <p className="mt-4 font-sans text-[12.5px] text-ink-400">No public events have been recorded.</p>
          ) : (
            <ol className="mt-3">
              {run.events.map((event, index) => (
                <li key={event.id} className="relative grid grid-cols-[16px_minmax(0,1fr)] gap-3 pb-4">
                  {index < run.events.length - 1 && (
                    <span aria-hidden className="absolute left-[7px] top-3 h-full w-px bg-line-2" />
                  )}
                  <span aria-hidden className="relative z-[1] mt-1.5 h-2 w-2 rounded-full bg-ink-300" />
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <span className="font-sans text-[12.5px] font-semibold text-ink-800">{event.label}</span>
                      <time dateTime={event.createdAt} className="font-mono text-[9.5px] text-ink-300">
                        {utcDateTime(event.createdAt)}
                      </time>
                    </div>
                    {event.detail && (
                      <p className="mt-0.5 font-sans text-[11.5px] leading-5 text-ink-400">{event.detail}</p>
                    )}
                    {event.evidenceIds.length > 0 && (
                      <p className="mt-0.5 font-sans text-[10.5px] text-ink-300">
                        {event.evidenceIds.length} evidence {event.evidenceIds.length === 1 ? "item" : "items"} recorded
                      </p>
                    )}
                  </div>
                </li>
              ))}
            </ol>
          )}
        </section>
      </div>

      {approvalStep && (
        <ApprovalDecisionDialog
          runGoal={run.goal}
          step={approvalStep}
          decision={approvalDecision}
          busy={busyAction === "approval"}
          onDismiss={() => setApprovalDecision(null)}
          onConfirm={async (decision) => {
            await onApproval(run, approvalStep, decision);
            setApprovalDecision(null);
          }}
        />
      )}
      <CancelAgentRunDialog
        open={cancelOpen}
        runGoal={run.goal}
        busy={busyAction === "cancel"}
        onDismiss={() => setCancelOpen(false)}
        onConfirm={async () => {
          await onCancel(run);
          setCancelOpen(false);
        }}
      />
    </article>
  );
}
