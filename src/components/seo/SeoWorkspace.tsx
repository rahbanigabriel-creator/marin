"use client";

import {
  type FormEvent,
  type MouseEvent as ReactMouseEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  LuArrowUpDown,
  LuCalendarDays,
  LuChartNoAxesCombined,
  LuCircleAlert,
  LuCircleCheck,
  LuCircleX,
  LuExternalLink,
  LuFileSearch,
  LuLayoutGrid,
  LuListFilter,
  LuMessageSquare,
  LuPlus,
  LuRefreshCw,
  LuSearch,
  LuX,
} from "react-icons/lu";

import { SeoTaskDialog, UNVERIFIED_COMPLETION_COPY } from "./SeoTaskDialog";
import type {
  SeoSeverity,
  SeoSourceCoverage,
  SeoTask,
  SeoTaskSource,
  SeoTaskStatus,
  SeoWorkspaceResponse,
} from "./types";

const focusRing =
  "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-plum";
const controlClass = `h-[34px] min-w-0 rounded-[7px] border border-line-1 bg-surface-card px-[9px] text-[11.5px] font-medium text-ink-700 outline-none focus:border-plum-border ${focusRing}`;

interface ApiErrorPayload {
  error?: string;
  code?: string;
  message?: string;
}

class SeoWorkspaceRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "SeoWorkspaceRequestError";
  }
}

function apiErrorMessage(status: number, payload: ApiErrorPayload): string {
  if (payload.message) return payload.message;
  if (status === 401) return "Your session expired. Sign in again to continue.";
  if (status === 403) return "You do not have permission to change this SEO workspace.";
  if (status === 404) return "This SEO workspace is no longer available.";
  if (status === 409) return "The SEO workspace changed elsewhere. Reload the latest data.";
  if (status === 402) return "This workspace cannot run another AI operation right now.";
  if (status === 503) return "SEO analysis is temporarily unavailable. Existing tasks were not changed.";
  if (status === 422) return "Check the submitted details and try again.";
  return `The SEO request failed (${status}). Please try again.`;
}

async function responseJson<T>(response: Response): Promise<T> {
  const payload = (await response.json().catch(() => ({}))) as T & ApiErrorPayload;
  if (!response.ok) throw new SeoWorkspaceRequestError(apiErrorMessage(response.status, payload), response.status);
  return payload;
}

function requestId(): string {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `seo_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 14)}`;
}

function dateLabel(value: string | null): string {
  if (!value) return "Not observed";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Not observed";
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(date);
}

function observedLabel(source: SeoSourceCoverage): string {
  if (!source.observedFrom && !source.observedTo) return "No observation window";
  const from = dateLabel(source.observedFrom);
  const to = dateLabel(source.observedTo);
  return from === to ? `Observed ${to}` : `Observed ${from} – ${to}`;
}

function sourceLabel(source: SeoTaskSource): string {
  if (source === "search_console") return "Search Console";
  if (source === "ga4") return "GA4";
  if (source === "crawl") return "Crawl";
  return "Manual";
}

function statusLabel(status: SeoTaskStatus): string {
  if (status === "in_progress") return "In progress";
  if (status === "completed") return "Completed";
  if (status === "dismissed") return "Dismissed";
  return "Open";
}

const severityRank: Record<SeoSeverity, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
};

const severityClass: Record<SeoSeverity, string> = {
  critical: "bg-neg-bg text-neg-700",
  high: "bg-[#fff1d6] text-[#7b5914]",
  medium: "bg-plum-soft text-plum-deep",
  low: "bg-track-1 text-ink-500",
};

function safeWebsiteUrl(value: string): string | null {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password) return null;
    return url.toString();
  } catch {
    return null;
  }
}

