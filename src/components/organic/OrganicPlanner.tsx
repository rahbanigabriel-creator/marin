"use client";

import {
  type DragEvent,
  type FormEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  LuCalendarDays,
  LuChartNoAxesCombined,
  LuChevronLeft,
  LuChevronRight,
  LuCircleAlert,
  LuClock3,
  LuCopy,
  LuExternalLink,
  LuLayoutGrid,
  LuListPlus,
  LuMessageSquare,
  LuMoveLeft,
  LuMoveRight,
  LuPlus,
  LuRefreshCw,
  LuSettings2,
  LuSparkles,
  LuTrash2,
  LuUsers,
  LuX,
} from "react-icons/lu";

import { InfluencerWorkspace } from "@/components/influencers";
import { ORGANIC_FORMATS_BY_PLATFORM } from "@/lib/content/destinations";
import { SeoWorkspace } from "@/components/seo/SeoWorkspace";

import {
  addCalendarDays,
  addCalendarMonths,
  calendarDateKey,
  formatCalendarDate,
  formatWallTime,
  isSameCalendarMonth,
  monthGridStart,
  normalizeCalendarResponse,
  startOfCalendarWeek,
  startOfCalendarMonth,
  todayKey,
  wallClockFromIso,
  zonedDateTimeToIso,
} from "./calendar-utils";
import {
  ORGANIC_PLATFORMS,
  type CalendarPublicationDto,
  type ContentItemDto,
  type ContentPlanDto,
  type OrganicCalendarPost,
  type OrganicCalendarResponse,
  type OrganicPlannerProps,
  type OrganicPlannerStatus,
  type OrganicPlannerView,
  type OrganicPlatform,
  type OrganicPostDraft,
} from "./types";
import { ContentStudio } from "./ContentStudio";
import {
  AssistedHandoffDialog,
  type AssistedHandoffPublication,
} from "./AssistedHandoffDialog";

const focusRing =
  "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-plum";

const PLATFORM_META: Record<
  OrganicPlatform,
  { label: string; short: string; dot: string; formats: readonly string[] }
> = {
  youtube: { label: "YouTube", short: "YT", dot: "bg-red-600", formats: ORGANIC_FORMATS_BY_PLATFORM.youtube },
  instagram: { label: "Instagram", short: "IG", dot: "bg-fuchsia-600", formats: ORGANIC_FORMATS_BY_PLATFORM.instagram },
  facebook: { label: "Facebook", short: "FB", dot: "bg-blue-600", formats: ORGANIC_FORMATS_BY_PLATFORM.facebook },
  tiktok: { label: "TikTok", short: "TT", dot: "bg-ink-900", formats: ORGANIC_FORMATS_BY_PLATFORM.tiktok },
  snapchat: { label: "Snapchat", short: "SC", dot: "bg-yellow-400", formats: ORGANIC_FORMATS_BY_PLATFORM.snapchat },
  reddit: { label: "Reddit", short: "RD", dot: "bg-orange-600", formats: ORGANIC_FORMATS_BY_PLATFORM.reddit },
  pinterest: { label: "Pinterest", short: "PT", dot: "bg-rose-700", formats: ORGANIC_FORMATS_BY_PLATFORM.pinterest },
};

const EMPTY_DRAFT: OrganicPostDraft = {
  title: "",
  copy: "",
  platform: "instagram",
  format: "post",
  date: "",
  time: "09:00",
  status: "draft",
};

interface EditorState {
  mode: "create" | "edit";
  post: OrganicCalendarPost | null;
  draft: OrganicPostDraft;
  requestId: string | null;
  sourceContentItemId: string | null;
  planId: string | null;
}

interface PlanDraft {
  mode: "create" | "edit";
  plan: ContentPlanDto | null;
  name: string;
  objective: string;
  period: OrganicPlannerView;
  status: ContentPlanDto["status"];
  requestId: string | null;
}

interface ApiErrorPayload {
  error?: string;
  code?: string;
  message?: string;
  currentVersion?: number;
  actionUrl?: string;
}

interface CalendarMutationIssue {
  message: string;
  actionUrl?: string;
}

class CalendarRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
    readonly currentVersion?: number,
    readonly actionUrl?: string,
  ) {
    super(message);
    this.name = "CalendarRequestError";
  }
}

function statusLabel(status: OrganicPlannerStatus): string {
  switch (status) {
    case "ready": return "Ready for review";
    case "scheduled": return "Scheduled";
    case "publishing": return "Publishing";
    case "published": return "External completion recorded";
    case "failed": return "Needs attention";
    case "cancelled": return "Cancelled";
    default: return "Planned";
  }
}

function isEditableStatus(status: OrganicPlannerStatus): status is "draft" | "ready" {
  return status === "draft" || status === "ready";
}

function apiErrorMessage(status: number, payload?: ApiErrorPayload): string {
  if (payload?.message) return payload.message;
  if (status === 401) return "Your session expired. Sign in again to continue.";
  if (status === 403) return "You do not have permission to change this plan.";
  if (status === 404) return "That post is no longer available. Refresh the calendar.";
  if (status === 409) return "This post changed elsewhere. Refresh and try again.";
  if (status === 402 || payload?.code === "scheduled_post_limit") {
    return "This workspace has reached its planned-post limit.";
  }
  return `The calendar request failed (${status}). Please try again.`;
}

async function responsePayload<T>(response: Response): Promise<T> {
  const payload = (await response.json().catch(() => ({}))) as T & ApiErrorPayload;
  if (!response.ok) {
    throw new CalendarRequestError(
      apiErrorMessage(response.status, payload),
      response.status,
      payload.code ?? payload.error,
      payload.currentVersion,
      payload.actionUrl,
    );
  }
  return payload;
}

function postFromEditor(post: OrganicCalendarPost, draft: OrganicPostDraft, scheduledAt: string, version: number): OrganicCalendarPost {
  return {
    ...post,
    title: draft.title,
    copy: draft.copy,
    status: draft.status,
    platform: draft.platform,
    format: draft.format,
    scheduledAt,
    expectedVersion: version,
  };
}

function IconButton({
  label,
  disabled,
  onClick,
  children,
}: {
  label: string;
  disabled?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className={`flex h-[34px] w-[34px] flex-none items-center justify-center rounded-[7px] border border-line-1 bg-surface-card text-ink-500 transition-colors hover:border-plum-border hover:text-plum disabled:cursor-not-allowed disabled:opacity-40 ${focusRing}`}
    >
      {children}
    </button>
  );
}

function LoadingState() {
  return (
    <div className="grid min-h-[360px] place-items-center" role="status" aria-live="polite">
      <div className="text-center">
        <LuRefreshCw aria-hidden className="mx-auto h-[22px] w-[22px] animate-spin text-plum" />
        <p className="mt-[10px] text-[13px] text-ink-400">Loading your organic plan</p>
      </div>
    </div>
  );
}

function EmptyState({
  onAdd,
  onGenerate,
  period,
  canManage,
}: {
  onAdd: () => void;
  onGenerate: () => void;
  period: OrganicPlannerView;
  canManage: boolean;
}) {
  return (
    <div className="grid min-h-[360px] place-items-center px-[20px] text-center">
      <div className="max-w-[430px]">
        <span className="mx-auto flex h-[42px] w-[42px] items-center justify-center rounded-[8px] bg-plum-soft text-plum">
          <LuCalendarDays aria-hidden className="h-[20px] w-[20px]" />
        </span>
        <h2 className="mb-0 mt-[15px] text-[18px] font-semibold text-ink-900">No posts planned yet</h2>
        <p className="mb-0 mt-[7px] text-[13px] leading-[1.55] text-ink-400">
          {canManage
            ? `Add the first post manually, or let Marpin prepare a reviewable ${period} from your saved audit context.`
            : "This calendar is read-only for your workspace role."}
        </p>
        {canManage ? <div className="mt-[18px] flex flex-wrap justify-center gap-[8px]">
          <button
            type="button"
            onClick={onAdd}
            className={`flex h-[36px] items-center gap-[7px] rounded-[7px] bg-plum px-[13px] text-[12.5px] font-semibold text-white ${focusRing}`}
          >
            <LuPlus aria-hidden /> Add post
          </button>
          <button
            type="button"
            onClick={onGenerate}
            className={`flex h-[36px] items-center gap-[7px] rounded-[7px] border border-line-1 bg-surface-card px-[13px] text-[12.5px] font-semibold text-ink-700 ${focusRing}`}
          >
            <LuSparkles aria-hidden className="text-plum" /> Plan next {period}
          </button>
        </div> : null}
      </div>
    </div>
  );
}

function ErrorState({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="grid min-h-[360px] place-items-center px-[20px] text-center" role="alert">
      <div className="max-w-[430px]">
        <LuCircleAlert aria-hidden className="mx-auto h-[24px] w-[24px] text-neg-700" />
        <h2 className="mb-0 mt-[12px] text-[17px] font-semibold text-ink-900">Calendar unavailable</h2>
        <p className="mb-0 mt-[7px] text-[13px] leading-[1.55] text-ink-400">{message}</p>
        <button
          type="button"
          onClick={onRetry}
          className={`mt-[16px] inline-flex h-[36px] items-center gap-[7px] rounded-[7px] border border-line-1 bg-surface-card px-[13px] text-[12.5px] font-semibold text-ink-700 ${focusRing}`}
        >
          <LuRefreshCw aria-hidden /> Try again
        </button>
      </div>
    </div>
  );
}

function FilteredEmptyState({ onClear }: { onClear: () => void }) {
  return (
    <div className="grid min-h-[360px] place-items-center px-[20px] text-center">
      <div className="max-w-[390px]">
        <LuCalendarDays aria-hidden className="mx-auto h-[23px] w-[23px] text-ink-300" />
        <h2 className="mb-0 mt-[12px] text-[17px] font-semibold text-ink-900">
          No posts match these filters
        </h2>
        <p className="mb-0 mt-[6px] text-[12.5px] leading-[1.55] text-ink-400">
          Show every platform and content plan to get back to the full calendar.
        </p>
        <button
          type="button"
          onClick={onClear}
          className={`mt-[14px] h-[35px] rounded-[7px] border border-line-1 bg-surface-card px-[12px] text-[12px] font-semibold text-ink-700 ${focusRing}`}
        >
          Clear filters
        </button>
      </div>
    </div>
  );
}

