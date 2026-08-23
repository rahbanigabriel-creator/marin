"use client";

import {
  type FormEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  LuCheck,
  LuArrowRight,
  LuCircleAlert,
  LuClipboard,
  LuClock3,
  LuDownload,
  LuExternalLink,
  LuFileDown,
  LuLink,
  LuRefreshCw,
  LuRotateCcw,
  LuX,
} from "react-icons/lu";

import type {
  AssistedHandoffCapabilityReasonCode,
  AssistedHandoffCompletionEvidence,
} from "@/lib/content/types";

const focusRing =
  "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-plum";

const focusableSelector = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "textarea:not([disabled])",
  '[tabindex]:not([tabindex="-1"])',
].join(",");

const PLATFORM_LABELS: Record<string, string> = {
  youtube: "YouTube",
  instagram: "Instagram",
  facebook: "Facebook",
  tiktok: "TikTok",
  snapchat: "Snapchat",
  reddit: "Reddit",
  pinterest: "Pinterest",
};

export interface AssistedHandoffPublication {
  id: string;
  contentItemId: string;
  platform: string;
  format: string;
  status: string;
  contentVersion: number;
  publishedAt: string | null;
  permalink: string | null;
  externalCompletionEvidence: AssistedHandoffCompletionEvidence;
  publishAttempts: number;
  lastError: string | null;
}

export interface AssistedHandoffCopy {
  title: string | null;
  body: string;
  firstComment: string | null;
  linkUrl: string | null;
}

export interface AssistedHandoffAsset {
  id: string;
  position: number;
  role: string;
  altText: string | null;
  filename: string;
  mimeType: string;
  bytes: number;
  downloadUrl: string;
}

export interface AssistedHandoffCapability {
  level: "assisted";
  openPlatformUrl: string | null;
  canPrepare: boolean;
  canRecord: boolean;
  reasonCode: AssistedHandoffCapabilityReasonCode | null;
  reason: string | null;
}

export interface AssistedHandoffAttempt {
  id: string;
  outcome: "completed" | "failed";
  contentVersion: number;
  permalink: string | null;
  error: string | null;
  attemptedAt: string;
}

export interface AssistedHandoffResponse {
  publication: AssistedHandoffPublication;
  copy: AssistedHandoffCopy;
  assets: AssistedHandoffAsset[];
  capability: AssistedHandoffCapability;
  attempts: AssistedHandoffAttempt[];
}

export interface AssistedHandoffMutationResponse {
  handoff: AssistedHandoffResponse;
  reused: boolean;
}

export interface AssistedHandoffDialogProps {
  publicationId: string;
  fetcher?: typeof fetch;
  onClose: () => void;
  onUpdated?: (publication: AssistedHandoffPublication) => void;
  onReviewContent?: (contentItemId: string) => void;
}

interface ApiErrorPayload {
  error?: string;
  code?: string;
  message?: string;
  reason?: string;
}

class HandoffRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
  ) {
    super(message);
    this.name = "HandoffRequestError";
  }
}

type ActionMode = "none" | "complete" | "failure";
type Outcome = "completed" | "failed";

function newRequestId(): string {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `handoff_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 14)}`;
}

export function externalCompletionLabel(evidence: AssistedHandoffCompletionEvidence): string | null {
  if (evidence === "user_confirmed_external_handoff") return "User-confirmed external handoff";
  if (evidence === "unverified_external_completion") return "Unverified external completion";
  return null;
}

function statusCopy(status: string, evidence: AssistedHandoffCompletionEvidence): string {
  if (status === "ready") return "Ready to finish externally";
  if (status === "failed") return "Needs another try";
  if (status === "published") return externalCompletionLabel(evidence) ?? "External completion recorded";
  return "History only";
}

function platformLabel(platform: string): string {
  return PLATFORM_LABELS[platform.toLowerCase()] ?? platform;
}