function SourceRow({ source }: { source: SeoSourceCoverage }) {
  const available = source.state === "available";
  const errored = source.state === "error";
  const stateCopy = available ? "Available" : errored ? "Connection error" : "Unavailable";
  const StateIcon = available ? LuCircleCheck : errored ? LuCircleAlert : LuCircleX;
  return (
    <div className="grid min-w-0 grid-cols-[22px_minmax(0,1fr)] gap-[8px] border-b border-line-4 py-[9px] last:border-b-0 sm:grid-cols-[22px_140px_minmax(0,1fr)_auto] sm:items-center">
      <StateIcon aria-hidden className={`h-[15px] w-[15px] ${available ? "text-pos-700" : errored ? "text-neg-700" : "text-ink-300"}`} />
      <span className="text-[12px] font-semibold text-ink-800">{source.label}</span>
      <span className="col-start-2 min-w-0 text-[11.5px] text-ink-400 sm:col-auto">
        <span className={`font-semibold ${available ? "text-pos-700" : errored ? "text-neg-700" : "text-ink-500"}`}>{stateCopy}</span>
        <span aria-hidden> · </span>{source.detail}
      </span>
      <span className="col-start-2 text-[10.5px] text-ink-400 sm:col-auto sm:text-right">
        {available && source.rowCount !== null ? `${source.rowCount.toLocaleString()} rows · ` : ""}{observedLabel(source)}
      </span>
    </div>
  );
}

function TaskRow({
  task,
  onOpen,
}: {
  task: SeoTask;
  onOpen: (event: ReactMouseEvent<HTMLButtonElement>) => void;
}) {
  return (
    <article className="min-w-0 border-b border-line-2 bg-surface-card px-[12px] py-[12px] last:border-b-0 sm:px-[15px]">
      <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-start gap-[10px]">
        <div className="min-w-0">
          <div className="flex min-w-0 flex-wrap items-center gap-[6px]">
            <span className={`rounded-[6px] px-[6px] py-[3px] text-[9.5px] font-semibold uppercase ${severityClass[task.severity]}`}>{task.severity}</span>
            <span className="font-mono text-[9.5px] font-semibold uppercase text-ink-300">P{task.priority}</span>
            <span className="text-[10.5px] text-ink-400">{task.category}</span>
            <span aria-hidden className="text-ink-300">·</span>
            <span className="text-[10.5px] text-ink-400">{sourceLabel(task.source)}</span>
          </div>
          <button
            type="button"
            data-seo-task-id={task.id}
            onClick={onOpen}
            aria-label={`Open ${task.title}`}
            className={`mt-[6px] block max-w-full text-left text-[14px] font-semibold leading-[1.35] text-ink-900 hover:text-plum ${focusRing}`}
          >
            {task.title}
          </button>
          <p className="mb-0 mt-[5px] line-clamp-2 text-[12px] leading-[1.5] text-ink-500">{task.description}</p>
        </div>
        <div className="flex min-w-[92px] flex-col items-end gap-[5px] text-right">
          <span className={`text-[10.5px] font-semibold ${task.status === "completed" ? "text-pos-700" : task.status === "dismissed" ? "text-ink-400" : "text-plum-deep"}`}>{statusLabel(task.status)}</span>
          <span className="text-[9.5px] text-ink-300">Unverified</span>
        </div>
      </div>
      <details className="group mt-[9px] border-t border-line-4 pt-[7px]">
        <summary className={`w-fit cursor-pointer text-[10.5px] font-semibold text-ink-500 hover:text-plum ${focusRing}`}>
          Evidence ({task.evidence.length})
        </summary>
        {task.evidence.length ? (
          <div className="mt-[7px] divide-y divide-line-4 bg-surface-chip px-[9px]">
            {task.evidence.map((evidence, index) => (
              <div key={`${evidence.source}-${evidence.label}-${index}`} className="grid min-w-0 gap-[2px] py-[7px] sm:grid-cols-[120px_minmax(0,1fr)_150px] sm:gap-[8px]">
                <span className="text-[9.5px] font-semibold uppercase text-ink-400">{evidence.source}</span>
                <span className="min-w-0 break-words text-[11.5px] text-ink-700"><strong className="font-semibold">{evidence.label}:</strong> {evidence.value}</span>
                <span className="text-[9.5px] text-ink-400 sm:text-right">Observed {dateLabel(evidence.observedTo ?? evidence.observedFrom)}</span>
              </div>
            ))}
          </div>
        ) : (
          <p className="mb-0 mt-[6px] text-[11px] text-ink-400">Manual task. No connected-source evidence is attached.</p>
        )}
      </details>
      {task.status === "completed" ? (
        <p className="mb-0 mt-[8px] text-[10.5px] text-pos-700">{UNVERIFIED_COMPLETION_COPY}</p>
      ) : null}
    </article>
  );
}