function MutationNotice({
  message,
  actionUrl,
  onReload,
  onDismiss,
}: {
  message: string;
  actionUrl?: string;
  onReload: () => void;
  onDismiss: () => void;
}) {
  return (
    <div
      role="alert"
      className="mx-[14px] mt-[12px] flex min-w-0 items-center justify-between gap-[10px] rounded-[7px] border border-line-1 bg-neg-bg px-[11px] py-[9px] text-[12px] text-neg-700 sm:mx-[20px]"
    >
      <span className="min-w-0">{message}</span>
      <span className="flex flex-none items-center gap-[6px]">
        {actionUrl ? (
          <a
            href={actionUrl}
            className={`inline-flex h-[29px] items-center gap-[5px] rounded-[6px] border border-line-1 bg-surface-card px-[9px] text-[11px] font-semibold text-ink-800 ${focusRing}`}
          >
            Upgrade plan <LuExternalLink aria-hidden />
          </a>
        ) : (
          <button
            type="button"
            onClick={onReload}
            className={`h-[29px] rounded-[6px] border border-line-1 bg-surface-card px-[9px] text-[11px] font-semibold ${focusRing}`}
          >
            Reload latest
          </button>
        )}
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Dismiss calendar error"
          className={`flex h-[29px] w-[29px] items-center justify-center rounded-[6px] text-neg-700 ${focusRing}`}
        >
          <LuX aria-hidden />
        </button>
      </span>
    </div>
  );
}

function PostCard({
  post,
  timezone,
  locale,
  moving,
  canMove,
  compact = false,
  onOpen,
  onMove,
  onDragStart,
  onDragEnd,
}: {
  post: OrganicCalendarPost;
  timezone: string;
  locale: string;
  moving: boolean;
  canMove: boolean;
  compact?: boolean;
  onOpen: () => void;
  onMove: (days: number) => void;
  onDragStart?: (event: DragEvent<HTMLElement>) => void;
  onDragEnd?: () => void;
}) {
  const meta = PLATFORM_META[post.platform];
  const editable = isEditableStatus(post.status);
  return (
    <article
      draggable={canMove && Boolean(onDragStart) && !moving}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      className={`group relative min-w-0 rounded-[7px] border border-line-3 bg-surface-card p-[9px] shadow-[0_1px_2px_rgba(43,39,34,0.04)] ${canMove && onDragStart ? "cursor-grab active:cursor-grabbing" : ""}`}
    >
      <button
        type="button"
        onClick={onOpen}
        className={`block w-full min-w-0 border-0 bg-transparent p-0 text-left ${focusRing}`}
      aria-label={`${editable ? "Edit" : "View"} ${post.title} on ${meta.label}`}
      data-publication-id={post.publicationId}
      >
        <span className="flex min-w-0 items-center gap-[6px]">
          <span className={`h-[7px] w-[7px] flex-none rounded-full ${meta.dot}`} aria-hidden />
          <span className="truncate font-mono text-[9.5px] font-semibold uppercase tracking-[0.06em] text-ink-400">
            {meta.label} · {post.format}
          </span>
        </span>
        <span className="mt-[5px] block overflow-hidden text-ellipsis whitespace-nowrap text-[12px] font-semibold text-ink-900">
          {post.title}
        </span>
        <span className={`${compact ? "mt-[3px]" : "mt-[5px]"} flex items-center justify-between gap-[5px] text-[10.5px] text-ink-400`}>
          <span className="flex min-w-0 items-center gap-[4px]">
            <LuClock3 aria-hidden className="flex-none" />
            {formatWallTime(post.scheduledAt, timezone, locale)}
          </span>
          <span className={`${compact ? "sr-only" : ""} ${post.status === "ready" || post.status === "published" ? "text-pos-700" : post.status === "failed" ? "text-neg-700" : "text-ink-400"}`}>
            {statusLabel(post.status)}
          </span>
        </span>
      </button>
      {!compact ? (
        <div className="mt-[7px] flex gap-[5px] border-t border-line-4 pt-[6px]">
          <button
            type="button"
            disabled={moving || !canMove}
            onClick={() => onMove(-1)}
            aria-label={`Move ${post.title} one day earlier`}
            title="Move one day earlier"
            className={`flex h-[25px] w-[25px] items-center justify-center rounded-[6px] border border-line-4 bg-surface-chip text-ink-400 hover:text-plum disabled:opacity-40 ${focusRing}`}
          >
            <LuMoveLeft aria-hidden />
          </button>
          <button
            type="button"
            disabled={moving || !canMove}
            onClick={() => onMove(1)}
            aria-label={`Move ${post.title} one day later`}
            title="Move one day later"
            className={`flex h-[25px] w-[25px] items-center justify-center rounded-[6px] border border-line-4 bg-surface-chip text-ink-400 hover:text-plum disabled:opacity-40 ${focusRing}`}
          >
            <LuMoveRight aria-hidden />
          </button>
        </div>
      ) : null}
    </article>
  );
}

