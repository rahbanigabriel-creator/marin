"use client";

import {
  type FormEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import {
  LuCheck,
  LuCircleAlert,
  LuRefreshCw,
  LuSparkles,
  LuX,
} from "react-icons/lu";

import type {
  SeoProposal,
  SeoSeverity,
  SeoTask,
  SeoTaskStatus,
} from "./types";

const focusRing =
  "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-plum";
const fieldClass = `w-full rounded-[7px] border border-line-1 bg-surface-card px-[10px] py-[8px] text-[13px] text-ink-900 outline-none focus:border-plum-border disabled:cursor-not-allowed disabled:bg-track-1 disabled:text-ink-400 ${focusRing}`;
const focusableSelector = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  '[tabindex]:not([tabindex="-1"])',
].join(",");

export const UNVERIFIED_COMPLETION_COPY =
  "Tracked as complete in Marpin. Website change not verified.";

interface ApiErrorPayload {
  error?: string;
  code?: string;
  message?: string;
}

class SeoTaskRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
  ) {
    super(message);
    this.name = "SeoTaskRequestError";
  }
}

interface TaskDraft {
  title: string;
  description: string;
  recommendedFix: string;
  category: string;
  severity: SeoSeverity;
  priority: string;
  status: SeoTaskStatus;
  completionNote: string;
}

function draftFromTask(task: SeoTask): TaskDraft {
  return {
    title: task.title,
    description: task.description,
    recommendedFix: task.recommendedFix,
    category: task.category,
    severity: task.severity,
    priority: String(task.priority),
    status: task.status,
    completionNote: task.completionNote ?? "",
  };
}

