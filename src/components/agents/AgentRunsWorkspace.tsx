"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { LuBot, LuPlus, LuRefreshCw } from "react-icons/lu";

import type { AgentRunDto } from "@/lib/agent-runs/dto";

import { AgentRunDetail } from "./AgentRunDetail";
import { StartAgentRunDialog } from "./AgentRunDialogs";
import {
  AgentRunClientError,
  cancelAgentRun,
  decideAgentRunApproval,
  getAgentRun,
  listAgentRuns,
  retryAgentRun,
  startOrganicAgentRun,
} from "./agent-run-client";
import {
  agentRunStatusLabel,
  agentRunStatusTone,
  formatAgentLabel,
  shouldPollAgentRun,
} from "./agent-run-policy";

interface AgentRunsWorkspaceProps {
  brandId: string | null;
  canManage: boolean;
  onOpenBrand: () => void;
}

interface BusyAction {
  runId: string;
  action: "cancel" | "retry" | "approval";
}

interface Notice {
  tone: "status" | "error";
  message: string;
  actionUrl?: "/settings/billing";
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

function listTimestamp(value: string): string {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "Unknown time";
  return `${new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "UTC",
  }).format(date)} UTC`;
}

function mergeRun(runs: AgentRunDto[], run: AgentRunDto): AgentRunDto[] {
  return [run, ...runs.filter((candidate) => candidate.id !== run.id)].sort(
    (left, right) => right.updatedAt.localeCompare(left.updatedAt),
  );
}

function reconcileRunList(
  current: AgentRunDto[],
  incoming: AgentRunDto[],
  preserveMissing: boolean,
): AgentRunDto[] {
  const currentById = new Map(current.map((run) => [run.id, run]));
  const next = incoming.map((run) => {
    const existing = currentById.get(run.id);
    currentById.delete(run.id);
    return existing && existing.version > run.version ? existing : run;
  });
  if (preserveMissing) next.push(...currentById.values());
  return next.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
}

function clientMessage(error: unknown): string {
  if (error instanceof AgentRunClientError) return error.message;
  return "The agent request could not be completed. No action was recorded as successful.";
}

function errorNotice(error: unknown): Notice {
  if (error instanceof AgentRunClientError) {
    return {
      tone: "error",
      message: error.message,
      ...(error.actionUrl === "/settings/billing" ? { actionUrl: "/settings/billing" as const } : {}),
    };
  }
  return {
    tone: "error",
    message: "The agent request could not be completed. No action was recorded as successful.",
  };
}

const TONE_DOT_CLASSES = {
  neutral: "bg-ink-300",
  progress: "bg-[#4A7C96]",
  warning: "bg-[#C79A20]",
  success: "bg-pos-500",
  danger: "bg-neg-700",
};

export function AgentRunsWorkspace({
  brandId,
  canManage,
  onOpenBrand,
}: AgentRunsWorkspaceProps) {
  const [runs, setRuns] = useState<AgentRunDto[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [pollWarning, setPollWarning] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [startOpen, setStartOpen] = useState(false);
  const [startBusy, setStartBusy] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);
  const [busyAction, setBusyAction] = useState<BusyAction | null>(null);
  const actionInFlight = useRef(false);
  const startInFlight = useRef(false);

  const load = useCallback(
    async (options: { signal?: AbortSignal; polling?: boolean } = {}): Promise<boolean> => {
      if (!options.polling) setLoading(true);
      try {
        const nextRuns = await listAgentRuns(options.signal);
        setRuns((current) => reconcileRunList(current, nextRuns, options.polling === true));
        setSelectedId((current) =>
          current && (options.polling || nextRuns.some((run) => run.id === current))
            ? current
            : (nextRuns[0]?.id ?? null),
        );
        setLoadError(null);
        setPollWarning(null);
        return true;
      } catch (error) {
        if (isAbortError(error)) return false;
        if (options.polling) {
          setPollWarning("Live updates are paused. Marpin will keep retrying with a slower refresh rate.");
        } else {
          setLoadError(clientMessage(error));
        }
        return false;
      } finally {
        if (!options.polling && !options.signal?.aborted) setLoading(false);
      }
    },
    [],
  );

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    void load({ signal: controller.signal });
    return () => controller.abort();
  }, [load]);

  const hasPollingRun = runs.some(shouldPollAgentRun);
  useEffect(() => {
    if (!hasPollingRun) return;
    let stopped = false;
    let delay = 2_000;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let controller: AbortController | null = null;

    const poll = async () => {
      controller = new AbortController();
      const succeeded = await load({ signal: controller.signal, polling: true });
      if (stopped) return;
      delay = succeeded ? 2_000 : Math.min(delay * 2, 15_000);
      timer = setTimeout(() => void poll(), delay);
    };

    timer = setTimeout(() => void poll(), delay);
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
      controller?.abort();
    };
  }, [hasPollingRun, load]);

  const selectedRun = useMemo(
    () => runs.find((run) => run.id === selectedId) ?? null,
    [runs, selectedId],
  );

  const applyReturnedRun = useCallback((run: AgentRunDto) => {
    setRuns((current) => mergeRun(current, run));
    setSelectedId(run.id);
  }, []);

  const refreshAfterConflict = useCallback(async (runId: string) => {
    try {
      applyReturnedRun(await getAgentRun(runId));
    } catch {
      await load();
    }
  }, [applyReturnedRun, load]);

  const performRunAction = useCallback(
    async (
      run: AgentRunDto,
      action: BusyAction["action"],
      operation: () => Promise<AgentRunDto>,
      successMessage: string,
    ) => {
      if (actionInFlight.current) return;
      actionInFlight.current = true;
      setBusyAction({ runId: run.id, action });
      setNotice(null);
      try {
        const updated = await operation();
        applyReturnedRun(updated);
        setNotice({ tone: "status", message: successMessage });
      } catch (error) {
        if (error instanceof AgentRunClientError && (error.status === 409 || error.status === 404)) {
          await refreshAfterConflict(run.id);
        }
        setNotice(errorNotice(error));
      } finally {
        actionInFlight.current = false;
        setBusyAction(null);
      }
    },
    [applyReturnedRun, refreshAfterConflict],
  );

  const startRun = useCallback(
    async (goal: string) => {
      if (!brandId || !canManage || startInFlight.current) return;
      startInFlight.current = true;
      setStartBusy(true);
      setStartError(null);
      setNotice(null);
      try {
        const run = await startOrganicAgentRun({ brandId, goal });
        applyReturnedRun(run);
        setStartOpen(false);
        setNotice({
          tone: "status",
          message:
            run.dispatchStatus === "unavailable"
              ? "The run was saved, but the worker is unavailable. It did not start."
              : "The seven-day organic planning run was started.",
        });
      } catch (error) {
        setStartError(clientMessage(error));
      } finally {
        startInFlight.current = false;
        setStartBusy(false);
      }
    },
    [applyReturnedRun, brandId, canManage],
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-surface-page">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-line-1 bg-surface-panel px-4 py-3 sm:px-6">
        <div>
          <h1 className="font-sans text-[18px] font-semibold tracking-[0] text-ink-900">Agent runs</h1>
          <p className="mt-0.5 font-sans text-[12px] text-ink-400">
            Bounded workflows with visible steps, limits, and exact approvals.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => void load()}
            disabled={loading}
            aria-label="Refresh agent runs"
            title="Refresh agent runs"
            className="flex h-9 w-9 items-center justify-center rounded-[8px] border border-line-2 bg-white text-ink-500 hover:bg-surface-chip disabled:cursor-not-allowed disabled:opacity-50"
          >
            <LuRefreshCw aria-hidden className={loading ? "animate-spin" : ""} />
          </button>
          {canManage && brandId && (
            <button
              type="button"
              onClick={() => {
                setStartError(null);
                setStartOpen(true);
              }}
              className="flex h-9 items-center gap-2 rounded-[8px] border-none bg-plum px-3 font-sans text-[12.5px] font-semibold text-white hover:bg-plum-deep"
            >
              <LuPlus aria-hidden />
              New organic plan
            </button>
          )}
          {canManage && !brandId && (
            <button
              type="button"
              onClick={onOpenBrand}
              className="h-9 rounded-[8px] border border-line-2 bg-white px-3 font-sans text-[12.5px] font-semibold text-ink-700 hover:bg-surface-chip"
            >
              Audit a website first
            </button>
          )}
        </div>
      </header>

      <div aria-live="polite" aria-atomic="true">
        {notice && (
          <div
            role={notice.tone === "error" ? "alert" : "status"}
            className={`border-b px-4 py-2 font-sans text-[12.5px] sm:px-6 ${
              notice.tone === "error"
                ? "border-[#E4B7BE] bg-neg-bg text-neg-700"
                : "border-[#B9D7C7] bg-pos-bg text-pos-700"
            }`}
          >
            {notice.message}
            {notice.actionUrl && (
              <a href={notice.actionUrl} className="ml-2 font-semibold underline underline-offset-2">
                Review plan
              </a>
            )}
          </div>
        )}
        {loadError && runs.length > 0 && !notice && (
          <div role="alert" className="border-b border-[#E4B7BE] bg-neg-bg px-4 py-2 font-sans text-[12.5px] text-neg-700 sm:px-6">
            {loadError}
          </div>
        )}
        {pollWarning && !notice && (
          <div role="status" className="border-b border-[#E8D8A0] bg-[#FFF8E6] px-4 py-2 font-sans text-[12px] text-[#725510] sm:px-6">
            {pollWarning}
          </div>
        )}
      </div>

      <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
        <aside
          aria-label="Agent run history"
          className="flex max-h-[300px] min-h-[180px] w-full flex-none flex-col border-b border-line-1 bg-surface-card lg:max-h-none lg:w-[340px] lg:border-b-0 lg:border-r"
        >
          <div className="flex h-11 flex-none items-center justify-between border-b border-line-3 px-4">
            <span className="font-mono text-[10px] font-semibold uppercase text-ink-300">Recent runs</span>
            <span className="font-mono text-[10px] text-ink-300">{runs.length} / 50</span>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto">
            {loading && runs.length === 0 ? (
              <div role="status" className="space-y-3 p-4" aria-label="Loading agent runs">
                {[0, 1, 2].map((item) => (
                  <div key={item} className="h-[70px] animate-pulse rounded-[8px] bg-surface-chip" />
                ))}
              </div>
            ) : loadError && runs.length === 0 ? (
              <div className="p-5">
                <p role="alert" className="font-sans text-[13px] leading-5 text-neg-700">{loadError}</p>
                <button
                  type="button"
                  onClick={() => void load()}
                  className="mt-3 h-9 rounded-[8px] border border-line-2 bg-white px-3 font-sans text-[12.5px] font-semibold text-ink-700 hover:bg-surface-chip"
                >
                  Try again
                </button>
              </div>
            ) : runs.length === 0 ? (
              <div className="flex min-h-[180px] flex-col items-center justify-center px-6 text-center">
                <LuBot className="text-[24px] text-ink-300" aria-hidden />
                <p className="mt-3 font-sans text-[13px] font-semibold text-ink-700">No agent runs yet</p>
                <p className="mt-1 font-sans text-[12px] leading-5 text-ink-400">
                  {canManage
                    ? "Start a bounded organic planning run for the current brand."
                    : "An owner or admin can start the first bounded workflow."}
                </p>
              </div>
            ) : (
              <ul className="divide-y divide-line-3">
                {runs.map((run) => {
                  const selected = run.id === selectedId;
                  const tone = agentRunStatusTone(run);
                  return (
                    <li key={run.id}>
                      <button
                        type="button"
                        onClick={() => setSelectedId(run.id)}
                        aria-current={selected ? "true" : undefined}
                        className={`min-h-[82px] w-full border-none px-4 py-3 text-left hover:bg-surface-chip focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-plum ${
                          selected ? "bg-[#F4EEF1]" : "bg-transparent"
                        }`}
                      >
                        <div className="flex items-center gap-2">
                          <span className={`h-2 w-2 flex-none rounded-full ${TONE_DOT_CLASSES[tone]}`} aria-hidden />
                          <span className="min-w-0 flex-1 truncate font-sans text-[12px] font-semibold text-ink-800">
                            {agentRunStatusLabel(run)}
                          </span>
                          <span className="flex-none font-mono text-[9.5px] uppercase text-ink-300">
                            {formatAgentLabel(run.mode)}
                          </span>
                        </div>
                        <div className="mt-1 line-clamp-2 font-sans text-[12.5px] leading-5 text-ink-600">{run.goal}</div>
                        <div className="mt-1 font-mono text-[9.5px] text-ink-300">{listTimestamp(run.updatedAt)}</div>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </aside>

        {selectedRun ? (
          <AgentRunDetail
            run={selectedRun}
            canManage={canManage}
            busyAction={busyAction?.runId === selectedRun.id ? busyAction.action : null}
            onCancel={(run) =>
              performRunAction(
                run,
                "cancel",
                () => cancelAgentRun(run.id),
                "Cancellation was requested. A running step may finish before the run stops.",
              )
            }
            onRetry={(run) =>
              performRunAction(
                run,
                "retry",
                () => retryAgentRun(run.id),
                "The run was queued for an explicit retry.",
              )
            }
            onApproval={(run, step, decision) =>
              performRunAction(
                run,
                "approval",
                () => decideAgentRunApproval({ runId: run.id, step, decision }),
                decision === "accepted"
                  ? "The exact operation was approved and the run was queued to continue."
                  : "The operation was rejected and the run was cancelled.",
              )
            }
          />
        ) : (
          <section className="flex min-h-[320px] flex-1 items-center justify-center px-6 text-center">
            <div className="max-w-[360px]">
              <LuBot className="mx-auto text-[28px] text-ink-300" aria-hidden />
              <h2 className="mt-3 font-sans text-[15px] font-semibold text-ink-800">Agent activity will appear here</h2>
              <p className="mt-1 font-sans text-[12.5px] leading-5 text-ink-400">
                Select a run to inspect its bounded usage, reviewed steps, and public timeline.
              </p>
            </div>
          </section>
        )}
      </div>

      <StartAgentRunDialog
        open={startOpen}
        busy={startBusy}
        error={startError}
        onDismiss={() => {
          if (!startBusy) {
            setStartOpen(false);
            setStartError(null);
          }
        }}
        onStart={startRun}
      />
    </div>
  );
}