function PostEditor({
  state,
  busy,
  canReview,
  error,
  conflict,
  onChange,
  onClose,
  onDuplicate,
  onDelete,
  onHandoff,
  onReloadLatest,
  onSubmit,
}: {
  state: EditorState;
  busy: boolean;
  canReview: boolean;
  error: string | null;
  conflict: boolean;
  onChange: (draft: OrganicPostDraft) => void;
  onClose: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
  onHandoff: () => void;
  onReloadLatest: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  const titleRef = useRef<HTMLInputElement>(null);
  const dialogRef = useRef<HTMLElement>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const platform = PLATFORM_META[state.draft.platform];
  const duplicate = state.mode === "create" && Boolean(state.sourceContentItemId);
  const terminal = state.mode === "edit" && Boolean(state.post && !isEditableStatus(state.post.status));
  const locked = terminal || (state.mode === "edit" && !canReview);
  const handoffAvailable = state.mode === "edit" && state.post?.status !== "draft";
  const handoffLabel = state.post?.status === "ready"
    ? "Finish externally"
    : state.post?.status === "failed"
      ? "Try assisted handoff"
      : "View handoff";

  useEffect(() => {
    const target = locked
      ? dialogRef.current?.querySelector<HTMLElement>(
          "button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled])",
        )
      : titleRef.current;
    target?.focus();
  }, [locked]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busy) onClose();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [busy, onClose]);

  const fieldClass = `w-full rounded-[7px] border border-line-1 bg-surface-card px-[10px] py-[8px] text-[13px] text-ink-900 outline-none focus:border-plum-border ${focusRing}`;
  const set = <K extends keyof OrganicPostDraft>(key: K, value: OrganicPostDraft[K]) =>
    onChange({ ...state.draft, [key]: value });
  const keepFocusInDialog = (event: ReactKeyboardEvent<HTMLElement>) => {
    if (event.key !== "Tab") return;
    const focusable = [...(dialogRef.current?.querySelectorAll<HTMLElement>(
      "button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled])",
    ) ?? [])];
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

  return (
    <div
      className="fixed inset-0 z-[90] flex items-end justify-center bg-black/25 p-0 sm:items-center sm:p-[20px]"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !busy) onClose();
      }}
    >
      <section
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="organic-editor-title"
        onKeyDown={keepFocusInDialog}
        className="max-h-[94dvh] w-full overflow-y-auto rounded-t-[8px] border border-line-1 bg-surface-panel shadow-modal sm:max-w-[620px] sm:rounded-[8px]"
      >
        <header className="sticky top-0 z-10 flex items-center justify-between border-b border-line-2 bg-surface-panel px-[18px] py-[14px]">
          <div>
            <p className="m-0 font-mono text-[9.5px] font-semibold uppercase tracking-[0.08em] text-ink-300">
              Organic calendar
            </p>
            <h2 id="organic-editor-title" className="mb-0 mt-[2px] text-[17px] font-semibold text-ink-900">
              {state.mode === "create" ? duplicate ? "Duplicate post" : "Add post" : terminal ? "Publication details" : "Edit post"}
            </h2>
          </div>
          <IconButton label="Close post editor" disabled={busy} onClick={onClose}>
            <LuX aria-hidden />
          </IconButton>
        </header>

        <form onSubmit={onSubmit} className="grid gap-[15px] px-[18px] py-[17px]">
          <label className="grid gap-[6px]">
            <span className="font-mono text-[9.5px] font-semibold uppercase tracking-[0.08em] text-ink-300">Title</span>
            <input
              ref={titleRef}
              required
              disabled={locked}
              maxLength={160}
              value={state.draft.title}
              onChange={(event) => set("title", event.target.value)}
              placeholder="What is this post about?"
              className={fieldClass}
            />
          </label>

          <label className="grid gap-[6px]">
            <span className="flex items-center justify-between gap-[10px] font-mono text-[9.5px] font-semibold uppercase tracking-[0.08em] text-ink-300">
              Copy <span aria-live="polite">{state.draft.copy.length.toLocaleString()} characters</span>
            </span>
            <textarea
              required
              disabled={locked}
              rows={6}
              maxLength={20_000}
              value={state.draft.copy}
              onChange={(event) => set("copy", event.target.value)}
              placeholder="Write the post copy"
              className={`${fieldClass} min-h-[128px] resize-y leading-[1.5]`}
            />
          </label>

          <div className="grid grid-cols-1 gap-[12px] sm:grid-cols-2">
            <label className="grid gap-[6px]">
              <span className="font-mono text-[9.5px] font-semibold uppercase tracking-[0.08em] text-ink-300">Platform</span>
              <select
                value={state.draft.platform}
                disabled={state.mode === "edit"}
                aria-describedby={state.mode === "edit" ? "organic-destination-note" : undefined}
                onChange={(event) => {
                  const next = event.target.value as OrganicPlatform;
                  onChange({ ...state.draft, platform: next, format: PLATFORM_META[next].formats[0] });
                }}
                className={`${fieldClass} disabled:cursor-not-allowed disabled:bg-track-1 disabled:text-ink-400`}
              >
                {ORGANIC_PLATFORMS.map((value) => (
                  <option key={value} value={value}>{PLATFORM_META[value].label}</option>
                ))}
              </select>
            </label>
            <label className="grid gap-[6px]">
              <span className="font-mono text-[9.5px] font-semibold uppercase tracking-[0.08em] text-ink-300">Format</span>
              <select
                value={state.draft.format}
                disabled={state.mode === "edit"}
                aria-describedby={state.mode === "edit" ? "organic-destination-note" : undefined}
                onChange={(event) => set("format", event.target.value)}
                className={`${fieldClass} disabled:cursor-not-allowed disabled:bg-track-1 disabled:text-ink-400`}
              >
                {platform.formats.map((format) => (
                  <option key={format} value={format}>{format[0].toUpperCase() + format.slice(1)}</option>
                ))}
              </select>
            </label>
          </div>
          {state.mode === "edit" ? (
            <p id="organic-destination-note" className="-mt-[7px] mb-0 text-[11px] text-ink-400">
              Create a new post to use a different platform or format.
            </p>
          ) : null}

          <div className="grid grid-cols-2 gap-[12px]">
            <label className="grid min-w-0 gap-[6px]">
              <span className="font-mono text-[9.5px] font-semibold uppercase tracking-[0.08em] text-ink-300">Date</span>
              <input
                required
                type="date"
                disabled={locked}
                value={state.draft.date}
                onChange={(event) => set("date", event.target.value)}
                className={fieldClass}
              />
            </label>
            <label className="grid min-w-0 gap-[6px]">
              <span className="font-mono text-[9.5px] font-semibold uppercase tracking-[0.08em] text-ink-300">Time</span>
              <input
                required
                type="time"
                disabled={locked}
                value={state.draft.time}
                onChange={(event) => set("time", event.target.value)}
                className={fieldClass}
              />
            </label>
          </div>

          <fieldset className="m-0 min-w-0 border-0 p-0">
            <legend className="mb-[7px] font-mono text-[9.5px] font-semibold uppercase tracking-[0.08em] text-ink-300">Status</legend>
            {terminal ? (
              <div className="flex h-[38px] items-center rounded-[7px] border border-line-1 bg-surface-card px-[11px] text-[12px] font-semibold text-ink-600">
                {statusLabel(state.post?.status ?? state.draft.status)}
              </div>
            ) : <div className="grid grid-cols-2 rounded-[8px] bg-track-1 p-[3px]" role="radiogroup">
              {(["draft", "ready"] as const).map((status) => (
                <label key={status} className="min-w-0">
                  <input
                    type="radio"
                    name="organic-status"
                    value={status}
                    checked={state.draft.status === status}
                    disabled={locked || (!canReview && status === "ready")}
                    onChange={() => set("status", status)}
                    className="peer sr-only"
                  />
                  <span className={`flex h-[34px] cursor-pointer items-center justify-center rounded-[6px] px-[8px] text-center text-[12px] font-semibold text-ink-400 peer-checked:bg-surface-card peer-checked:text-ink-900 peer-disabled:cursor-not-allowed peer-disabled:opacity-45 peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-plum`}>
                    {statusLabel(status)}
                  </span>
                </label>
              ))}
            </div>}
          </fieldset>

          {error ? (
            <div role="alert" className="flex min-w-0 items-center justify-between gap-[9px] rounded-[7px] bg-neg-bg px-[11px] py-[9px] text-[12px] text-neg-700">
              <span className="min-w-0">{error}</span>
              {conflict ? (
                <button
                  type="button"
                  disabled={busy}
                  onClick={onReloadLatest}
                  className={`h-[29px] flex-none rounded-[6px] border border-line-1 bg-surface-card px-[9px] text-[11px] font-semibold ${focusRing}`}
                >
                  Reload latest
                </button>
              ) : null}
            </div>
          ) : null}

          {state.mode === "edit" && confirmDelete ? (
            <div role="alert" className="flex flex-wrap items-center justify-between gap-[9px] rounded-[7px] border border-line-1 bg-neg-bg px-[11px] py-[9px] text-[12px] text-neg-700">
              <span>Remove this calendar post? Its reusable master content stays available.</span>
              <span className="flex items-center gap-[6px]">
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => setConfirmDelete(false)}
                  className={`h-[29px] rounded-[6px] border border-line-1 bg-surface-card px-[9px] text-[11px] font-semibold ${focusRing}`}
                >
                  Keep post
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={onDelete}
                  className={`h-[29px] rounded-[6px] bg-neg-700 px-[9px] text-[11px] font-semibold text-white ${focusRing}`}
                >
                  {busy ? "Removing…" : "Remove"}
                </button>
              </span>
            </div>
          ) : null}

          <footer className="flex items-center justify-between gap-[8px] border-t border-line-2 pt-[14px]">
            <span className="flex flex-wrap items-center gap-[6px]">
              {state.mode === "edit" && canReview && !confirmDelete ? (
                <button
                  type="button"
                  disabled={busy}
                  onClick={onDuplicate}
                  className={`flex h-[37px] items-center gap-[6px] rounded-[7px] border border-line-1 bg-surface-card px-[9px] text-[12px] font-semibold text-ink-700 disabled:opacity-40 ${focusRing}`}
                >
                  <LuCopy aria-hidden /> Duplicate post
                </button>
              ) : null}
              {state.mode === "edit" && !locked && !confirmDelete ? (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => setConfirmDelete(true)}
                  className={`flex h-[37px] items-center gap-[6px] rounded-[7px] px-[9px] text-[12px] font-semibold text-neg-700 disabled:opacity-40 ${focusRing}`}
                >
                  <LuTrash2 aria-hidden /> Remove post
                </button>
              ) : null}
              {handoffAvailable && !confirmDelete ? (
                <button
                  type="button"
                  disabled={busy}
                  onClick={onHandoff}
                  className={`flex h-[37px] items-center gap-[6px] rounded-[7px] border border-plum-border bg-plum-soft px-[10px] text-[12px] font-semibold text-plum-deep disabled:opacity-40 ${focusRing}`}
                >
                  <LuExternalLink aria-hidden /> {handoffLabel}
                </button>
              ) : null}
            </span>
            <span className="flex items-center gap-[8px]">
            <button
              type="button"
              disabled={busy}
              onClick={onClose}
              className={`h-[37px] rounded-[7px] border border-line-1 bg-surface-card px-[14px] text-[12.5px] font-semibold text-ink-600 disabled:opacity-40 ${focusRing}`}
            >
              Cancel
            </button>
            {!terminal ? (
              <button
                type="submit"
                disabled={busy || locked || !state.draft.title.trim() || !state.draft.copy.trim()}
                className={`h-[37px] rounded-[7px] bg-plum px-[15px] text-[12.5px] font-semibold text-white disabled:cursor-not-allowed disabled:opacity-45 ${focusRing}`}
              >
                {busy ? "Saving…" : state.mode === "create" ? duplicate ? "Duplicate post" : "Add to plan" : "Save changes"}
              </button>
            ) : null}
            </span>
          </footer>
        </form>
      </section>
    </div>
  );
}