function dateLabel(value: string | null): string {
  if (!value) return "Not recorded";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Not recorded";
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function statusLabel(status: SeoTaskStatus): string {
  if (status === "in_progress") return "In progress";
  if (status === "completed") return "Completed";
  if (status === "dismissed") return "Dismissed";
  return "Open";
}

function apiErrorMessage(status: number, payload: ApiErrorPayload): string {
  if (payload.message) return payload.message;
  if (status === 401) return "Your session expired. Sign in again to continue.";
  if (status === 403) return "You do not have permission to change this SEO task.";
  if (status === 404) return "This SEO task is no longer available.";
  if (status === 409) return "This task changed elsewhere. Reload the latest version.";
  if (status === 402) return "AI credits are unavailable for this workspace. Your task was not changed.";
  if (status === 503) return "AI is temporarily unavailable. Your task was not changed. Retry when ready.";
  if (status === 422) return "Check the task details and try again.";
  return `The SEO request failed (${status}). Please try again.`;
}

async function responseJson<T>(response: Response): Promise<T> {
  const payload = (await response.json().catch(() => ({}))) as T & ApiErrorPayload;
  if (!response.ok) {
    throw new SeoTaskRequestError(
      apiErrorMessage(response.status, payload),
      response.status,
      payload.code ?? payload.error,
    );
  }
  return payload;
}

function requestId(): string {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `seo_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 14)}`;
}

function taskFromPayload(payload: unknown): SeoTask | null {
  if (!payload || typeof payload !== "object") return null;
  if ("task" in payload) {
    const task = (payload as { task?: unknown }).task;
    return task && typeof task === "object" ? task as SeoTask : null;
  }
  return "id" in payload && "version" in payload ? payload as SeoTask : null;
}

function ReadOnlyField({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 border-b border-line-4 py-[10px] last:border-b-0">
      <p className="m-0 text-[10.5px] font-semibold uppercase text-ink-300">{label}</p>
      <p className="mb-0 mt-[4px] whitespace-pre-wrap break-words text-[13px] leading-[1.55] text-ink-700">
        {value || "Not added"}
      </p>
    </div>
  );
}

export function SeoTaskDialog({
  task,
  canManage,
  fetcher = globalThis.fetch,
  onClose,
  onTaskUpdated,
  onReloadLatest,
}: {
  task: SeoTask;
  canManage: boolean;
  fetcher?: typeof fetch;
  onClose: () => void;
  onTaskUpdated: (task: SeoTask) => void;
  onReloadLatest: (taskId: string) => Promise<SeoTask | null>;
}) {
  const dialogRef = useRef<HTMLElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const proposalRequestRef = useRef<string | null>(null);
  const interactionLockedRef = useRef(false);
  const [draft, setDraft] = useState<TaskDraft>(() => draftFromTask(task));
  const [busy, setBusy] = useState(false);
  const [aiBusy, setAiBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [conflict, setConflict] = useState(false);
  const [instruction, setInstruction] = useState("");
  const [proposal, setProposal] = useState<SeoProposal | null>(null);
  const [proposalNotice, setProposalNotice] = useState("");
  const [completionMode, setCompletionMode] = useState(false);

  useEffect(() => {
    setDraft(draftFromTask(task));
    setError(null);
    setConflict(false);
    setCompletionMode(false);
  }, [task]);

  useEffect(() => {
    interactionLockedRef.current = busy || aiBusy;
  }, [aiBusy, busy]);

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeRef.current?.focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !interactionLockedRef.current) {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = [...(dialogRef.current?.querySelectorAll<HTMLElement>(focusableSelector) ?? [])]
        .filter((element) => !element.hasAttribute("disabled") && element.getAttribute("aria-hidden") !== "true");
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [onClose]);

  const updateDraft = <K extends keyof TaskDraft>(key: K, value: TaskDraft[K]) => {
    setDraft((current) => ({ ...current, [key]: value }));
  };

  const reloadLatest = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const latest = await onReloadLatest(task.id);
      if (!latest) {
        setError("This SEO task is no longer available.");
        return;
      }
      onTaskUpdated(latest);
      setConflict(false);
    } catch (reloadError) {
      setError(reloadError instanceof Error ? reloadError.message : "The latest task could not be loaded.");
    } finally {
      setBusy(false);
    }
  }, [onReloadLatest, onTaskUpdated, task.id]);

  const patchTask = useCallback(async (fields: Record<string, unknown>) => {
    const response = await fetcher(`/api/seo/tasks/${encodeURIComponent(task.id)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ expectedVersion: task.version, ...fields }),
    });
    const payload = await responseJson<unknown>(response);
    const updated = taskFromPayload(payload) ?? await onReloadLatest(task.id);
    if (!updated) throw new Error("The task was saved but could not be reloaded.");
    onTaskUpdated(updated);
    return updated;
  }, [fetcher, onReloadLatest, onTaskUpdated, task.id, task.version]);

  const save = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!canManage) return;
    setBusy(true);
    setError(null);
    setConflict(false);
    try {
      const fields: Record<string, unknown> = {};
      const title = draft.title.trim();
      const description = draft.description.trim();
      const recommendedFix = draft.recommendedFix.trim();
      const category = draft.category.trim();
      const priority = Number(draft.priority);
      if (title !== task.title) fields.title = title;
      if (description !== task.description) fields.description = description;
      if (recommendedFix !== task.recommendedFix) fields.recommendedFix = recommendedFix;
      if (category !== task.category) fields.category = category;
      if (draft.severity !== task.severity) fields.severity = draft.severity;
      if (priority !== task.priority) fields.priority = priority;
      if (draft.status !== task.status) {
        fields.status = draft.status;
      }
      const completionNote = draft.completionNote.trim() || null;
      if (
        draft.status === "completed" &&
        (draft.status !== task.status || completionNote !== task.completionNote)
      ) {
        fields.status = "completed";
        fields.completionNote = completionNote;
      }
      if (Object.keys(fields).length === 0) return;
      await patchTask(fields);
    } catch (saveError) {
      setConflict(saveError instanceof SeoTaskRequestError && saveError.status === 409);
      setError(saveError instanceof Error ? saveError.message : "The SEO task could not be saved.");
    } finally {
      setBusy(false);
    }
  };

  const complete = async () => {
    if (!canManage) return;
    setBusy(true);
    setError(null);
    setConflict(false);
    try {
      await patchTask({
        status: "completed",
        completionNote: draft.completionNote.trim() || null,
      });
      setCompletionMode(false);
    } catch (completeError) {
      setConflict(completeError instanceof SeoTaskRequestError && completeError.status === 409);
      setError(completeError instanceof Error ? completeError.message : "Completion could not be recorded.");
    } finally {
      setBusy(false);
    }
  };

  const askAi = async () => {
    if (!canManage) return;
    setAiBusy(true);
    setError(null);
    setConflict(false);
    setProposalNotice("");
    const nextRequestId = proposalRequestRef.current ?? requestId();
    proposalRequestRef.current = nextRequestId;
    try {
      const response = await fetcher(`/api/seo/tasks/${encodeURIComponent(task.id)}/proposals`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({
          expectedVersion: task.version,
          requestId: nextRequestId,
          ...(instruction.trim() ? { instruction: instruction.trim() } : {}),
        }),
      });
      const payload = await responseJson<{ proposal: SeoProposal; reused: boolean; credits: number }>(response);
      setProposal(payload.proposal);
      setProposalNotice(payload.reused ? "Recovered the saved AI proposal." : "AI proposal ready for review.");
      proposalRequestRef.current = null;
    } catch (proposalError) {
      if (proposalError instanceof SeoTaskRequestError && proposalError.status === 409) {
        setConflict(true);
      }
      setError(proposalError instanceof Error ? proposalError.message : "AI could not prepare a proposal.");
    } finally {
      setAiBusy(false);
    }
  };

  const acceptProposal = async () => {
    if (!canManage || !proposal) return;
    setAiBusy(true);
    setError(null);
    setConflict(false);
    try {
      const response = await fetcher(
        `/api/seo/tasks/${encodeURIComponent(task.id)}/proposals/${encodeURIComponent(proposal.id)}/accept`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json", Accept: "application/json" },
          body: JSON.stringify({ expectedVersion: task.version }),
        },
      );
      const payload = await responseJson<{ task: SeoTask; proposal: SeoProposal; reused: boolean }>(response);
      setProposal(payload.proposal);
      setProposalNotice(payload.reused ? "The saved AI fix was already accepted." : "AI fix accepted into this task.");
      onTaskUpdated(payload.task);
    } catch (acceptError) {
      if (acceptError instanceof SeoTaskRequestError && acceptError.status === 409) setConflict(true);
      setError(acceptError instanceof Error ? acceptError.message : "The AI proposal could not be accepted.");
    } finally {
      setAiBusy(false);
    }
  };

  const onBackdropKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape" && !busy && !aiBusy) onClose();
  };

  const taskCompleted = task.status === "completed";
  const taskDismissed = task.status === "dismissed";

  return (
    <div
      className="fixed inset-0 z-[80] flex items-end justify-center bg-black/35 sm:items-center sm:p-[20px]"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !busy && !aiBusy) onClose();
      }}
      onKeyDown={onBackdropKeyDown}
    >
      <section
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="seo-task-dialog-title"
        className="flex max-h-[94dvh] w-full min-w-0 flex-col overflow-hidden rounded-t-[8px] border border-line-1 bg-surface-card shadow-modal sm:max-w-[760px] sm:rounded-[8px]"
      >
        <header className="flex flex-none items-start justify-between gap-[12px] border-b border-line-2 px-[16px] py-[14px] sm:px-[20px]">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-[6px] text-[10.5px] font-semibold text-ink-400">
              <span className="uppercase">{task.severity}</span>
              <span aria-hidden>·</span>
              <span>{task.category}</span>
              <span aria-hidden>·</span>
              <span>{statusLabel(task.status)}</span>
            </div>
            <h2 id="seo-task-dialog-title" className="mb-0 mt-[3px] break-words text-[18px] font-semibold leading-[1.25] text-ink-900">
              {task.title}
            </h2>
            <p className="mb-0 mt-[4px] text-[11px] text-ink-400">
              Priority {task.priority} · Updated {dateLabel(task.updatedAt)}
            </p>
          </div>
          <button
            ref={closeRef}
            type="button"
            aria-label="Close SEO task"
            disabled={busy || aiBusy}
            onClick={onClose}
            className={`flex h-[34px] w-[34px] flex-none items-center justify-center rounded-[7px] border border-line-1 text-ink-500 disabled:opacity-40 ${focusRing}`}
          >
            <LuX aria-hidden />
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden px-[16px] py-[14px] sm:px-[20px]">
          {taskCompleted ? (
            <div className="mb-[14px] flex items-start gap-[8px] border-l-[3px] border-pos-700 bg-pos-bg px-[11px] py-[9px] text-[12.5px] leading-[1.45] text-pos-700">
              <LuCheck aria-hidden className="mt-[2px] flex-none" />
              <span>{UNVERIFIED_COMPLETION_COPY}</span>
            </div>
          ) : null}
          {taskDismissed ? (
            <p className="mb-[14px] border-l-[3px] border-ink-300 bg-track-1 px-[11px] py-[9px] text-[12.5px] text-ink-600">
              This task is dismissed, but remains editable in Marpin history.
            </p>
          ) : null}
          {!canManage ? (
            <p className="mb-[14px] border-l-[3px] border-line-1 bg-track-1 px-[11px] py-[9px] text-[12.5px] text-ink-600">
              Read-only access. Owners and admins can update this task.
            </p>
          ) : null}

          {error ? (
            <div role="alert" aria-live="assertive" className="mb-[14px] flex min-w-0 items-start justify-between gap-[10px] border-l-[3px] border-neg-700 bg-neg-bg px-[11px] py-[9px] text-[12px] text-neg-700">
              <span className="min-w-0">{error}</span>
              {conflict ? (
                <button
                  type="button"
                  disabled={busy || aiBusy}
                  onClick={() => void reloadLatest()}
                  className={`h-[30px] flex-none rounded-[6px] border border-line-1 bg-surface-card px-[9px] text-[11px] font-semibold ${focusRing}`}
                >
                  Reload latest
                </button>
              ) : null}
            </div>
          ) : null}

          <form id="seo-task-form" onSubmit={save}>
            {canManage ? (
              <div className="grid min-w-0 gap-[12px]">
                <label className="grid min-w-0 gap-[5px] text-[11px] font-semibold text-ink-500">
                  Title
                  <input required maxLength={160} value={draft.title} onChange={(event) => updateDraft("title", event.target.value)} className={fieldClass} />
                </label>
                <div className="grid min-w-0 grid-cols-1 gap-[10px] sm:grid-cols-[minmax(0,1fr)_140px_110px]">
                  <label className="grid min-w-0 gap-[5px] text-[11px] font-semibold text-ink-500">
                    Category
                    <input required maxLength={60} value={draft.category} onChange={(event) => updateDraft("category", event.target.value)} className={fieldClass} />
                  </label>
                  <label className="grid min-w-0 gap-[5px] text-[11px] font-semibold text-ink-500">
                    Severity
                    <select value={draft.severity} onChange={(event) => updateDraft("severity", event.target.value as SeoSeverity)} className={fieldClass}>
                      <option value="critical">Critical</option>
                      <option value="high">High</option>
                      <option value="medium">Medium</option>
                      <option value="low">Low</option>
                    </select>
                  </label>
                  <label className="grid min-w-0 gap-[5px] text-[11px] font-semibold text-ink-500">
                    Priority
                    <input type="number" min={1} max={100} required value={draft.priority} onChange={(event) => updateDraft("priority", event.target.value)} className={fieldClass} />
                  </label>
                </div>
                <label className="grid min-w-0 gap-[5px] text-[11px] font-semibold text-ink-500">
                  Description
                  <textarea required maxLength={2000} rows={4} value={draft.description} onChange={(event) => updateDraft("description", event.target.value)} className={`${fieldClass} resize-y`} />
                </label>
                <label className="grid min-w-0 gap-[5px] text-[11px] font-semibold text-ink-500">
                  Recommended fix
                  <textarea maxLength={4000} rows={5} value={draft.recommendedFix} onChange={(event) => updateDraft("recommendedFix", event.target.value)} className={`${fieldClass} resize-y`} />
                </label>
                <div className="grid min-w-0 grid-cols-1 gap-[10px] sm:grid-cols-2">
                  <label className="grid min-w-0 gap-[5px] text-[11px] font-semibold text-ink-500">
                    Status
                    <select value={draft.status} onChange={(event) => updateDraft("status", event.target.value as SeoTaskStatus)} className={fieldClass}>
                      <option value="open">Open</option>
                      <option value="in_progress">In progress</option>
                      <option value="completed">Completed</option>
                      <option value="dismissed">Dismissed</option>
                    </select>
                  </label>
                  <label className="grid min-w-0 gap-[5px] text-[11px] font-semibold text-ink-500">
                    Completion note
                    <input maxLength={1000} value={draft.completionNote} onChange={(event) => updateDraft("completionNote", event.target.value)} placeholder="Optional result or reference" className={fieldClass} />
                  </label>
                </div>
              </div>
            ) : (
              <div className="min-w-0">
                <ReadOnlyField label="Description" value={task.description} />
                <ReadOnlyField label="Recommended fix" value={task.recommendedFix} />
                <ReadOnlyField label="Completion note" value={task.completionNote ?? ""} />
              </div>
            )}
          </form>

          <section aria-labelledby="seo-task-evidence-title" className="mt-[18px] border-t border-line-2 pt-[14px]">
            <div className="flex items-center justify-between gap-[10px]">
              <h3 id="seo-task-evidence-title" className="m-0 text-[13px] font-semibold text-ink-900">Evidence</h3>
              <span className="text-[10.5px] text-ink-400">{task.evidence.length} sourced {task.evidence.length === 1 ? "signal" : "signals"}</span>
            </div>
            {task.evidence.length ? (
              <div className="mt-[7px] divide-y divide-line-4">
                {task.evidence.map((evidence, index) => (
                  <div key={`${evidence.source}-${evidence.label}-${index}`} className="grid min-w-0 gap-[3px] py-[9px] sm:grid-cols-[130px_minmax(0,1fr)_160px] sm:items-start sm:gap-[10px]">
                    <span className="text-[10.5px] font-semibold uppercase text-ink-400">{evidence.source}</span>
                    <span className="min-w-0 text-[12.5px] text-ink-700"><strong className="font-semibold text-ink-900">{evidence.label}:</strong> {evidence.value}</span>
                    <span className="text-[10.5px] text-ink-400 sm:text-right">{dateLabel(evidence.observedTo ?? evidence.observedFrom)}</span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="mb-0 mt-[8px] text-[12px] text-ink-400">Manual task. No connected-source evidence is attached.</p>
            )}
          </section>

          {canManage ? (
            <section aria-labelledby="seo-ai-fix-title" className="mt-[18px] border-t border-line-2 pt-[14px]">
              <div className="flex min-w-0 flex-wrap items-start justify-between gap-[10px]">
                <div className="min-w-0">
                  <h3 id="seo-ai-fix-title" className="m-0 text-[13px] font-semibold text-ink-900">AI fix proposal</h3>
                  <p className="mb-0 mt-[3px] text-[11.5px] text-ink-400">AI drafts a preview. It never changes this task until you accept it.</p>
                </div>
                <button
                  type="button"
                  disabled={aiBusy || busy}
                  onClick={() => void askAi()}
                  className={`flex h-[34px] flex-none items-center gap-[6px] rounded-[7px] border border-plum-border bg-plum-soft px-[10px] text-[11.5px] font-semibold text-plum-deep disabled:opacity-45 ${focusRing}`}
                >
                  {aiBusy && !proposal ? <LuRefreshCw aria-hidden className="animate-spin motion-reduce:animate-none" /> : <LuSparkles aria-hidden />}
                  {aiBusy && !proposal ? "Preparing…" : proposal ? "Generate again" : "Ask AI for fix"}
                </button>
              </div>
              <label className="mt-[10px] grid min-w-0 gap-[5px] text-[11px] font-semibold text-ink-500">
                Guidance for AI <span className="font-normal text-ink-300">(optional)</span>
                <textarea maxLength={1000} rows={2} value={instruction} onChange={(event) => setInstruction(event.target.value)} placeholder="Focus on the smallest measurable change" className={`${fieldClass} resize-y`} />
              </label>
              <p className="sr-only" aria-live="polite">{aiBusy ? "Preparing AI fix proposal" : proposalNotice}</p>
              {proposal ? (
                <div className="mt-[12px] border-l-[3px] border-plum bg-plum-soft px-[12px] py-[11px]">
                  <div className="flex min-w-0 flex-wrap items-center justify-between gap-[8px]">
                    <p className="m-0 text-[10.5px] font-semibold uppercase text-plum-deep">Proposal preview</p>
                    <span className="text-[10px] text-ink-400">{proposal.provider} · {proposal.model}</span>
                  </div>
                  <p className="mb-0 mt-[7px] whitespace-pre-wrap break-words text-[13px] leading-[1.55] text-ink-800">{proposal.fields.recommendedFix}</p>
                  <div className="mt-[11px] flex min-w-0 flex-wrap items-center justify-between gap-[8px] border-t border-plum-border pt-[9px]">
                    <span className="text-[11px] text-plum-deep">{proposalNotice || "Review before accepting."}</span>
                    <button
                      type="button"
                      disabled={aiBusy || proposal.status === "accepted"}
                      onClick={() => void acceptProposal()}
                      className={`flex h-[33px] items-center gap-[6px] rounded-[7px] bg-plum px-[10px] text-[11.5px] font-semibold text-white disabled:opacity-45 ${focusRing}`}
                    >
                      {aiBusy ? <LuRefreshCw aria-hidden className="animate-spin motion-reduce:animate-none" /> : <LuCheck aria-hidden />}
                      {proposal.status === "accepted" ? "Accepted" : "Accept AI fix"}
                    </button>
                  </div>
                </div>
              ) : null}
            </section>
          ) : null}

          {completionMode && canManage ? (
            <section aria-labelledby="seo-completion-title" className="mt-[18px] border-t border-line-2 pt-[14px]">
              <div className="flex items-start gap-[8px] text-ink-700">
                <LuCircleAlert aria-hidden className="mt-[2px] flex-none text-ink-400" />
                <div className="min-w-0">
                  <h3 id="seo-completion-title" className="m-0 text-[13px] font-semibold text-ink-900">Track completion</h3>
                  <p className="mb-0 mt-[3px] text-[12px] leading-[1.45]">{UNVERIFIED_COMPLETION_COPY}</p>
                </div>
              </div>
              <label className="mt-[10px] grid gap-[5px] text-[11px] font-semibold text-ink-500">
                Completion note <span className="font-normal text-ink-300">(optional)</span>
                <textarea maxLength={1000} rows={3} value={draft.completionNote} onChange={(event) => updateDraft("completionNote", event.target.value)} className={`${fieldClass} resize-y`} />
              </label>
              <div className="mt-[10px] flex justify-end gap-[7px]">
                <button type="button" disabled={busy} onClick={() => setCompletionMode(false)} className={`h-[34px] rounded-[7px] border border-line-1 px-[11px] text-[11.5px] font-semibold text-ink-600 ${focusRing}`}>Cancel</button>
                <button type="button" disabled={busy} onClick={() => void complete()} className={`flex h-[34px] items-center gap-[6px] rounded-[7px] bg-pos-700 px-[11px] text-[11.5px] font-semibold text-white disabled:opacity-45 ${focusRing}`}>
                  {busy ? <LuRefreshCw aria-hidden className="animate-spin motion-reduce:animate-none" /> : <LuCheck aria-hidden />} Confirm completion
                </button>
              </div>
            </section>
          ) : null}
        </div>

        <footer className="flex flex-none flex-wrap items-center justify-between gap-[8px] border-t border-line-2 bg-surface-chip px-[16px] py-[11px] sm:px-[20px]">
          <span>
            {canManage && !taskCompleted && !completionMode ? (
              <button type="button" disabled={busy || aiBusy} onClick={() => setCompletionMode(true)} className={`flex h-[36px] items-center gap-[6px] rounded-[7px] border border-pos-700 px-[11px] text-[12px] font-semibold text-pos-700 disabled:opacity-45 ${focusRing}`}>
                <LuCheck aria-hidden /> Mark complete
              </button>
            ) : null}
          </span>
          <span className="flex items-center gap-[7px]">
            <button type="button" disabled={busy || aiBusy} onClick={onClose} className={`h-[36px] rounded-[7px] border border-line-1 bg-surface-card px-[12px] text-[12px] font-semibold text-ink-600 disabled:opacity-45 ${focusRing}`}>Close</button>
            {canManage ? (
              <button form="seo-task-form" type="submit" disabled={busy || aiBusy || !draft.title.trim() || !draft.description.trim() || !draft.category.trim()} className={`flex h-[36px] items-center gap-[6px] rounded-[7px] bg-plum px-[12px] text-[12px] font-semibold text-white disabled:opacity-45 ${focusRing}`}>
                {busy ? <LuRefreshCw aria-hidden className="animate-spin motion-reduce:animate-none" /> : null}
                {busy ? "Saving…" : "Save task"}
              </button>
            ) : null}
          </span>
        </footer>
      </section>
    </div>
  );
}