function bytesLabel(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "File";
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function safeExternalUrl(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (
      url.protocol !== "https:"
      || url.username
      || url.password
      || url.port
      || url.hash
    ) return null;
    return url.toString();
  } catch {
    return null;
  }
}

function safeDownloadUrl(value: string): string | null {
  if (!value || typeof window === "undefined") return null;
  try {
    const url = new URL(value, window.location.origin);
    if (url.origin !== window.location.origin) return null;
    if (!url.pathname.startsWith("/api/assets/") || !url.pathname.endsWith("/content")) return null;
    return `${url.pathname}${url.search}`;
  } catch {
    return null;
  }
}

function dateLabel(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Unknown time";
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function errorMessage(status: number, payload: ApiErrorPayload): string {
  if (payload.message) return payload.message;
  if (payload.reason) return payload.reason;
  if (status === 401) return "Your session expired. Sign in again to continue.";
  if (status === 403) return "You do not have permission to record this handoff.";
  if (status === 404) return "This handoff is no longer available.";
  if (status === 409) return "This content changed elsewhere. Reload the latest version.";
  if (status === 422) return "Check the details and try again.";
  return `The handoff request failed (${status}). Please try again.`;
}

async function responseJson<T>(response: Response): Promise<T> {
  const payload = (await response.json().catch(() => ({}))) as T & ApiErrorPayload;
  if (!response.ok) {
    throw new HandoffRequestError(
      errorMessage(response.status, payload),
      response.status,
      payload.code ?? payload.error,
    );
  }
  return payload;
}

function mutationHandoff(payload: AssistedHandoffMutationResponse | (AssistedHandoffResponse & { reused?: boolean })): AssistedHandoffResponse {
  return "handoff" in payload ? payload.handoff : payload;
}

function CopyRow({
  label,
  value,
  onCopy,
}: {
  label: string;
  value: string | null;
  onCopy: (label: string, value: string) => void;
}) {
  return (
    <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-start gap-[12px] border-b border-line-2 py-[11px] last:border-b-0">
      <div className="min-w-0">
        <p className="m-0 text-[11px] font-semibold text-ink-500">{label}</p>
        <p className="mb-0 mt-[3px] max-h-[78px] overflow-y-auto whitespace-pre-wrap break-words text-[12.5px] leading-[1.5] text-ink-700">
          {value || <span className="text-ink-300">Not added</span>}
        </p>
      </div>
      <button
        type="button"
        disabled={!value}
        onClick={() => {
          if (value) onCopy(label, value);
        }}
        className={`flex h-[32px] items-center gap-[6px] rounded-[7px] border border-line-1 bg-surface-card px-[9px] text-[11px] font-semibold text-ink-600 transition-colors hover:border-plum-border hover:text-plum disabled:cursor-not-allowed disabled:opacity-40 ${focusRing}`}
      >
        <LuClipboard aria-hidden className="h-[13px] w-[13px]" />
        Copy {label.toLowerCase()}
      </button>
    </div>
  );
}

export function HandoffApprovalRecoveryAction({
  contentItemId,
  publicationStatus,
  reasonCode,
  onReviewContent,
  onClose,
}: {
  contentItemId: string;
  publicationStatus: string;
  reasonCode: AssistedHandoffCapabilityReasonCode | null;
  onReviewContent?: (contentItemId: string) => void;
  onClose: () => void;
}) {
  if (
    !onReviewContent
    || publicationStatus !== "ready"
    || reasonCode !== "content_version_not_approved"
  ) {
    return null;
  }

  return (
    <button
      type="button"
      aria-describedby="assisted-handoff-blocked-reason"
      onClick={() => {
        onReviewContent(contentItemId);
        onClose();
      }}
      className={`mt-[9px] inline-flex min-h-[36px] items-center gap-[7px] rounded-[7px] border border-plum-border bg-surface-card px-[11px] py-[7px] text-left text-[12px] font-semibold text-plum-deep transition-colors hover:bg-plum-soft ${focusRing}`}
    >
      Review and approve in Studio
      <LuArrowRight aria-hidden className="h-[14px] w-[14px] flex-none" />
    </button>
  );
}

export function AssistedHandoffDialog({
  publicationId,
  fetcher = globalThis.fetch,
  onClose,
  onUpdated,
  onReviewContent,
}: AssistedHandoffDialogProps) {
  const dialogRef = useRef<HTMLElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const requestRef = useRef<{ outcome: Outcome; id: string } | null>(null);
  const busyRef = useRef(false);
  const onCloseRef = useRef(onClose);
  const [handoff, setHandoff] = useState<AssistedHandoffResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<HandoffRequestError | null>(null);
  const [actionMode, setActionMode] = useState<ActionMode>("none");
  const [permalink, setPermalink] = useState("");
  const [failureReason, setFailureReason] = useState("");
  const [announcement, setAnnouncement] = useState("");

  busyRef.current = busy;
  onCloseRef.current = onClose;

  const endpoint = `/api/publications/${encodeURIComponent(publicationId)}/assisted-handoff`;

  const load = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetcher(endpoint, {
        method: "GET",
        credentials: "same-origin",
        headers: { Accept: "application/json" },
        signal,
      });
      const payload = await responseJson<AssistedHandoffResponse>(response);
      setHandoff(payload);
      setPermalink(payload.publication.permalink ?? "");
    } catch (cause) {
      if (cause instanceof DOMException && cause.name === "AbortError") return;
      setError(cause instanceof HandoffRequestError
        ? cause
        : new HandoffRequestError("Could not load this handoff. Check your connection and try again.", 0));
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, [endpoint, fetcher]);

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  useEffect(() => {
    const previousFocus = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const frame = window.requestAnimationFrame(() => closeButtonRef.current?.focus());

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busyRef.current) {
        event.preventDefault();
        onCloseRef.current();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      window.cancelAnimationFrame(frame);
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
      previousFocus?.focus();
    };
  }, []);

  const assets = useMemo(
    () => [...(handoff?.assets ?? [])].sort((a, b) => a.position - b.position || a.id.localeCompare(b.id)),
    [handoff?.assets],
  );
  const attempts = useMemo(
    () => [...(handoff?.attempts ?? [])].sort((a, b) => {
      const time = new Date(b.attemptedAt).getTime() - new Date(a.attemptedAt).getTime();
      return time || b.id.localeCompare(a.id);
    }),
    [handoff?.attempts],
  );

  const platform = handoff ? platformLabel(handoff.publication.platform) : "platform";
  const safePlatformUrl = safeExternalUrl(handoff?.capability.openPlatformUrl);
  const preparable = handoff?.capability.canPrepare === true;
  const recordable = Boolean(
    handoff?.capability.canRecord
    && (handoff.publication.status === "ready" || handoff.publication.status === "failed"),
  );

  const trapFocus = (event: ReactKeyboardEvent<HTMLElement>) => {
    if (event.key !== "Tab") return;
    const focusable = [...(dialogRef.current?.querySelectorAll<HTMLElement>(focusableSelector) ?? [])]
      .filter((element) => element.offsetParent !== null);
    if (!focusable.length) {
      event.preventDefault();
      dialogRef.current?.focus();
      return;
    }
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

  const setMode = (mode: ActionMode) => {
    const nextOutcome = mode === "complete" ? "completed" : mode === "failure" ? "failed" : null;
    if (nextOutcome && requestRef.current?.outcome !== nextOutcome) requestRef.current = null;
    setActionMode(mode);
    setError(null);
    setAnnouncement("");
  };

  const copyText = async (label: string, value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setAnnouncement(`${label} copied.`);
    } catch {
      setAnnouncement(`${label} could not be copied. Select the text and copy it manually.`);
    }
  };

  const downloadAll = () => {
    const urls = assets.flatMap((asset) => {
      const url = safeDownloadUrl(asset.downloadUrl);
      return url ? [url] : [];
    });
    urls.forEach((url) => {
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = "";
      anchor.hidden = true;
      document.body.appendChild(anchor);
      anchor.click();
      window.setTimeout(() => anchor.remove(), 1_000);
    });
    setAnnouncement(urls.length
      ? `${urls.length} media ${urls.length === 1 ? "download" : "downloads"} started.`
      : "No downloadable media is available.");
  };

  const recordOutcome = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!handoff || !recordable || actionMode === "none") return;

    const outcome: Outcome = actionMode === "complete" ? "completed" : "failed";
    const requestId = requestRef.current?.outcome === outcome
      ? requestRef.current.id
      : newRequestId();
    requestRef.current = { outcome, id: requestId };
    setBusy(true);
    setError(null);
    setAnnouncement("");
    try {
      const response = await fetcher(endpoint, {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({
          requestId,
          expectedContentVersion: handoff.publication.contentVersion,
          outcome,
          ...(outcome === "completed" ? { permalink: permalink.trim() } : {}),
          ...(outcome === "failed" ? { failureReason: failureReason.trim() } : {}),
        }),
      });
      const payload = await responseJson<
        AssistedHandoffMutationResponse | (AssistedHandoffResponse & { reused?: boolean })
      >(response);
      const next = mutationHandoff(payload);
      requestRef.current = null;
      setHandoff(next);
      setPermalink(next.publication.permalink ?? "");
      setFailureReason("");
      setActionMode("none");
      setAnnouncement(outcome === "completed"
        ? "User-confirmed external handoff recorded. Provider confirmation is unavailable."
        : "The unsuccessful attempt was recorded.");
      onUpdated?.(next.publication);
    } catch (cause) {
      const requestError = cause instanceof HandoffRequestError
        ? cause
        : new HandoffRequestError("The result is not confirmed yet. Retry to safely check the same request.", 0);
      if (requestError.code === "idempotency_conflict") requestRef.current = null;
      setError(requestError);
    } finally {
      setBusy(false);
    }
  };

  const fieldClass = `w-full rounded-[7px] border border-line-1 bg-surface-card px-[10px] py-[9px] text-[13px] text-ink-900 outline-none placeholder:text-ink-300 focus:border-plum-border disabled:cursor-not-allowed disabled:opacity-50 ${focusRing}`;

  return (
    <div
      className="fixed inset-0 z-[100] flex items-end justify-center overflow-hidden bg-black/25 p-0 sm:items-center sm:p-[20px]"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !busy) onClose();
      }}
    >
      <section
        ref={dialogRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby="assisted-handoff-title"
        aria-describedby="assisted-handoff-status"
        aria-busy={busy}
        onKeyDown={trapFocus}
        className="flex max-h-[96dvh] w-full min-w-0 flex-col overflow-hidden rounded-t-[8px] border border-line-1 bg-surface-panel shadow-modal sm:max-h-[90dvh] sm:max-w-[720px] sm:rounded-[8px]"
      >
        <header className="flex flex-none items-center justify-between gap-[14px] border-b border-line-2 bg-surface-panel px-[16px] py-[13px] sm:px-[18px]">
          <div className="min-w-0">
            <p className="m-0 truncate font-mono text-[9.5px] font-semibold uppercase tracking-[0.08em] text-ink-300">
              {handoff ? `${platform} · ${handoff.publication.format}` : "Organic workflow"}
            </p>
            <h2 id="assisted-handoff-title" className="mb-0 mt-[2px] text-[17px] font-semibold text-ink-900">
              Assisted handoff
            </h2>
          </div>
          <button
            ref={closeButtonRef}
            type="button"
            aria-label="Close assisted handoff"
            title="Close"
            disabled={busy}
            onClick={onClose}
            className={`flex h-[34px] w-[34px] flex-none items-center justify-center rounded-[7px] border border-line-1 bg-surface-card text-ink-500 transition-colors hover:border-plum-border hover:text-plum disabled:cursor-not-allowed disabled:opacity-40 ${focusRing}`}
          >
            <LuX aria-hidden className="h-[16px] w-[16px]" />
          </button>
        </header>

        <form onSubmit={recordOutcome} className="flex min-h-0 flex-1 flex-col">
          <div className="min-h-0 min-w-0 flex-1 overflow-x-hidden overflow-y-auto px-[16px] py-[15px] sm:px-[18px] sm:py-[17px]">
            {loading ? (
              <div className="grid min-h-[320px] place-items-center" role="status">
                <div className="text-center">
                  <LuRefreshCw aria-hidden className="mx-auto h-[21px] w-[21px] animate-spin text-plum" />
                  <p className="mb-0 mt-[9px] text-[12.5px] text-ink-400">Loading handoff</p>
                </div>
              </div>
            ) : error && !handoff ? (
              <div className="grid min-h-[320px] place-items-center text-center">
                <div className="max-w-[390px]">
                  <LuCircleAlert aria-hidden className="mx-auto h-[24px] w-[24px] text-neg-700" />
                  <h3 className="mb-0 mt-[10px] text-[15px] font-semibold text-ink-900">Handoff unavailable</h3>
                  <p role="alert" className="mb-0 mt-[5px] text-[12.5px] leading-[1.5] text-ink-500">{error.message}</p>
                  <button
                    type="button"
                    onClick={() => void load()}
                    className={`mt-[14px] inline-flex h-[36px] items-center gap-[7px] rounded-[7px] bg-plum px-[13px] text-[12px] font-semibold text-white ${focusRing}`}
                  >
                    <LuRefreshCw aria-hidden /> Retry
                  </button>
                </div>
              </div>
            ) : handoff ? (
              <div className="grid min-w-0 gap-[20px]">
                <div className="flex min-w-0 items-start gap-[10px] border-b border-line-2 pb-[15px]">
                  <span className={`mt-[1px] flex h-[29px] w-[29px] flex-none items-center justify-center rounded-[7px] ${handoff.publication.status === "published" ? "bg-pos-bg text-pos-700" : handoff.publication.status === "failed" ? "bg-neg-bg text-neg-700" : "bg-plum-soft text-plum"}`}>
                    {handoff.publication.status === "published"
                      ? <LuCheck aria-hidden />
                      : handoff.publication.status === "failed"
                        ? <LuRotateCcw aria-hidden />
                        : <LuExternalLink aria-hidden />}
                  </span>
                  <div className="min-w-0">
                    <p id="assisted-handoff-status" className="m-0 text-[13px] font-semibold text-ink-900">
                      {statusCopy(handoff.publication.status, handoff.publication.externalCompletionEvidence)}
                    </p>
                    <p className="mb-0 mt-[2px] break-words text-[11.5px] text-ink-400">
                      {handoff.publication.status === "published" && handoff.publication.publishedAt
                        ? `${dateLabel(handoff.publication.publishedAt)} · provider confirmation unavailable`
                        : handoff.publication.status === "failed" && handoff.publication.lastError
                          ? handoff.publication.lastError
                          : `${platform} · ${handoff.publication.format}`}
                    </p>
                  </div>
                </div>

                {preparable ? <section aria-labelledby="handoff-copy-title" className="min-w-0">
                  <div className="flex items-center justify-between gap-[10px]">
                    <h3 id="handoff-copy-title" className="m-0 text-[14px] font-semibold text-ink-900">Post copy</h3>
                    <LuClipboard aria-hidden className="h-[15px] w-[15px] text-ink-300" />
                  </div>
                  <div className="mt-[6px] border-y border-line-2">
                    <CopyRow label="Title" value={handoff.copy.title} onCopy={(label, value) => void copyText(label, value)} />
                    <CopyRow label="Body" value={handoff.copy.body} onCopy={(label, value) => void copyText(label, value)} />
                    <CopyRow label="First comment" value={handoff.copy.firstComment} onCopy={(label, value) => void copyText(label, value)} />
                    <CopyRow label="Link" value={handoff.copy.linkUrl} onCopy={(label, value) => void copyText(label, value)} />
                  </div>
                </section> : null}

                {preparable ? <section aria-labelledby="handoff-media-title" className="min-w-0">
                  <div className="flex flex-wrap items-center justify-between gap-[8px]">
                    <h3 id="handoff-media-title" className="m-0 text-[14px] font-semibold text-ink-900">Media</h3>
                    {assets.length ? (
                      <button
                        type="button"
                        onClick={downloadAll}
                        className={`flex h-[32px] items-center gap-[6px] rounded-[7px] border border-line-1 bg-surface-card px-[9px] text-[11px] font-semibold text-ink-600 hover:border-plum-border hover:text-plum ${focusRing}`}
                      >
                        <LuDownload aria-hidden /> Download all media
                      </button>
                    ) : null}
                  </div>
                  {assets.length ? (
                    <ul className="m-0 mt-[7px] list-none border-y border-line-2 p-0">
                      {assets.map((asset) => {
                        const downloadUrl = safeDownloadUrl(asset.downloadUrl);
                        return (
                          <li key={asset.id} className="flex min-w-0 items-center gap-[10px] border-b border-line-2 py-[10px] last:border-b-0">
                            <span className="flex h-[31px] w-[31px] flex-none items-center justify-center rounded-[7px] bg-track-1 text-ink-400">
                              <LuFileDown aria-hidden />
                            </span>
                            <span className="min-w-0 flex-1">
                              <span className="block truncate text-[12px] font-semibold text-ink-700">{asset.filename || "Media file"}</span>
                              <span className="mt-[1px] block truncate text-[10.5px] text-ink-400">{asset.role} · {bytesLabel(asset.bytes)}</span>
                            </span>
                            {downloadUrl ? (
                              <a
                                href={downloadUrl}
                                download
                                className={`flex h-[32px] flex-none items-center gap-[5px] rounded-[7px] border border-line-1 bg-surface-card px-[9px] text-[11px] font-semibold text-ink-600 hover:border-plum-border hover:text-plum ${focusRing}`}
                              >
                                <LuDownload aria-hidden /> Download
                              </a>
                            ) : (
                              <span className="text-[10.5px] text-ink-300">Unavailable</span>
                            )}
                          </li>
                        );
                      })}
                    </ul>
                  ) : (
                    <p className="mb-0 mt-[7px] border-y border-line-2 py-[13px] text-[12px] text-ink-400">No media attached.</p>
                  )}
                </section> : null}

                {preparable && safePlatformUrl ? (
                  <a
                    href={safePlatformUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className={`flex h-[40px] w-full items-center justify-center gap-[7px] rounded-[7px] border border-line-1 bg-surface-card px-[14px] text-[12.5px] font-semibold text-ink-700 transition-colors hover:border-plum-border hover:text-plum ${focusRing}`}
                  >
                    Open {platform} <LuExternalLink aria-hidden />
                  </a>
                ) : null}

                {recordable && actionMode === "complete" ? (
                  <section aria-labelledby="handoff-complete-title" className="border-t border-line-2 pt-[15px]">
                    <h3 id="handoff-complete-title" className="m-0 text-[14px] font-semibold text-ink-900">Mark complete</h3>
                    <label className="mt-[9px] grid gap-[5px]">
                      <span className="text-[11px] font-semibold text-ink-500">Public post URL</span>
                      <span className="relative block">
                        <LuLink aria-hidden className="pointer-events-none absolute left-[10px] top-1/2 h-[14px] w-[14px] -translate-y-1/2 text-ink-300" />
                        <input
                          autoFocus
                          required
                          type="url"
                          inputMode="url"
                          disabled={busy}
                          value={permalink}
                          onChange={(event) => setPermalink(event.target.value)}
                          placeholder={`https://${handoff.publication.platform}.com/...`}
                          className={`${fieldClass} pl-[32px]`}
                        />
                      </span>
                    </label>
                  </section>
                ) : null}

                {recordable && actionMode === "failure" ? (
                  <section aria-labelledby="handoff-failure-title" className="border-t border-line-2 pt-[15px]">
                    <div className="flex items-center justify-between gap-[10px]">
                      <h3 id="handoff-failure-title" className="m-0 text-[14px] font-semibold text-ink-900">Record failure</h3>
                      <span className="text-[10.5px] text-ink-400">{failureReason.length}/1000</span>
                    </div>
                    <label className="mt-[9px] grid gap-[5px]">
                      <span className="text-[11px] font-semibold text-ink-500">What stopped you?</span>
                      <textarea
                        autoFocus
                        required
                        rows={4}
                        maxLength={1000}
                        disabled={busy}
                        value={failureReason}
                        onChange={(event) => setFailureReason(event.target.value)}
                        className={`${fieldClass} min-h-[96px] resize-y`}
                      />
                    </label>
                  </section>
                ) : null}

                {error ? (
                  <div role="alert" className="flex min-w-0 items-start justify-between gap-[8px] rounded-[7px] bg-neg-bg px-[11px] py-[9px] text-[12px] text-neg-700">
                    <span className="flex min-w-0 items-start gap-[8px]"><LuCircleAlert aria-hidden className="mt-[1px] flex-none" /><span className="min-w-0 break-words">{error.message}</span></span>
                    {error.status === 409 ? <button type="button" disabled={busy} onClick={() => void load()} className={`h-[28px] flex-none rounded-[6px] border border-neg-700/20 bg-surface-card px-[8px] text-[10.5px] font-semibold ${focusRing}`}>Reload latest</button> : null}
                  </div>
                ) : null}

                {!handoff.capability.canRecord && handoff.capability.reason ? (
                  <div className="rounded-[7px] bg-track-1 px-[11px] py-[9px] text-[12px] text-ink-500">
                    <p id="assisted-handoff-blocked-reason" className="m-0">
                      {handoff.capability.reason}
                    </p>
                    <HandoffApprovalRecoveryAction
                      contentItemId={handoff.publication.contentItemId}
                      publicationStatus={handoff.publication.status}
                      reasonCode={handoff.capability.reasonCode}
                      onReviewContent={onReviewContent}
                      onClose={onClose}
                    />
                  </div>
                ) : null}

                <section aria-labelledby="handoff-history-title" className="min-w-0">
                  <div className="flex items-center justify-between gap-[10px]">
                    <h3 id="handoff-history-title" className="m-0 text-[14px] font-semibold text-ink-900">Attempt history</h3>
                    <LuClock3 aria-hidden className="h-[15px] w-[15px] text-ink-300" />
                  </div>
                  {attempts.length ? (
                    <ol className="m-0 mt-[7px] list-none border-y border-line-2 p-0">
                      {attempts.map((attempt) => {
                        const attemptUrl = safeExternalUrl(attempt.permalink);
                        return (
                          <li key={attempt.id} className="grid min-w-0 grid-cols-[auto_minmax(0,1fr)] gap-[9px] border-b border-line-2 py-[10px] last:border-b-0">
                            <span className={`mt-[2px] h-[7px] w-[7px] rounded-full ${attempt.outcome === "completed" ? "bg-pos-500" : "bg-neg-500"}`} />
                            <div className="min-w-0">
                              <div className="flex min-w-0 flex-wrap items-center justify-between gap-x-[10px] gap-y-[2px]">
                                <span className="text-[12px] font-semibold text-ink-700">
                                  {attempt.outcome === "completed" ? "User-confirmed external handoff" : "Could not complete"}
                                </span>
                                <time dateTime={attempt.attemptedAt} className="text-[10.5px] text-ink-400">{dateLabel(attempt.attemptedAt)}</time>
                              </div>
                              {attempt.error ? <p className="mb-0 mt-[3px] break-words text-[11.5px] text-neg-700">{attempt.error}</p> : null}
                              {attemptUrl ? (
                                <a href={attemptUrl} target="_blank" rel="noopener noreferrer" className={`mt-[3px] inline-flex max-w-full items-center gap-[4px] break-all text-[11.5px] font-semibold text-plum hover:underline ${focusRing}`}>
                                  View external post <LuExternalLink aria-hidden className="flex-none" />
                                </a>
                              ) : null}
                            </div>
                          </li>
                        );
                      })}
                    </ol>
                  ) : (
                    <p className="mb-0 mt-[7px] border-y border-line-2 py-[13px] text-[12px] text-ink-400">No attempts recorded yet.</p>
                  )}
                </section>
              </div>
            ) : null}
          </div>

          <footer className="sticky bottom-0 flex flex-none flex-wrap items-center justify-between gap-[8px] border-t border-line-2 bg-surface-panel px-[16px] py-[12px] sm:px-[18px]">
            <span className="min-w-0 text-[10.5px] text-ink-400">
              {handoff ? statusCopy(handoff.publication.status, handoff.publication.externalCompletionEvidence) : null}
            </span>
            <span className="ml-auto flex min-w-0 flex-wrap items-center justify-end gap-[8px]">
              {recordable && actionMode === "none" ? (
                <>
                  <button type="button" disabled={busy} onClick={() => setMode("failure")} className={`h-[36px] rounded-[7px] border border-line-1 bg-surface-card px-[12px] text-[12px] font-semibold text-ink-600 disabled:opacity-40 ${focusRing}`}>
                    Record failure
                  </button>
                  <button type="button" disabled={busy} onClick={() => setMode("complete")} className={`flex h-[36px] items-center gap-[7px] rounded-[7px] bg-plum px-[13px] text-[12px] font-semibold text-white disabled:opacity-40 ${focusRing}`}>
                    {handoff?.publication.status === "failed" ? <LuRotateCcw aria-hidden /> : <LuCheck aria-hidden />}
                    {handoff?.publication.status === "failed" ? "Try again" : "Mark complete"}
                  </button>
                </>
              ) : recordable && actionMode !== "none" ? (
                <>
                  <button type="button" disabled={busy} onClick={() => setMode("none")} className={`h-[36px] rounded-[7px] border border-line-1 bg-surface-card px-[12px] text-[12px] font-semibold text-ink-600 disabled:opacity-40 ${focusRing}`}>
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={busy || (actionMode === "complete" ? !permalink.trim() : !failureReason.trim())}
                    className={`flex h-[36px] items-center gap-[7px] rounded-[7px] bg-plum px-[13px] text-[12px] font-semibold text-white disabled:cursor-not-allowed disabled:opacity-45 ${focusRing}`}
                  >
                    {busy ? <LuRefreshCw aria-hidden className="animate-spin" /> : actionMode === "complete" ? <LuCheck aria-hidden /> : <LuCircleAlert aria-hidden />}
                    {busy ? "Recording…" : actionMode === "complete" ? "Confirm complete" : "Confirm failure"}
                  </button>
                </>
              ) : (
                <button type="button" disabled={busy} onClick={onClose} className={`h-[36px] rounded-[7px] border border-line-1 bg-surface-card px-[13px] text-[12px] font-semibold text-ink-600 disabled:opacity-40 ${focusRing}`}>
                  Close
                </button>
              )}
            </span>
          </footer>
        </form>

        <p className="sr-only" aria-live="polite" aria-atomic="true">{announcement}</p>
      </section>
    </div>
  );
}

export default AssistedHandoffDialog;