function PlanEditor({
  draft,
  rangeLabel,
  busy,
  canManage,
  conflict,
  error,
  onChange,
  onClose,
  onDelete,
  onReloadLatest,
  onSubmit,
}: {
  draft: PlanDraft;
  rangeLabel: string;
  busy: boolean;
  canManage: boolean;
  conflict: boolean;
  error: string | null;
  onChange: (draft: PlanDraft) => void;
  onClose: () => void;
  onDelete: () => void;
  onReloadLatest: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  const nameRef = useRef<HTMLInputElement>(null);
  const dialogRef = useRef<HTMLElement>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const locked = draft.mode === "edit" && !canManage;

  useEffect(() => {
    const target = locked
      ? dialogRef.current?.querySelector<HTMLElement>(
          "button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled])",
        )
      : nameRef.current;
    target?.focus();
  }, [locked]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busy) onClose();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [busy, onClose]);

  const fieldClass = `w-full rounded-[7px] border border-line-1 bg-surface-card px-[10px] py-[8px] text-[13px] text-ink-900 outline-none focus:border-plum-border ${focusRing}`;
  const keepFocusInDialog = (event: ReactKeyboardEvent<HTMLElement>) => {
    if (event.key !== "Tab") return;
    const focusable = [...(dialogRef.current?.querySelectorAll<HTMLElement>(
      "button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled])",
    ) ?? [])];
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
  return (
    <div
      className="fixed inset-0 z-[90] flex items-end justify-center bg-black/25 p-0 sm:items-center sm:p-[20px]"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !busy) onClose();
      }}
    >
      <section
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="organic-plan-editor-title"
        onKeyDown={keepFocusInDialog}
        className="w-full rounded-t-[8px] border border-line-1 bg-surface-panel shadow-modal sm:max-w-[520px] sm:rounded-[8px]"
      >
        <header className="flex items-center justify-between border-b border-line-2 px-[18px] py-[14px]">
          <div>
            <p className="m-0 font-mono text-[9.5px] font-semibold uppercase tracking-[0.08em] text-ink-300">
              {rangeLabel}
            </p>
            <h2 id="organic-plan-editor-title" className="mb-0 mt-[2px] text-[17px] font-semibold text-ink-900">
              {draft.mode === "create" ? "New content plan" : "Manage content plan"}
            </h2>
          </div>
          <IconButton label="Close plan editor" disabled={busy} onClick={onClose}>
            <LuX aria-hidden />
          </IconButton>
        </header>
        <form onSubmit={onSubmit} className="grid gap-[14px] px-[18px] py-[17px]">
          <label className="grid gap-[6px]">
            <span className="font-mono text-[9.5px] font-semibold uppercase tracking-[0.08em] text-ink-300">
              Plan name
            </span>
            <input
              ref={nameRef}
              required
              disabled={locked}
              maxLength={160}
              value={draft.name}
              onChange={(event) => onChange({ ...draft, name: event.target.value })}
              className={fieldClass}
            />
          </label>
          <label className="grid gap-[6px]">
            <span className="font-mono text-[9.5px] font-semibold uppercase tracking-[0.08em] text-ink-300">
              Objective
            </span>
            <textarea
              rows={3}
              maxLength={2_000}
              value={draft.objective}
              disabled={locked}
              onChange={(event) => onChange({ ...draft, objective: event.target.value })}
              placeholder="What should this plan achieve?"
              className={`${fieldClass} resize-y`}
            />
          </label>
          {draft.mode === "create" ? (
          <fieldset className="m-0 min-w-0 border-0 p-0">
            <legend className="mb-[7px] font-mono text-[9.5px] font-semibold uppercase tracking-[0.08em] text-ink-300">
              Planning period
            </legend>
            <div className="grid grid-cols-2 rounded-[8px] bg-track-1 p-[3px]">
              {(["week", "month"] as const).map((period) => (
                <label key={period} className="min-w-0">
                  <input
                    type="radio"
                    name="organic-plan-period"
                    value={period}
                    checked={draft.period === period}
                    onChange={() => onChange({ ...draft, period })}
                    className="peer sr-only"
                  />
                  <span className="flex h-[34px] cursor-pointer items-center justify-center rounded-[6px] text-[12px] font-semibold capitalize text-ink-400 peer-checked:bg-surface-card peer-checked:text-ink-900 peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-plum">
                    {period}
                  </span>
                </label>
              ))}
            </div>
          </fieldset>
          ) : (
            <fieldset className="m-0 min-w-0 border-0 p-0">
              <legend className="mb-[7px] font-mono text-[9.5px] font-semibold uppercase tracking-[0.08em] text-ink-300">
                Lifecycle
              </legend>
              <div className="grid grid-cols-3 rounded-[8px] bg-track-1 p-[3px]">
                {(["draft", "active", "archived"] as const).map((status) => (
                  <label key={status} className="min-w-0">
                    <input
                      type="radio"
                      name="organic-plan-status"
                      value={status}
                      checked={draft.status === status}
                      disabled={!canManage}
                      onChange={() => onChange({ ...draft, status })}
                      className="peer sr-only"
                    />
                    <span className="flex h-[34px] cursor-pointer items-center justify-center rounded-[6px] px-[6px] text-[11.5px] font-semibold capitalize text-ink-400 peer-checked:bg-surface-card peer-checked:text-ink-900 peer-disabled:cursor-not-allowed peer-disabled:opacity-50 peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-plum">
                      {status}
                    </span>
                  </label>
                ))}
              </div>
            </fieldset>
          )}
          {error ? (
            <div role="alert" className="flex min-w-0 items-center justify-between gap-[9px] rounded-[7px] bg-neg-bg px-[11px] py-[9px] text-[12px] text-neg-700">
              <span className="min-w-0">{error}</span>
              {conflict ? (
                <button
                  type="button"
                  disabled={busy}
                  onClick={onReloadLatest}
                  className={`h-[29px] flex-none rounded-[6px] border border-line-1 bg-surface-card px-[9px] text-[11px] font-semibold ${focusRing}`}
                >
                  Reload latest
                </button>
              ) : null}
            </div>
          ) : null}
          {draft.mode === "edit" && confirmDelete ? (
            <div role="alert" className="flex flex-wrap items-center justify-between gap-[9px] rounded-[7px] border border-line-1 bg-neg-bg px-[11px] py-[9px] text-[12px] text-neg-700">
              <span>Delete this plan? Its posts will remain on the calendar without a plan.</span>
              <span className="flex items-center gap-[6px]">
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => setConfirmDelete(false)}
                  className={`h-[29px] rounded-[6px] border border-line-1 bg-surface-card px-[9px] text-[11px] font-semibold ${focusRing}`}
                >
                  Keep plan
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={onDelete}
                  className={`h-[29px] rounded-[6px] bg-neg-700 px-[9px] text-[11px] font-semibold text-white ${focusRing}`}
                >
                  {busy ? "Deleting…" : "Delete"}
                </button>
              </span>
            </div>
          ) : null}
          <footer className="flex items-center justify-between gap-[8px] border-t border-line-2 pt-[14px]">
            <span>
              {draft.mode === "edit" && canManage && !confirmDelete ? (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => setConfirmDelete(true)}
                  className={`flex h-[37px] items-center gap-[6px] rounded-[7px] px-[9px] text-[12px] font-semibold text-neg-700 disabled:opacity-40 ${focusRing}`}
                >
                  <LuTrash2 aria-hidden /> Delete plan
                </button>
              ) : null}
            </span>
            <span className="flex items-center gap-[8px]">
            <button
              type="button"
              disabled={busy}
              onClick={onClose}
              className={`h-[37px] rounded-[7px] border border-line-1 bg-surface-card px-[14px] text-[12.5px] font-semibold text-ink-600 disabled:opacity-40 ${focusRing}`}
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={busy || locked || !draft.name.trim()}
              className={`h-[37px] rounded-[7px] bg-plum px-[15px] text-[12.5px] font-semibold text-white disabled:opacity-45 ${focusRing}`}
            >
              {busy ? "Saving…" : draft.mode === "create" ? "Create plan" : "Save plan"}
            </button>
            </span>
          </footer>
        </form>
      </section>
    </div>
  );
}