export function SeoWorkspace({
  brandId,
  fetcher = globalThis.fetch,
  onCalendar,
  onStudio,
  onAskAI,
}: {
  brandId: string;
  fetcher?: typeof fetch;
  onCalendar: () => void;
  onStudio: () => void;
  onAskAI: (prompt: string) => void | Promise<void>;
}) {
  const [workspace, setWorkspace] = useState<SeoWorkspaceResponse | null>(null);
  const [loadState, setLoadState] = useState<"loading" | "ready" | "error">("loading");
  const [error, setError] = useState<string | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<SeoTaskStatus | "all">("all");
  const [severityFilter, setSeverityFilter] = useState<SeoSeverity | "all">("all");
  const [sourceFilter, setSourceFilter] = useState<SeoTaskSource | "all">("all");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [sort, setSort] = useState<"priority" | "severity" | "updated">("priority");
  const [manualOpen, setManualOpen] = useState(false);
  const [manualTitle, setManualTitle] = useState("");
  const [manualDescription, setManualDescription] = useState("");
  const [manualFix, setManualFix] = useState("");
  const [manualBusy, setManualBusy] = useState(false);
  const manualRequestRef = useRef<string | null>(null);
  const manualTitleRef = useRef<HTMLInputElement>(null);
  const taskOriginRef = useRef<HTMLButtonElement | null>(null);

  const fetchWorkspace = useCallback(async (): Promise<SeoWorkspaceResponse> => {
    const response = await fetcher(`/api/seo?brandId=${encodeURIComponent(brandId)}`, {
      method: "GET",
      headers: { Accept: "application/json" },
    });
    return responseJson<SeoWorkspaceResponse>(response);
  }, [brandId, fetcher]);

  const load = useCallback(async (quiet = false): Promise<SeoWorkspaceResponse | null> => {
    if (!quiet) setLoadState("loading");
    setError(null);
    try {
      const next = await fetchWorkspace();
      setWorkspace(next);
      setLoadState("ready");
      return next;
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "The SEO workspace could not be loaded.");
      if (!quiet) setLoadState("error");
      return null;
    }
  }, [fetchWorkspace]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (manualOpen) manualTitleRef.current?.focus();
  }, [manualOpen]);

  const categories = useMemo(
    () => [...new Set((workspace?.tasks ?? []).map((task) => task.category))].sort((a, b) => a.localeCompare(b)),
    [workspace?.tasks],
  );

  const visibleTasks = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return [...(workspace?.tasks ?? [])]
      .filter((task) => statusFilter === "all" || task.status === statusFilter)
      .filter((task) => severityFilter === "all" || task.severity === severityFilter)
      .filter((task) => sourceFilter === "all" || task.source === sourceFilter)
      .filter((task) => categoryFilter === "all" || task.category === categoryFilter)
      .filter((task) => !normalizedQuery || [task.title, task.description, task.recommendedFix, task.category]
        .some((value) => value.toLowerCase().includes(normalizedQuery)))
      .sort((a, b) => {
        if (sort === "severity") return severityRank[a.severity] - severityRank[b.severity] || a.priority - b.priority;
        if (sort === "updated") return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
        return a.priority - b.priority || severityRank[a.severity] - severityRank[b.severity];
      });
  }, [categoryFilter, query, severityFilter, sort, sourceFilter, statusFilter, workspace?.tasks]);

  const selectedTask = workspace?.tasks.find((task) => task.id === selectedTaskId) ?? null;
  const websiteUrl = workspace ? safeWebsiteUrl(workspace.brand.websiteUrl) : null;
  const hasTaskFilters = Boolean(
    query.trim()
    || statusFilter !== "all"
    || severityFilter !== "all"
    || sourceFilter !== "all"
    || categoryFilter !== "all",
  );

  const runAnalysis = async () => {
    if (!workspace?.capability.canManage || analyzing) return;
    setAnalyzing(true);
    setError(null);
    try {
      const response = await fetcher("/api/seo/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ brandId }),
      });
      await responseJson<unknown>(response);
      await load(true);
    } catch (analysisError) {
      setError(analysisError instanceof Error ? analysisError.message : "SEO analysis could not be started.");
    } finally {
      setAnalyzing(false);
    }
  };

  const resetManualForm = () => {
    manualRequestRef.current = null;
    setManualTitle("");
    setManualDescription("");
    setManualFix("");
    setManualOpen(false);
  };

  const addManualTask = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!workspace?.capability.canManage) return;
    setManualBusy(true);
    setError(null);
    const nextRequestId = manualRequestRef.current ?? requestId();
    manualRequestRef.current = nextRequestId;
    try {
      const response = await fetcher("/api/seo/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({
          brandId,
          requestId: nextRequestId,
          title: manualTitle.trim(),
          description: manualDescription.trim(),
          ...(manualFix.trim() ? { recommendedFix: manualFix.trim() } : {}),
        }),
      });
      await responseJson<unknown>(response);
      resetManualForm();
      await load(true);
    } catch (manualError) {
      setError(manualError instanceof Error ? manualError.message : "The manual SEO task could not be added.");
    } finally {
      setManualBusy(false);
    }
  };

  const updateTask = useCallback((task: SeoTask) => {
    setWorkspace((current) => current ? {
      ...current,
      tasks: current.tasks.map((candidate) => candidate.id === task.id ? task : candidate),
    } : current);
  }, []);

  const reloadTask = useCallback(async (taskId: string): Promise<SeoTask | null> => {
    const next = await fetchWorkspace();
    setWorkspace(next);
    return next.tasks.find((task) => task.id === taskId) ?? null;
  }, [fetchWorkspace]);

  const closeTask = useCallback(() => {
    setSelectedTaskId(null);
    requestAnimationFrame(() => taskOriginRef.current?.focus());
  }, []);

  const openTask = (task: SeoTask, event: ReactMouseEvent<HTMLButtonElement>) => {
    taskOriginRef.current = event.currentTarget;
    setSelectedTaskId(task.id);
  };

  return (
    <section className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-surface-panel" aria-labelledby="seo-workspace-title">
      <header className="flex-none border-b border-line-2 bg-surface-panel px-[14px] py-[13px] sm:px-[20px] lg:px-[24px]">
        <div className="flex min-w-0 flex-wrap items-start justify-between gap-[12px]">
          <div className="min-w-0">
            <p className="m-0 font-mono text-[9.5px] font-semibold uppercase tracking-[0.08em] text-ink-300">Organic + SEO</p>
            <div className="mt-[2px] flex min-w-0 flex-wrap items-baseline gap-x-[9px] gap-y-[2px]">
              <h1 id="seo-workspace-title" className="m-0 text-[20px] font-semibold text-ink-900">SEO workspace</h1>
              {workspace ? <span className="text-[11px] text-ink-400">Audit {dateLabel(workspace.brand.auditedAt)}</span> : null}
            </div>
            {workspace ? (
              <p className="mb-0 mt-[3px] min-w-0 text-[11.5px] text-ink-400">
                {websiteUrl ? <a href={websiteUrl} target="_blank" rel="noopener noreferrer" className={`inline-flex max-w-full items-center gap-[4px] truncate hover:text-plum ${focusRing}`}>{workspace.brand.websiteUrl}<LuExternalLink aria-hidden className="flex-none" /></a> : workspace.brand.name}
              </p>
            ) : null}
          </div>
          <div className="flex flex-wrap items-center justify-end gap-[7px]">
            <button type="button" onClick={() => void onAskAI("Review my current SEO tasks and help me choose the highest-impact next step without claiming any website change was made.")} className={`flex h-[36px] items-center gap-[7px] rounded-[7px] border border-plum-border bg-plum-soft px-[11px] text-[12px] font-semibold text-plum-deep ${focusRing}`}>
              <LuMessageSquare aria-hidden /> Ask assistant
            </button>
            {workspace?.capability.canManage ? (
              <button type="button" disabled={analyzing} onClick={() => void runAnalysis()} className={`flex h-[36px] items-center gap-[7px] rounded-[7px] bg-plum px-[11px] text-[12px] font-semibold text-white disabled:opacity-45 ${focusRing}`}>
                {analyzing ? <LuRefreshCw aria-hidden className="animate-spin motion-reduce:animate-none" /> : <LuFileSearch aria-hidden />}
                {analyzing ? "Analyzing…" : "Run analysis"}
              </button>
            ) : null}
          </div>
        </div>
        <div className="mt-[12px] inline-grid h-[36px] max-w-full grid-cols-3 rounded-[8px] bg-track-1 p-[3px]" aria-label="Organic workspace view">
          <button type="button" onClick={onCalendar} className={`flex min-w-0 items-center justify-center gap-[5px] rounded-[6px] px-[9px] text-[12px] font-semibold text-ink-400 sm:min-w-[104px] ${focusRing}`}><LuCalendarDays aria-hidden /> Calendar</button>
          <button type="button" onClick={onStudio} className={`flex min-w-0 items-center justify-center gap-[5px] rounded-[6px] px-[9px] text-[12px] font-semibold text-ink-400 sm:min-w-[104px] ${focusRing}`}><LuLayoutGrid aria-hidden /> Studio</button>
          <button type="button" aria-pressed="true" className={`flex min-w-0 items-center justify-center gap-[5px] rounded-[6px] bg-surface-card px-[9px] text-[12px] font-semibold text-ink-900 shadow-sm sm:min-w-[104px] ${focusRing}`}><LuChartNoAxesCombined aria-hidden /> SEO</button>
        </div>
      </header>

      <div className="min-h-0 min-w-0 flex-1 overflow-y-auto overflow-x-hidden">
        {error ? (
          <div role="alert" aria-live="assertive" className="mx-[14px] mt-[12px] flex min-w-0 items-start justify-between gap-[10px] border-l-[3px] border-neg-700 bg-neg-bg px-[11px] py-[9px] text-[12px] text-neg-700 sm:mx-[20px]">
            <span className="min-w-0">{error}</span>
            <button type="button" aria-label="Dismiss SEO error" onClick={() => setError(null)} className={`flex h-[28px] w-[28px] flex-none items-center justify-center rounded-[6px] ${focusRing}`}><LuX aria-hidden /></button>
          </div>
        ) : null}

        {loadState === "loading" ? (
          <div className="grid min-h-[420px] place-items-center" role="status" aria-live="polite">
            <div className="text-center"><LuRefreshCw aria-hidden className="mx-auto h-[20px] w-[20px] animate-spin text-plum motion-reduce:animate-none" /><p className="mb-0 mt-[8px] text-[12px] text-ink-400">Loading SEO workspace</p></div>
          </div>
        ) : null}

        {loadState === "error" ? (
          <div className="grid min-h-[420px] place-items-center px-[20px] text-center">
            <div><LuCircleAlert aria-hidden className="mx-auto h-[22px] w-[22px] text-neg-700" /><h2 className="mb-0 mt-[10px] text-[16px] font-semibold text-ink-900">SEO workspace unavailable</h2><button type="button" onClick={() => void load()} className={`mt-[13px] flex h-[35px] items-center gap-[6px] rounded-[7px] border border-line-1 bg-surface-card px-[11px] text-[11.5px] font-semibold text-ink-700 ${focusRing}`}><LuRefreshCw aria-hidden /> Try again</button></div>
          </div>
        ) : null}

        {loadState === "ready" && workspace ? (
          <div className="mx-auto min-w-0 max-w-[1220px] px-[14px] py-[15px] sm:px-[20px] lg:px-[24px] lg:py-[20px]">
            <section aria-labelledby="seo-source-coverage-title" className="min-w-0 border-b border-line-2 pb-[16px]">
              <div className="flex min-w-0 flex-wrap items-end justify-between gap-[7px]">
                <div>
                  <h2 id="seo-source-coverage-title" className="m-0 text-[14px] font-semibold text-ink-900">Source coverage</h2>
                  <p className="mb-0 mt-[2px] text-[11.5px] text-ink-400">Findings only appear when a source provides evidence.</p>
                </div>
                <span className="text-[10.5px] text-ink-400">{workspace.sources.filter((source) => source.state === "available").length} of {workspace.sources.length} sources available</span>
              </div>
              <div className="mt-[7px] min-w-0">
                {workspace.sources.map((source) => <SourceRow key={source.id} source={source} />)}
              </div>
            </section>

            <section aria-labelledby="seo-task-list-title" className="min-w-0 pt-[16px]">
              <div className="flex min-w-0 flex-wrap items-center justify-between gap-[9px]">
                <div>
                  <h2 id="seo-task-list-title" className="m-0 text-[14px] font-semibold text-ink-900">Prioritized work</h2>
                  <p className="mb-0 mt-[2px] text-[11.5px] text-ink-400">{visibleTasks.length} of {workspace.tasks.length} tasks</p>
                </div>
                {workspace.capability.canManage ? (
                  <button type="button" onClick={() => manualOpen ? resetManualForm() : setManualOpen(true)} aria-expanded={manualOpen} className={`flex h-[34px] items-center gap-[6px] rounded-[7px] border border-line-1 bg-surface-card px-[10px] text-[11.5px] font-semibold text-ink-700 hover:border-plum-border hover:text-plum ${focusRing}`}><LuPlus aria-hidden /> Add manual task</button>
                ) : null}
              </div>

              {manualOpen && workspace.capability.canManage ? (
                <form onSubmit={addManualTask} onKeyDown={(event) => { if (event.key === "Escape" && !manualBusy) resetManualForm(); }} className="mt-[11px] border-y border-line-2 bg-surface-chip px-[11px] py-[11px]">
                  <div className="grid min-w-0 gap-[9px] lg:grid-cols-[minmax(170px,0.8fr)_minmax(220px,1fr)_minmax(220px,1fr)_auto] lg:items-end">
                    <label className="grid min-w-0 gap-[4px] text-[10.5px] font-semibold text-ink-500">Title<input ref={manualTitleRef} required maxLength={160} value={manualTitle} onChange={(event) => setManualTitle(event.target.value)} className={controlClass} /></label>
                    <label className="grid min-w-0 gap-[4px] text-[10.5px] font-semibold text-ink-500">Description<input required maxLength={2000} value={manualDescription} onChange={(event) => setManualDescription(event.target.value)} className={controlClass} /></label>
                    <label className="grid min-w-0 gap-[4px] text-[10.5px] font-semibold text-ink-500">Recommended fix <span className="sr-only">optional</span><input maxLength={4000} value={manualFix} onChange={(event) => setManualFix(event.target.value)} className={controlClass} /></label>
                    <span className="flex items-center justify-end gap-[6px]">
                      <button type="button" disabled={manualBusy} onClick={resetManualForm} className={`h-[34px] rounded-[7px] border border-line-1 bg-surface-card px-[9px] text-[11px] font-semibold text-ink-600 ${focusRing}`}>Cancel</button>
                      <button type="submit" disabled={manualBusy || !manualTitle.trim() || !manualDescription.trim()} className={`flex h-[34px] items-center gap-[6px] rounded-[7px] bg-plum px-[10px] text-[11px] font-semibold text-white disabled:opacity-45 ${focusRing}`}>{manualBusy ? <LuRefreshCw aria-hidden className="animate-spin motion-reduce:animate-none" /> : <LuPlus aria-hidden />}{manualBusy ? "Adding…" : "Add task"}</button>
                    </span>
                  </div>
                </form>
              ) : null}

              <div className="mt-[11px] grid min-w-0 grid-cols-1 gap-[7px] sm:grid-cols-2 xl:grid-cols-[minmax(180px,1.3fr)_repeat(4,minmax(120px,0.7fr))]">
                <label className="relative min-w-0"><span className="sr-only">Search SEO tasks</span><LuSearch aria-hidden className="pointer-events-none absolute left-[9px] top-1/2 -translate-y-1/2 text-ink-300" /><input aria-label="Search SEO tasks" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search tasks" className={`${controlClass} w-full pl-[29px]`} /></label>
                <label className="relative min-w-0"><span className="sr-only">Filter task status</span><LuListFilter aria-hidden className="pointer-events-none absolute left-[9px] top-1/2 -translate-y-1/2 text-ink-300" /><select aria-label="Filter task status" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as SeoTaskStatus | "all")} className={`${controlClass} w-full pl-[29px]`}><option value="all">All status</option><option value="open">Open</option><option value="in_progress">In progress</option><option value="completed">Completed</option><option value="dismissed">Dismissed</option></select></label>
                <label className="min-w-0"><span className="sr-only">Filter severity</span><select aria-label="Filter severity" value={severityFilter} onChange={(event) => setSeverityFilter(event.target.value as SeoSeverity | "all")} className={`${controlClass} w-full`}><option value="all">All severity</option><option value="critical">Critical</option><option value="high">High</option><option value="medium">Medium</option><option value="low">Low</option></select></label>
                <label className="min-w-0"><span className="sr-only">Filter source</span><select aria-label="Filter source" value={sourceFilter} onChange={(event) => setSourceFilter(event.target.value as SeoTaskSource | "all")} className={`${controlClass} w-full`}><option value="all">All sources</option><option value="crawl">Crawl</option><option value="search_console">Search Console</option><option value="ga4">GA4</option><option value="manual">Manual</option></select></label>
                <label className="relative min-w-0"><span className="sr-only">Sort SEO tasks</span><LuArrowUpDown aria-hidden className="pointer-events-none absolute left-[9px] top-1/2 -translate-y-1/2 text-ink-300" /><select aria-label="Sort SEO tasks" value={sort} onChange={(event) => setSort(event.target.value as typeof sort)} className={`${controlClass} w-full pl-[29px]`}><option value="priority">Priority</option><option value="severity">Severity</option><option value="updated">Recently updated</option></select></label>
              </div>
              <label className="mt-[7px] block max-w-[260px]"><span className="sr-only">Filter category</span><select aria-label="Filter category" value={categoryFilter} onChange={(event) => setCategoryFilter(event.target.value)} className={`${controlClass} w-full`}><option value="all">All categories</option>{categories.map((category) => <option key={category} value={category}>{category}</option>)}</select></label>

              <div className="mt-[11px] min-w-0 overflow-hidden rounded-[7px] border border-line-2 bg-surface-card">
                {visibleTasks.length ? visibleTasks.map((task) => <TaskRow key={task.id} task={task} onOpen={(event) => openTask(task, event)} />) : (
                  <div className="grid min-h-[180px] place-items-center px-[18px] text-center">
                    {workspace.tasks.length === 0 && !hasTaskFilters ? (
                      <div>
                        <LuFileSearch aria-hidden className="mx-auto h-[20px] w-[20px] text-ink-300" />
                        <h3 className="mb-0 mt-[8px] text-[14px] font-semibold text-ink-900">No SEO work queued yet</h3>
                        <p className="mx-auto mb-0 mt-[3px] max-w-[390px] text-[11.5px] leading-[1.5] text-ink-400">Run an evidence-backed analysis to create prioritized tasks, or add one manually.</p>
                        {workspace.capability.canManage ? <button type="button" disabled={analyzing} onClick={() => void runAnalysis()} className={`mt-[11px] inline-flex h-[34px] items-center gap-[6px] rounded-[7px] bg-plum px-[10px] text-[11.5px] font-semibold text-white disabled:opacity-45 ${focusRing}`}>{analyzing ? <LuRefreshCw aria-hidden className="animate-spin motion-reduce:animate-none" /> : <LuFileSearch aria-hidden />}{analyzing ? "Analyzing…" : "Run first analysis"}</button> : null}
                      </div>
                    ) : (
                      <div><LuSearch aria-hidden className="mx-auto h-[20px] w-[20px] text-ink-300" /><h3 className="mb-0 mt-[8px] text-[14px] font-semibold text-ink-900">No tasks match</h3><p className="mb-0 mt-[3px] text-[11.5px] text-ink-400">Change a filter to see the full SEO history.</p></div>
                    )}
                  </div>
                )}
              </div>
            </section>
          </div>
        ) : null}
      </div>

      {selectedTask ? (
        <SeoTaskDialog
          key={selectedTask.id}
          task={selectedTask}
          canManage={workspace?.capability.canManage === true}
          fetcher={fetcher}
          onClose={closeTask}
          onTaskUpdated={updateTask}
          onReloadLatest={reloadTask}
        />
      ) : null}
    </section>
  );
}