export function OrganicPlanner({
  brandId,
  timezone = "UTC",
  locale = "en-GB",
  initialView = "week",
  className = "",
  onAskAI,
  onPostSaved,
  canManagePlans = true,
  fetcher,
}: OrganicPlannerProps) {
  const [surface, setSurface] = useState<"calendar" | "studio" | "seo" | "influencers">("calendar");
  const [view, setView] = useState<OrganicPlannerView>(initialView);
  const [cursor, setCursor] = useState(() => todayKey(timezone));
  const [mobileDay, setMobileDay] = useState(() => todayKey(timezone));
  const [enabledPlatforms, setEnabledPlatforms] = useState<Set<OrganicPlatform>>(
    () => new Set(ORGANIC_PLATFORMS),
  );
  const [posts, setPosts] = useState<OrganicCalendarPost[]>([]);
  const [plans, setPlans] = useState<ContentPlanDto[]>([]);
  const [activePlanId, setActivePlanId] = useState("");
  const [loadState, setLoadState] = useState<"loading" | "ready" | "error">("loading");
  const [loadError, setLoadError] = useState("The calendar could not be loaded.");
  const [mutationError, setMutationError] = useState<CalendarMutationIssue | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [editor, setEditor] = useState<EditorState | null>(null);
  const [editorBusy, setEditorBusy] = useState(false);
  const [editorError, setEditorError] = useState<string | null>(null);
  const [editorConflict, setEditorConflict] = useState(false);
  const [handoffPublicationId, setHandoffPublicationId] = useState<string | null>(null);
  const [studioInitialContentId, setStudioInitialContentId] = useState<string | null>(null);
  const [movingId, setMovingId] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dragOverDay, setDragOverDay] = useState<string | null>(null);
  const [dragAnnouncement, setDragAnnouncement] = useState("");
  const [planDraft, setPlanDraft] = useState<PlanDraft | null>(null);
  const [planBusy, setPlanBusy] = useState(false);
  const [planError, setPlanError] = useState<string | null>(null);
  const [planConflict, setPlanConflict] = useState(false);
  const addButtonRef = useRef<HTMLButtonElement>(null);
  const planButtonRef = useRef<HTMLButtonElement>(null);
  const hasLoadedRef = useRef(false);
  const requestedPlanRef = useRef<string | null>(null);
  const generationRequestRef = useRef<{ id: string; period: OrganicPlannerView } | null>(null);
  const [urlReady, setUrlReady] = useState(false);
  const request = useMemo(() => fetcher ?? fetch, [fetcher]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const canonicalSurface = params.get("view");
    const legacySurface = params.get("organicView");
    const urlSurface = canonicalSurface === "calendar"
      && (legacySurface === "studio" || legacySurface === "seo")
      ? legacySurface
      : canonicalSurface ?? legacySurface;
    const urlView = params.get("calendarView");
    const urlPlan = params.get("plan");
    if (urlSurface === "calendar" || urlSurface === "studio" || urlSurface === "seo" || urlSurface === "influencers") setSurface(urlSurface);
    if (urlView === "week" || urlView === "month") setView(urlView);
    if (urlPlan) {
      requestedPlanRef.current = urlPlan;
      setActivePlanId(urlPlan);
    }
    setUrlReady(true);
  }, []);

  useEffect(() => {
    if (!urlReady) return;
    const url = new URL(window.location.href);
    url.searchParams.set("view", surface);
    url.searchParams.delete("organicView");
    url.searchParams.set("calendarView", view);
    if (activePlanId) url.searchParams.set("plan", activePlanId);
    else url.searchParams.delete("plan");
    window.history.replaceState(window.history.state, "", url);
  }, [activePlanId, surface, urlReady, view]);

  useEffect(() => {
    const nextToday = todayKey(timezone);
    setCursor(nextToday);
    setMobileDay(nextToday);
  }, [timezone]);

  const range = useMemo(() => {
    const start = view === "week" ? startOfCalendarWeek(cursor) : monthGridStart(cursor);
    const days = view === "week" ? 7 : 42;
    return {
      start,
      end: addCalendarDays(start, days),
      days: Array.from({ length: days }, (_, index) => addCalendarDays(start, index)),
    };
  }, [cursor, view]);

  useEffect(() => {
    if (range.days.includes(mobileDay)) return;
    setMobileDay(view === "month" ? startOfCalendarMonth(cursor) : range.start);
  }, [cursor, mobileDay, range.days, range.start, view]);

  const load = useCallback(async (signal?: AbortSignal) => {
    if (!hasLoadedRef.current) setLoadState("loading");
    const start = zonedDateTimeToIso(range.start, "00:00", timezone);
    const end = zonedDateTimeToIso(range.end, "00:00", timezone);
    const params = new URLSearchParams({ start, end });
    try {
      const response = await request(`/api/content/calendar?${params.toString()}`, {
        method: "GET",
        headers: { Accept: "application/json" },
        signal,
      });
      const payload = await responsePayload<OrganicCalendarResponse>(response);
      if (signal?.aborted) return;
      const incomingPlans = payload.calendar?.plans ?? payload.data?.plans ?? payload.plans ?? [];
      setPlans(incomingPlans);
      setActivePlanId((current) => {
        const requested = requestedPlanRef.current;
        requestedPlanRef.current = null;
        const candidate = requested ?? current;
        return candidate && incomingPlans.some((plan) => plan.id === candidate) ? candidate : "";
      });
      setPosts(normalizeCalendarResponse(payload));
      hasLoadedRef.current = true;
      setMutationError(null);
      setLoadState("ready");
    } catch (error) {
      if (signal?.aborted) return;
      const message = error instanceof Error ? error.message : "The calendar could not be loaded.";
      if (hasLoadedRef.current) setMutationError({ message });
      else {
        setLoadError(message);
        setLoadState("error");
      }
    }
  }, [range.end, range.start, request, timezone]);

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load, reloadKey]);

  const filteredPosts = useMemo(
    () =>
      posts.filter(
        (post) =>
          enabledPlatforms.has(post.platform) &&
          (!activePlanId || post.planId === activePlanId),
      ),
    [activePlanId, enabledPlatforms, posts],
  );
  const postsByDay = useMemo(() => {
    const map = new Map<string, OrganicCalendarPost[]>();
    for (const post of filteredPosts) {
      const key = calendarDateKey(new Date(post.scheduledAt), timezone);
      map.set(key, [...(map.get(key) ?? []), post]);
    }
    return map;
  }, [filteredPosts, timezone]);
  const selectedPlan = useMemo(
    () => plans.find((plan) => plan.id === activePlanId) ?? null,
    [activePlanId, plans],
  );

  const openCreate = useCallback((date = mobileDay) => {
    if (!canManagePlans) return;
    setEditorError(null);
    setEditorConflict(false);
    setEditor({
      mode: "create",
      post: null,
      draft: { ...EMPTY_DRAFT, date },
      requestId: globalThis.crypto.randomUUID(),
      sourceContentItemId: null,
      planId: null,
    });
  }, [canManagePlans, mobileDay]);

  const openEdit = useCallback((post: OrganicCalendarPost) => {
    const wall = wallClockFromIso(post.scheduledAt, timezone);
    setEditorError(null);
    setEditorConflict(false);
    setEditor({
      mode: "edit",
      post,
      requestId: null,
      sourceContentItemId: null,
      planId: post.planId,
      draft: {
        title: post.title,
        copy: post.copy,
        platform: post.platform,
        format: post.format,
        date: wall.date,
        time: wall.time,
        status: post.status,
      },
    });
  }, [timezone]);

  const openDuplicate = useCallback((post: OrganicCalendarPost) => {
    if (!canManagePlans) return;
    const wall = wallClockFromIso(post.scheduledAt, timezone);
    setEditorError(null);
    setEditorConflict(false);
    setEditor({
      mode: "create",
      post: null,
      requestId: globalThis.crypto.randomUUID(),
      sourceContentItemId: post.contentItemId,
      planId: post.planId,
      draft: {
        title: `Copy of ${post.title}`.slice(0, 160),
        copy: post.copy,
        platform: post.platform,
        format: post.format,
        date: wall.date,
        time: wall.time,
        status: isEditableStatus(post.status) ? post.status : "draft",
      },
    });
  }, [canManagePlans, timezone]);

  const closeEditor = useCallback(() => {
    if (editorBusy) return;
    setEditor(null);
    setEditorError(null);
    setEditorConflict(false);
    requestAnimationFrame(() => addButtonRef.current?.focus());
  }, [editorBusy]);

  const closeHandoff = useCallback(() => {
    const publicationId = handoffPublicationId;
    setHandoffPublicationId(null);
    requestAnimationFrame(() => {
      const target = [...document.querySelectorAll<HTMLButtonElement>("[data-publication-id]")]
        .find((button) => button.dataset.publicationId === publicationId);
      target?.focus();
    });
  }, [handoffPublicationId]);

  const updateHandoffPublication = useCallback((publication: AssistedHandoffPublication) => {
    setPosts((current) => current.map((post) => post.publicationId === publication.id
      ? {
          ...post,
          status: publication.status as OrganicPlannerStatus,
          expectedVersion: publication.contentVersion,
        }
      : post));
  }, []);

  const planPeriod = planDraft?.period ?? view;
  const planStart = planDraft?.mode === "edit" && planDraft.plan
    ? calendarDateKey(new Date(planDraft.plan.startDate), planDraft.plan.timezone)
    : planPeriod === "week" ? startOfCalendarWeek(cursor) : startOfCalendarMonth(cursor);
  const planEnd = planDraft?.mode === "edit" && planDraft.plan
    ? calendarDateKey(new Date(planDraft.plan.endDate), planDraft.plan.timezone)
    : planPeriod === "week" ? addCalendarDays(planStart, 7) : addCalendarMonths(planStart, 1);
  const planRangeLabel =
    planPeriod === "week"
      ? `${formatCalendarDate(planStart, locale, { day: "numeric", month: "short" })} – ${formatCalendarDate(addCalendarDays(planEnd, -1), locale, { day: "numeric", month: "short", year: "numeric" })}`
      : formatCalendarDate(planStart, locale, { month: "long", year: "numeric" });

  const openPlanEditor = useCallback(() => {
    if (!canManagePlans) return;
    const period = view;
    const start = period === "week" ? startOfCalendarWeek(cursor) : startOfCalendarMonth(cursor);
    const label =
      period === "week"
        ? `Week of ${formatCalendarDate(start, locale, { day: "numeric", month: "short" })}`
        : `${formatCalendarDate(start, locale, { month: "long", year: "numeric" })} content plan`;
    setPlanError(null);
    setPlanConflict(false);
    setPlanDraft({
      mode: "create",
      plan: null,
      name: label,
      objective: "",
      period,
      status: "draft",
      requestId: globalThis.crypto.randomUUID(),
    });
  }, [canManagePlans, cursor, locale, view]);

  const openManagePlan = useCallback((plan: ContentPlanDto) => {
    setPlanError(null);
    setPlanConflict(false);
    setPlanDraft({
      mode: "edit",
      plan,
      name: plan.name,
      objective: plan.objective ?? "",
      period: plan.period,
      status: plan.status,
      requestId: null,
    });
  }, []);

  const closePlanEditor = useCallback(() => {
    if (planBusy) return;
    setPlanDraft(null);
    setPlanError(null);
    setPlanConflict(false);
    requestAnimationFrame(() => planButtonRef.current?.focus());
  }, [planBusy]);

  const savePlan = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      if (!planDraft) return;
      setPlanBusy(true);
      setPlanError(null);
      setPlanConflict(false);
      try {
        const editing = planDraft.mode === "edit" ? planDraft.plan : null;
        const response = await request(
          editing ? `/api/content/plans/${encodeURIComponent(editing.id)}` : "/api/content/plans",
          {
          method: editing ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json", Accept: "application/json" },
          body: JSON.stringify(editing ? {
            expectedVersion: editing.version,
            name: planDraft.name.trim(),
            objective: planDraft.objective.trim() || null,
            status: planDraft.status,
          } : {
              brandId,
              name: planDraft.name.trim(),
              objective: planDraft.objective.trim() || null,
              period: planDraft.period,
              startDate: zonedDateTimeToIso(planStart, "00:00", timezone),
              endDate: zonedDateTimeToIso(planEnd, "00:00", timezone),
              timezone,
              requestId: planDraft.requestId,
            }),
          },
        );
        const payload = await responsePayload<{ plan?: ContentPlanDto }>(response);
        if (!payload.plan?.id) throw new Error("The plan was saved without an ID.");
        setPlans((current) => editing
          ? current.map((plan) => plan.id === payload.plan?.id ? payload.plan as ContentPlanDto : plan)
          : [payload.plan as ContentPlanDto, ...current],
        );
        setActivePlanId(payload.plan.id);
        setPlanDraft(null);
      } catch (error) {
        setPlanConflict(error instanceof CalendarRequestError && error.status === 409);
        setPlanError(error instanceof Error ? error.message : "The plan could not be created.");
      } finally {
        setPlanBusy(false);
      }
    },
    [brandId, planDraft, planEnd, planStart, request, timezone],
  );

  const deletePlan = useCallback(async () => {
    const plan = planDraft?.mode === "edit" ? planDraft.plan : null;
    if (!plan) return;
    setPlanBusy(true);
    setPlanError(null);
    setPlanConflict(false);
    try {
      const response = await request(`/api/content/plans/${encodeURIComponent(plan.id)}`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ expectedVersion: plan.version }),
      });
      const payload = await responsePayload<{
        planId?: string;
        deleted?: boolean;
        contentItems?: ContentItemDto[];
      }>(response);
      const detachedById = new Map(
        (payload.contentItems ?? []).map((contentItem) => [contentItem.id, contentItem]),
      );
      setPlans((current) => current.filter((candidate) => candidate.id !== plan.id));
      setPosts((current) => current.map((post) => {
        if (post.planId !== plan.id) return post;
        const detached = detachedById.get(post.contentItemId);
        return {
          ...post,
          planId: detached?.planId ?? null,
          expectedVersion: detached?.version ?? post.expectedVersion + 1,
        };
      }));
      setActivePlanId((current) => current === plan.id ? "" : current);
      setPlanDraft(null);
    } catch (error) {
      setPlanConflict(error instanceof CalendarRequestError && error.status === 409);
      setPlanError(error instanceof Error ? error.message : "The plan could not be deleted.");
    } finally {
      setPlanBusy(false);
    }
  }, [planDraft, request]);

  const saveEditor = useCallback(async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!editor || (editor.post && !isEditableStatus(editor.post.status))) return;
      setEditorBusy(true);
      setEditorError(null);
      setEditorConflict(false);
    try {
      const scheduledAt = zonedDateTimeToIso(editor.draft.date, editor.draft.time, timezone);
      if (editor.mode === "create") {
        const response = await request("/api/content/posts", {
          method: "POST",
          headers: { "Content-Type": "application/json", Accept: "application/json" },
          body: JSON.stringify({
            brandId,
            planId: editor.sourceContentItemId
              ? editor.planId
              : (editor.planId ?? activePlanId) || null,
            title: editor.draft.title.trim(),
            coreCopy: editor.draft.copy.trim(),
            platform: editor.draft.platform,
            format: editor.draft.format,
            status: editor.draft.status,
            scheduledAt,
            requestId: editor.requestId,
            sourceContentItemId: editor.sourceContentItemId,
          }),
        });
        const payload = await responsePayload<{
          post?: { contentItem?: ContentItemDto; publication?: CalendarPublicationDto };
        }>(response);
        const contentItem = payload.post?.contentItem;
        const publication = payload.post?.publication;
        if (!contentItem?.id || !publication?.id) {
          throw new Error("The post was saved without a complete calendar record.");
        }
        onPostSaved?.({
          publicationId: publication.id,
          contentItemId: contentItem.id,
          title: contentItem.title,
          copy: contentItem.coreCopy ?? editor.draft.copy.trim(),
          platform: editor.draft.platform,
          format: editor.draft.format,
          status: editor.draft.status,
          scheduledAt,
          expectedVersion: contentItem.version,
          planId: (editor.planId ?? activePlanId) || null,
        });
      } else if (editor.post) {
        const response = await request(`/api/content/variants/${encodeURIComponent(editor.post.publicationId)}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json", Accept: "application/json" },
          body: JSON.stringify({
            title: editor.draft.title.trim(),
            body: editor.draft.copy.trim(),
            status: editor.draft.status,
            scheduledAt,
            expectedVersion: editor.post.expectedVersion,
          }),
        });
        const payload = await responsePayload<{
          post?: { contentItem?: ContentItemDto; publication?: CalendarPublicationDto };
        }>(response);
        const contentItem = payload.post?.contentItem;
        if (!contentItem?.id) throw new Error("The content update did not return a record.");
        setEditor((current) => current?.post
          ? { ...current, post: { ...current.post, expectedVersion: contentItem.version } }
          : current,
        );
        onPostSaved?.(postFromEditor(editor.post, editor.draft, scheduledAt, contentItem.version));
      }
      setEditor(null);
      setReloadKey((value) => value + 1);
    } catch (error) {
      setEditorConflict(error instanceof CalendarRequestError && error.status === 409);
      setEditorError(error instanceof Error ? error.message : "The post could not be saved.");
    } finally {
      setEditorBusy(false);
    }
  }, [activePlanId, brandId, editor, onPostSaved, request, timezone]);

  const deletePost = useCallback(async () => {
    const post = editor?.mode === "edit" ? editor.post : null;
    if (!post || !isEditableStatus(post.status)) return;
    setEditorBusy(true);
    setEditorError(null);
    setEditorConflict(false);
    try {
      const response = await request(`/api/content/variants/${encodeURIComponent(post.publicationId)}`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ expectedVersion: post.expectedVersion }),
      });
      const payload = await responsePayload<{
        publicationId?: string;
        contentItemId?: string;
        contentItemVersion?: number;
      }>(response);
      setPosts((current) => current
        .filter((candidate) => candidate.publicationId !== post.publicationId)
        .map((candidate) =>
          candidate.contentItemId === post.contentItemId
            ? { ...candidate, expectedVersion: payload.contentItemVersion ?? candidate.expectedVersion + 1 }
            : candidate,
        ));
      setEditor(null);
      setDragAnnouncement(`${post.title} was removed from the calendar.`);
    } catch (error) {
      setEditorConflict(error instanceof CalendarRequestError && error.status === 409);
      setEditorError(error instanceof Error ? error.message : "The post could not be removed.");
    } finally {
      setEditorBusy(false);
    }
  }, [editor, request]);

  const movePostToDate = useCallback(async (post: OrganicCalendarPost, targetDate: string) => {
    if (!isEditableStatus(post.status)) return;
    const wall = wallClockFromIso(post.scheduledAt, timezone);
    if (wall.date === targetDate) {
      setDragAnnouncement(`${post.title} is already scheduled on that day.`);
      return;
    }
    const scheduledAt = zonedDateTimeToIso(targetDate, wall.time, timezone);
    const previous = post;
    setMovingId(post.publicationId);
    setMutationError(null);
    setPosts((current) => current.map((candidate) =>
      candidate.publicationId === post.publicationId ? { ...candidate, scheduledAt } : candidate,
    ));
    try {
      const response = await request(`/api/content/variants/${encodeURIComponent(post.publicationId)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({
          scheduledAt,
          status: post.status,
          expectedVersion: post.expectedVersion,
        }),
      });
      const payload = await responsePayload<{
        post?: { contentItem?: ContentItemDto };
      }>(response);
      const nextVersion = payload.post?.contentItem?.version;
      setPosts((current) => current.map((candidate) =>
        candidate.contentItemId === post.contentItemId
          ? {
              ...candidate,
              scheduledAt:
                candidate.publicationId === post.publicationId
                  ? scheduledAt
                  : candidate.scheduledAt,
              expectedVersion: nextVersion ?? candidate.expectedVersion + 1,
            }
          : candidate,
      ));
      setDragAnnouncement(
        `${post.title} moved to ${formatCalendarDate(targetDate, locale, { day: "numeric", month: "long" })}.`,
      );
    } catch (error) {
      setPosts((current) => current.map((candidate) =>
        candidate.publicationId === previous.publicationId ? previous : candidate,
      ));
      const message = error instanceof Error ? error.message : "The post could not be moved.";
      setMutationError({ message });
      setDragAnnouncement(`${post.title} was not moved. ${message}`);
    } finally {
      setMovingId(null);
      setDraggingId(null);
      setDragOverDay(null);
    }
  }, [locale, request, timezone]);

  const movePost = useCallback((post: OrganicCalendarPost, days: number) => {
    const wall = wallClockFromIso(post.scheduledAt, timezone);
    return movePostToDate(post, addCalendarDays(wall.date, days));
  }, [movePostToDate, timezone]);

  const reloadLatest = useCallback(() => {
    setMutationError(null);
    setEditor(null);
    setEditorError(null);
    setEditorConflict(false);
    setPlanDraft(null);
    setPlanError(null);
    setPlanConflict(false);
    setReloadKey((value) => value + 1);
  }, []);

  const navigate = (direction: number) => {
    const next = view === "week"
      ? addCalendarDays(cursor, direction * 7)
      : addCalendarMonths(cursor, direction);
    setCursor(next);
    setMobileDay(view === "week" ? startOfCalendarWeek(next) : startOfCalendarMonth(next));
  };

  const goToday = () => {
    const today = todayKey(timezone);
    setCursor(today);
    setMobileDay(today);
  };

  const askAssistant = () => {
    if (!canManagePlans) return;
    const active = ORGANIC_PLATFORMS.filter((platform) => enabledPlatforms.has(platform))
      .map((platform) => PLATFORM_META[platform].label)
      .join(", ");
    const period = view === "week"
      ? `the week of ${formatCalendarDate(range.start, locale, { day: "numeric", month: "long", year: "numeric" })}`
      : formatCalendarDate(cursor, locale, { month: "long", year: "numeric" });
    void onAskAI(`Help me plan organic content for ${period}. Focus on ${active || "my organic channels"}, use my saved business context, and suggest post ideas I can review before adding them to the calendar.`);
  };

  const generateNextPeriod = useCallback(async () => {
    const platforms = ORGANIC_PLATFORMS.filter((platform) => enabledPlatforms.has(platform));
    if (!canManagePlans || !platforms.length || generating) return;
    const pending = generationRequestRef.current?.period === view
      ? generationRequestRef.current
      : { id: globalThis.crypto.randomUUID(), period: view };
    const requestId = pending.id;
    generationRequestRef.current = pending;
    setGenerating(true);
    setMutationError(null);
    try {
      const response = await request("/api/content/plans/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ brandId, platforms, requestId, period: view }),
      });
      const payload = await responsePayload<{
        plan?: ContentPlanDto;
        posts?: Array<{ contentItem?: ContentItemDto; publication?: CalendarPublicationDto }>;
      }>(response);
      if (!payload.plan?.id || !payload.posts?.length) {
        throw new Error(`Marpin did not return a complete ${view} plan.`);
      }
      const generatedPosts = normalizeCalendarResponse({
        calendar: {
          plans: [payload.plan],
          contentItems: payload.posts.flatMap((post) => post.contentItem ? [post.contentItem] : []),
          publications: payload.posts.flatMap((post) => post.publication ? [post.publication] : []),
        },
      });
      if (!generatedPosts.length) throw new Error(`The ${view} plan did not contain calendar posts.`);
      setPlans((current) => [payload.plan as ContentPlanDto, ...current.filter((plan) => plan.id !== payload.plan?.id)]);
      setPosts((current) => [
        ...current.filter((post) => !generatedPosts.some((generated) => generated.publicationId === post.publicationId)),
        ...generatedPosts,
      ]);
      const firstDay = calendarDateKey(new Date(payload.plan.startDate), payload.plan.timezone);
      setView(view);
      setCursor(firstDay);
      setMobileDay(firstDay);
      setActivePlanId(payload.plan.id);
      generationRequestRef.current = null;
      setDragAnnouncement(`${payload.plan.name} was added with ${generatedPosts.length} draft posts.`);
    } catch (error) {
      const requestError = error instanceof CalendarRequestError ? error : null;
      const upgradeAction = view === "month"
        && requestError
        && (requestError.status === 402 || requestError.code === "scheduled_post_limit")
        ? requestError.actionUrl ?? "/settings/billing"
        : undefined;
      setMutationError({
        message: error instanceof Error ? error.message : `The ${view} plan could not be generated.`,
        actionUrl: upgradeAction,
      });
    } finally {
      setGenerating(false);
    }
  }, [brandId, canManagePlans, enabledPlatforms, generating, request, view]);

  const periodLabel = view === "week"
    ? `${formatCalendarDate(range.start, locale, { day: "numeric", month: "short" })} – ${formatCalendarDate(addCalendarDays(range.end, -1), locale, { day: "numeric", month: "short", year: "numeric" })}`
    : formatCalendarDate(cursor, locale, { month: "long", year: "numeric" });
  const requestedMobileWeekStart = startOfCalendarWeek(mobileDay);
  const mobileWeekStart = range.days.includes(requestedMobileWeekStart)
    ? requestedMobileWeekStart
    : range.start;
  const mobileWeekIndex = Math.max(0, Math.floor(range.days.indexOf(mobileWeekStart) / 7));
  const mobileWeekCount = Math.ceil(range.days.length / 7);
  const mobileWeek = Array.from({ length: 7 }, (_, index) =>
    addCalendarDays(mobileWeekStart, index),
  );
  const pageMobileMonthWeek = (direction: number) => {
    const nextIndex = Math.min(
      mobileWeekCount - 1,
      Math.max(0, mobileWeekIndex + direction),
    );
    setMobileDay(range.days[nextIndex * 7]);
  };
  const visibleCount = filteredPosts.length;

  if (surface === "studio") {
    return (
      <ContentStudio
        brandId={brandId}
        timezone={timezone}
        locale={locale}
        canManage={canManagePlans}
        initialContentId={studioInitialContentId ?? undefined}
        onCalendar={() => {
          setReloadKey((current) => current + 1);
          setSurface("calendar");
        }}
        onSeo={() => setSurface("seo")}
        onInfluencers={() => setSurface("influencers")}
        onAskAI={onAskAI}
      />
    );
  }

  if (surface === "seo") {
    return (
      <SeoWorkspace
        brandId={brandId}
        fetcher={request}
        onCalendar={() => {
          setReloadKey((current) => current + 1);
          setSurface("calendar");
        }}
        onStudio={() => setSurface("studio")}
        onInfluencers={() => setSurface("influencers")}
        onAskAI={onAskAI}
      />
    );
  }

  if (surface === "influencers") {
    return (
      <InfluencerWorkspace
        brandId={brandId}
        fetcher={request}
        onCalendar={() => {
          setReloadKey((current) => current + 1);
          setSurface("calendar");
        }}
        onStudio={() => setSurface("studio")}
        onSeo={() => setSurface("seo")}
        onAskAI={onAskAI}
      />
    );
  }

  return (
    <section className={`flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-surface-panel ${className}`} aria-labelledby="organic-planner-title">
      <header className="flex-none border-b border-line-2 bg-surface-panel px-[14px] py-[13px] sm:px-[20px] lg:px-[24px]">
        <div className="flex min-w-0 flex-wrap items-start justify-between gap-[12px]">
          <div className="min-w-0">
            <p className="m-0 font-mono text-[9.5px] font-semibold uppercase tracking-[0.08em] text-ink-300">Organic + SEO</p>
            <h1 id="organic-planner-title" className="mb-0 mt-[2px] truncate text-[20px] font-semibold text-ink-900">Content planner</h1>
          </div>
          <div className="flex flex-wrap items-center justify-end gap-[7px]">
            <button
              type="button"
              disabled={!canManagePlans}
              onClick={askAssistant}
              className={`flex h-[36px] items-center gap-[7px] rounded-[7px] border border-plum-border bg-plum-soft px-[12px] text-[12px] font-semibold text-plum-deep disabled:cursor-not-allowed disabled:opacity-45 ${focusRing}`}
            >
              <LuMessageSquare aria-hidden /> Ask assistant
            </button>
            <button
              type="button"
              disabled={!canManagePlans || generating || enabledPlatforms.size === 0}
              onClick={() => void generateNextPeriod()}
              className={`flex h-[36px] items-center gap-[7px] rounded-[7px] border border-line-1 bg-surface-card px-[12px] text-[12px] font-semibold text-ink-700 disabled:cursor-not-allowed disabled:opacity-45 ${focusRing}`}
            >
              {generating ? <LuRefreshCw aria-hidden className="animate-spin" /> : <LuSparkles aria-hidden className="text-plum" />}
              {generating ? "Planning…" : `Plan next ${view}`}
            </button>
            <button
              ref={addButtonRef}
              type="button"
              disabled={!canManagePlans}
              onClick={() => openCreate()}
              className={`flex h-[36px] items-center gap-[7px] rounded-[7px] bg-plum px-[12px] text-[12px] font-semibold text-white disabled:cursor-not-allowed disabled:opacity-45 ${focusRing}`}
            >
              <LuPlus aria-hidden /> Add post
            </button>
          </div>
        </div>

        <div className="mt-[12px] grid h-[36px] w-full max-w-[480px] grid-cols-4 rounded-[8px] bg-track-1 p-[3px]" aria-label="Organic workspace view">
          <button
            type="button"
            aria-pressed="true"
            className={`flex min-w-0 items-center justify-center gap-[5px] rounded-[6px] bg-surface-card px-[6px] text-[11px] font-semibold text-ink-900 shadow-sm sm:text-[12px] ${focusRing}`}
          >
            <LuCalendarDays aria-hidden /> <span className="hidden min-[430px]:inline">Calendar</span>
          </button>
          <button
            type="button"
            aria-pressed="false"
            onClick={() => setSurface("studio")}
            className={`flex min-w-0 items-center justify-center gap-[5px] rounded-[6px] px-[6px] text-[11px] font-semibold text-ink-400 sm:text-[12px] ${focusRing}`}
          >
            <LuLayoutGrid aria-hidden /> <span className="hidden min-[430px]:inline">Studio</span>
          </button>
          <button
            type="button"
            aria-pressed="false"
            onClick={() => setSurface("seo")}
            className={`flex min-w-0 items-center justify-center gap-[5px] rounded-[6px] px-[6px] text-[11px] font-semibold text-ink-400 sm:text-[12px] ${focusRing}`}
          >
            <LuChartNoAxesCombined aria-hidden /> <span className="hidden min-[430px]:inline">SEO</span>
          </button>
          <button
            type="button"
            aria-pressed="false"
            onClick={() => setSurface("influencers")}
            className={`flex min-w-0 items-center justify-center gap-[5px] rounded-[6px] px-[6px] text-[11px] font-semibold text-ink-400 sm:text-[12px] ${focusRing}`}
          >
            <LuUsers aria-hidden /> <span className="hidden min-[430px]:inline">Influencers</span>
          </button>
        </div>

        <div className="mt-[14px] flex min-w-0 flex-wrap items-center justify-between gap-[10px]">
          <div className="flex min-w-0 items-center gap-[6px]">
            <IconButton label={`Previous ${view}`} onClick={() => navigate(-1)}><LuChevronLeft aria-hidden /></IconButton>
            <button
              type="button"
              onClick={goToday}
              className={`h-[34px] rounded-[7px] border border-line-1 bg-surface-card px-[11px] text-[12px] font-semibold text-ink-600 ${focusRing}`}
            >
              Today
            </button>
            <IconButton label={`Next ${view}`} onClick={() => navigate(1)}><LuChevronRight aria-hidden /></IconButton>
            <h2 className="ml-[3px] min-w-0 truncate text-[13px] font-semibold text-ink-800 sm:text-[14px]">{periodLabel}</h2>
          </div>

          <div className="grid h-[36px] grid-cols-2 rounded-[8px] bg-track-1 p-[3px]" aria-label="Calendar view">
            {(["week", "month"] as const).map((option) => (
              <button
                key={option}
                type="button"
                aria-pressed={view === option}
                onClick={() => setView(option)}
                className={`min-w-[66px] rounded-[6px] px-[10px] text-[12px] font-semibold capitalize ${focusRing} ${view === option ? "bg-surface-card text-ink-900 shadow-sm" : "text-ink-400"}`}
              >
                {option}
              </button>
            ))}
          </div>
        </div>

        <div className="mt-[12px] flex min-w-0 gap-[6px] overflow-x-auto pb-[2px]" aria-label="Filter calendar by platform">
          {ORGANIC_PLATFORMS.map((platform) => {
            const meta = PLATFORM_META[platform];
            const active = enabledPlatforms.has(platform);
            return (
              <button
                key={platform}
                type="button"
                aria-pressed={active}
                onClick={() => setEnabledPlatforms((current) => {
                  const next = new Set(current);
                  if (next.has(platform)) next.delete(platform);
                  else next.add(platform);
                  return next;
                })}
                className={`flex h-[31px] flex-none items-center gap-[6px] rounded-[7px] border px-[9px] text-[11px] font-medium transition-colors ${focusRing} ${active ? "border-line-1 bg-surface-card text-ink-700" : "border-transparent bg-track-1 text-ink-300 opacity-65"}`}
              >
                <span className={`h-[7px] w-[7px] rounded-full ${meta.dot}`} aria-hidden />
                <span className="hidden xl:inline">{meta.label}</span>
                <span className="xl:hidden">{meta.short}</span>
              </button>
            );
          })}
        </div>
        <div className="mt-[10px] flex min-w-0 items-center justify-between gap-[8px] border-t border-line-4 pt-[10px]">
          <div className="flex min-w-0 items-center gap-[8px]">
          <label className="flex min-w-0 items-center gap-[8px]">
            <span className="hidden font-mono text-[9.5px] font-semibold uppercase tracking-[0.07em] text-ink-300 sm:inline">
              Plan
            </span>
            <select
              aria-label="Content plan"
              value={activePlanId}
              onChange={(event) => setActivePlanId(event.target.value)}
              className={`h-[32px] min-w-0 max-w-[260px] rounded-[7px] border border-line-1 bg-surface-card px-[9px] text-[11.5px] font-medium text-ink-700 ${focusRing}`}
            >
              <option value="">All planned content</option>
              {plans.map((plan) => (
                <option key={plan.id} value={plan.id}>
                  {plan.name}
                </option>
              ))}
            </select>
          </label>
          {selectedPlan ? (
            <IconButton label={`Manage ${selectedPlan.name}`} onClick={() => openManagePlan(selectedPlan)}>
              <LuSettings2 aria-hidden />
            </IconButton>
          ) : null}
          </div>
          <button
            ref={planButtonRef}
            type="button"
            disabled={!canManagePlans}
            onClick={openPlanEditor}
            className={`flex h-[32px] flex-none items-center gap-[6px] rounded-[7px] border border-line-1 bg-surface-card px-[10px] text-[11.5px] font-semibold text-ink-700 hover:border-plum-border hover:text-plum disabled:cursor-not-allowed disabled:opacity-45 ${focusRing}`}
          >
            <LuListPlus aria-hidden /> New plan
          </button>
        </div>
      </header>

      {mutationError ? (
        <MutationNotice
          message={mutationError.message}
          actionUrl={mutationError.actionUrl}
          onReload={reloadLatest}
          onDismiss={() => setMutationError(null)}
        />
      ) : null}
      <p className="sr-only" aria-live="polite" aria-atomic="true">{dragAnnouncement}</p>

      <div className="min-h-0 min-w-0 flex-1 overflow-y-auto overflow-x-hidden">
        {loadState === "loading" ? <LoadingState /> : null}
        {loadState === "error" ? <ErrorState message={loadError} onRetry={() => setReloadKey((value) => value + 1)} /> : null}
        {loadState === "ready" && posts.length === 0 ? (
          <EmptyState
            onAdd={() => openCreate()}
            onGenerate={() => void generateNextPeriod()}
            period={view}
            canManage={canManagePlans}
          />
        ) : null}
        {loadState === "ready" && posts.length > 0 && filteredPosts.length === 0 ? (
          <FilteredEmptyState
            onClear={() => {
              setEnabledPlatforms(new Set(ORGANIC_PLATFORMS));
              setActivePlanId("");
            }}
          />
        ) : null}

        {loadState === "ready" && filteredPosts.length > 0 ? (
          <>
            <div className="hidden min-w-0 p-[16px] lg:block lg:p-[20px]">
              <div className="grid grid-cols-7 border-l border-t border-line-2 bg-surface-card">
                {range.days.slice(0, 7).map((day) => (
                  <div key={`header-${day}`} className="border-b border-r border-line-2 px-[9px] py-[8px] text-center">
                    <span className="font-mono text-[9.5px] font-semibold uppercase tracking-[0.07em] text-ink-300">
                      {formatCalendarDate(day, locale, { weekday: "short" })}
                    </span>
                  </div>
                ))}
                {range.days.map((day) => {
                  const dayPosts = postsByDay.get(day) ?? [];
                  const maxVisible = view === "month" ? 2 : 3;
                  const currentMonth = isSameCalendarMonth(day, cursor);
                  const today = day === todayKey(timezone);
                  return (
                    <div
                      key={day}
                      data-calendar-day={day}
                      onDragOver={(event) => {
                        const hasPublication = Boolean(draggingId)
                          || event.dataTransfer.types.includes("text/plain");
                        if (!hasPublication) return;
                        event.preventDefault();
                        event.dataTransfer.dropEffect = "move";
                        setDragOverDay(day);
                      }}
                      onDragLeave={(event) => {
                        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
                          setDragOverDay((current) => current === day ? null : current);
                        }
                      }}
                      onDrop={(event) => {
                        event.preventDefault();
                        const publicationId = event.dataTransfer.getData("text/plain") || draggingId;
                        const draggedPost = posts.find((post) => post.publicationId === publicationId);
                        if (draggedPost) void movePostToDate(draggedPost, day);
                        else {
                          setDraggingId(null);
                          setDragOverDay(null);
                        }
                      }}
                      className={`min-w-0 border-b border-r border-line-2 p-[7px] transition-colors ${view === "month" ? "h-[148px]" : "h-[470px]"} ${view === "month" && !currentMonth ? "bg-track-1/55" : "bg-surface-panel/35"} ${dragOverDay === day ? "bg-plum-soft outline outline-2 outline-offset-[-2px] outline-plum" : ""}`}
                    >
                      <div className="mb-[7px] flex h-[27px] items-center justify-between gap-[4px]">
                        <button
                          type="button"
                          disabled={!canManagePlans}
                          onClick={() => openCreate(day)}
                          aria-label={`Add post on ${formatCalendarDate(day, locale, { day: "numeric", month: "long" })}`}
                          className={`flex h-[27px] min-w-[27px] items-center justify-center rounded-[6px] px-[6px] text-[11px] font-semibold ${focusRing} ${today ? "bg-plum text-white" : currentMonth ? "text-ink-700 hover:bg-track-1" : "text-ink-300"}`}
                        >
                          {formatCalendarDate(day, locale, { day: "numeric" })}
                        </button>
                        {dayPosts.length ? <span className="text-[9.5px] text-ink-300">{dayPosts.length}</span> : null}
                      </div>
                      <div className="grid min-w-0 gap-[6px]">
                        {dayPosts.slice(0, maxVisible).map((post) => (
                          <PostCard
                            key={post.publicationId}
                            post={post}
                            timezone={timezone}
                            locale={locale}
                            moving={movingId === post.publicationId}
                            canMove={isEditableStatus(post.status) && canManagePlans}
                            compact={view === "month"}
                            onOpen={() => openEdit(post)}
                            onMove={(days) => void movePost(post, days)}
                            onDragStart={(event) => {
                              event.dataTransfer.effectAllowed = "move";
                              event.dataTransfer.setData("text/plain", post.publicationId);
                              setDraggingId(post.publicationId);
                              setDragAnnouncement(`Moving ${post.title}. Drop it on another calendar day.`);
                            }}
                            onDragEnd={() => {
                              setDraggingId(null);
                              setDragOverDay(null);
                            }}
                          />
                        ))}
                        {dayPosts.length > maxVisible ? (
                          <button
                            type="button"
                            onClick={() => {
                              setMobileDay(day);
                              openEdit(dayPosts[maxVisible]);
                            }}
                            className={`h-[27px] rounded-[6px] text-[10.5px] font-semibold text-plum hover:bg-plum-soft ${focusRing}`}
                          >
                            +{dayPosts.length - maxVisible} more
                          </button>
                        ) : null}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="min-w-0 lg:hidden">
              {view === "month" ? (
                <div
                  className="flex items-center justify-between gap-[10px] border-b border-line-2 bg-surface-panel px-[12px] py-[8px]"
                  aria-label={`Weeks in ${periodLabel}`}
                >
                  <IconButton
                    label="Previous week in month"
                    disabled={mobileWeekIndex === 0}
                    onClick={() => pageMobileMonthWeek(-1)}
                  >
                    <LuChevronLeft aria-hidden />
                  </IconButton>
                  <div className="min-w-0 text-center" aria-live="polite">
                    <p className="m-0 text-[11.5px] font-semibold text-ink-700">
                      Week {mobileWeekIndex + 1} of {mobileWeekCount}
                    </p>
                    <p className="m-0 mt-[1px] truncate text-[10px] text-ink-400">
                      {formatCalendarDate(mobileWeek[0], locale, { day: "numeric", month: "short" })}
                      {" - "}
                      {formatCalendarDate(mobileWeek[6], locale, { day: "numeric", month: "short" })}
                    </p>
                  </div>
                  <IconButton
                    label="Next week in month"
                    disabled={mobileWeekIndex === mobileWeekCount - 1}
                    onClick={() => pageMobileMonthWeek(1)}
                  >
                    <LuChevronRight aria-hidden />
                  </IconButton>
                </div>
              ) : null}
              <div className="grid grid-cols-7 border-b border-line-2 bg-surface-card px-[8px] py-[8px]">
                {mobileWeek.map((day) => {
                  const selected = day === mobileDay;
                  const count = postsByDay.get(day)?.length ?? 0;
                  return (
                    <button
                      key={day}
                      type="button"
                      aria-pressed={selected}
                      aria-label={`${formatCalendarDate(day, locale, { weekday: "long", day: "numeric", month: "long" })}, ${count} planned ${count === 1 ? "post" : "posts"}`}
                      data-mobile-calendar-day={day}
                      onClick={() => setMobileDay(day)}
                      className={`mx-auto grid h-[54px] w-full max-w-[44px] place-items-center rounded-[7px] py-[5px] ${focusRing} ${selected ? "bg-plum text-white" : "text-ink-500"}`}
                    >
                      <span className={`text-[8.5px] font-semibold uppercase ${selected ? "text-white/75" : "text-ink-300"}`}>
                        {formatCalendarDate(day, locale, { weekday: "narrow" })}
                      </span>
                      <span className="text-[12px] font-semibold">{formatCalendarDate(day, locale, { day: "numeric" })}</span>
                      <span className={`h-[4px] w-[4px] rounded-full ${count ? selected ? "bg-white" : "bg-plum" : "bg-transparent"}`} aria-label={count ? `${count} posts` : "No posts"} />
                    </button>
                  );
                })}
              </div>

              <div className="px-[13px] py-[15px]">
                <div className="mb-[12px] flex items-center justify-between gap-[10px]">
                  <div>
                    <p className="m-0 text-[14px] font-semibold text-ink-900">
                      {formatCalendarDate(mobileDay, locale, { weekday: "long", day: "numeric", month: "long" })}
                    </p>
                    <p className="m-0 mt-[2px] text-[11px] text-ink-400">
                      {(postsByDay.get(mobileDay) ?? []).length} planned {(postsByDay.get(mobileDay) ?? []).length === 1 ? "post" : "posts"}
                    </p>
                  </div>
                  <IconButton label="Add post on selected day" disabled={!canManagePlans} onClick={() => openCreate(mobileDay)}><LuPlus aria-hidden /></IconButton>
                </div>
                <div className="grid gap-[8px]">
                  {(postsByDay.get(mobileDay) ?? []).map((post) => (
                    <PostCard
                      key={post.publicationId}
                      post={post}
                      timezone={timezone}
                      locale={locale}
                      moving={movingId === post.publicationId}
                      canMove={isEditableStatus(post.status) && canManagePlans}
                      onOpen={() => openEdit(post)}
                      onMove={(days) => void movePost(post, days)}
                    />
                  ))}
                  {(postsByDay.get(mobileDay) ?? []).length === 0 ? (
                    <button
                      type="button"
                      disabled={!canManagePlans}
                      onClick={() => openCreate(mobileDay)}
                      className={`grid min-h-[132px] place-items-center rounded-[8px] border border-dashed border-line-1 bg-surface-card px-[20px] text-center text-[12px] text-ink-400 disabled:cursor-not-allowed disabled:opacity-55 ${focusRing}`}
                    >
                      <span><LuPlus aria-hidden className="mx-auto mb-[6px] h-[18px] w-[18px] text-plum" />Add a post for this day</span>
                    </button>
                  ) : null}
                </div>
              </div>
            </div>
          </>
        ) : null}
      </div>

      {loadState === "ready" && posts.length > 0 ? (
        <footer className="flex h-[35px] flex-none items-center justify-between border-t border-line-2 bg-surface-card px-[14px] text-[10.5px] text-ink-400 sm:px-[20px]">
          <span>{visibleCount} visible {visibleCount === 1 ? "post" : "posts"}</span>
          <span>{timezone}</span>
        </footer>
      ) : null}

      {editor ? (
        <PostEditor
          state={editor}
          busy={editorBusy}
          canReview={canManagePlans}
          error={editorError}
          conflict={editorConflict}
          onChange={(draft) => setEditor((current) => current ? { ...current, draft } : current)}
          onClose={closeEditor}
          onDuplicate={() => {
            if (editor.post) openDuplicate(editor.post);
          }}
          onDelete={() => void deletePost()}
          onHandoff={() => {
            const publicationId = editor.post?.publicationId;
            if (!publicationId) return;
            setEditor(null);
            setEditorError(null);
            setEditorConflict(false);
            setHandoffPublicationId(publicationId);
          }}
          onReloadLatest={reloadLatest}
          onSubmit={(event) => void saveEditor(event)}
        />
      ) : null}
      {handoffPublicationId ? (
        <AssistedHandoffDialog
          publicationId={handoffPublicationId}
          fetcher={request}
          onClose={closeHandoff}
          onUpdated={updateHandoffPublication}
          onReviewContent={(contentItemId) => {
            setStudioInitialContentId(contentItemId);
            setSurface("studio");
          }}
        />
      ) : null}
      {planDraft ? (
        <PlanEditor
          draft={planDraft}
          rangeLabel={planRangeLabel}
          busy={planBusy}
          canManage={canManagePlans}
          conflict={planConflict}
          error={planError}
          onChange={setPlanDraft}
          onClose={closePlanEditor}
          onDelete={() => void deletePlan()}
          onReloadLatest={reloadLatest}
          onSubmit={(event) => void savePlan(event)}
        />
      ) : null}
    </section>
  );
}
