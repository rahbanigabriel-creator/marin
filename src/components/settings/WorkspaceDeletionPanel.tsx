"use client";

import { useEffect, useId, useRef, useState } from "react";
import {
  LuCircleAlert,
  LuClock3,
  LuRefreshCw,
  LuShieldAlert,
  LuTrash2,
  LuX,
} from "react-icons/lu";

import type { DeletionRequestView } from "@/lib/privacy/deletion/types";

import {
  WorkspaceDeletionClientError,
  createWorkspaceDeletion,
  loadWorkspaceDeletion,
  loadWorkspaceDeletionPreparation,
  newDeletionRequestId,
  retryWorkspaceDeletion,
  type WorkspaceDeletionPreparation,
} from "./workspace-deletion-client";

const focusRing =
  "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-plum";

const TERMINAL = new Set<DeletionRequestView["status"]>([
  "completed",
  "completed_with_warnings",
]);

const STATUS_COPY: Record<DeletionRequestView["status"], { label: string; detail: string }> = {
  queued: {
    label: "Queued",
    detail: "The request is saved and waiting for the deletion worker.",
  },
  processing: {
    label: "Deleting workspace",
    detail: "Marpin is cancelling active work and removing workspace data.",
  },
  needs_attention: {
    label: "Needs attention",
    detail: "A required external cleanup did not complete. No final deletion was claimed.",
  },
  completed: {
    label: "Deletion complete",
    detail: "The workspace data was removed and required cleanup completed.",
  },
  completed_with_warnings: {
    label: "Deleted with follow-up needed",
    detail: "The workspace was removed, but one or more external providers could not confirm cleanup.",
  },
};

function providerSummary(deletion: DeletionRequestView): string {
  if (!deletion.providerOutcomes.length) return "No supported remote grant required revocation";
  const failed = deletion.providerOutcomes.filter((outcome) => outcome.status !== "confirmed");
  if (!failed.length) return "Supported remote grants revoked";
  return `${failed.map((outcome) => outcome.provider === "google" ? "Google" : "Meta").join(" and ")} needs manual review`;
}

function prerequisiteLabel(status: DeletionRequestView["stripeStatus"]): string {
  switch (status) {
    case "confirmed": return "Complete";
    case "not_applicable": return "Not needed";
    case "failed": return "Failed safely";
    case "unavailable": return "Unavailable";
    default: return "Pending";
  }
}

function warningLabel(code: string): string {
  if (code.startsWith("google_")) return "Google could not confirm remote access revocation. Remove Marpin from your Google Account connections.";
  if (code.startsWith("meta_")) return "Meta could not confirm remote access revocation. Remove Marpin from Meta Business integrations.";
  if (code.includes("clerk")) return "The workspace is deleted, but the sign-in identity may still require support follow-up.";
  return "An external cleanup step needs support follow-up.";
}

function DeleteConfirmationDialog({
  phrase,
  open,
  busy,
  error,
  onClose,
  onConfirm,
}: {
  phrase: string;
  open: boolean;
  busy: boolean;
  error: string | null;
  onClose: () => void;
  onConfirm: (confirmation: string) => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const descriptionId = useId();
  const [confirmation, setConfirmation] = useState("");

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      setConfirmation("");
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
        else onClose();
      }}
      onClose={() => {
        if (open && !busy) onClose();
      }}
      className="m-auto w-[min(540px,calc(100vw-32px))] rounded-[8px] border border-line-1 bg-surface-card p-0 text-ink-900 shadow-modal backdrop:bg-black/35"
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (!busy && confirmation === phrase) onConfirm(confirmation);
        }}
      >
        <div className="flex items-start justify-between gap-4 border-b border-line-3 px-5 py-4">
          <div>
            <h3 id={titleId} className="m-0 text-[18px] font-semibold">Delete this workspace</h3>
            <p id={descriptionId} className="mb-0 mt-1 text-[12.5px] leading-5 text-ink-400">
              This permanently removes audit context, conversations, plans, drafts, reports, assets, and connected-account tokens.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            aria-label="Close deletion confirmation"
            title="Close"
            className={`grid h-9 w-9 flex-none place-items-center rounded-[7px] border border-line-2 bg-transparent text-ink-500 disabled:opacity-50 ${focusRing}`}
          >
            <LuX aria-hidden />
          </button>
        </div>

        <div className="px-5 py-5">
          <div className="flex gap-3 border-l-[3px] border-neg-700 bg-neg-bg px-3 py-3 text-[12.5px] leading-5 text-neg-700">
            <LuShieldAlert aria-hidden className="mt-0.5 flex-none" />
            <p className="m-0">This cannot be undone. Active work is stopped first; paid subscriptions, files, and provider access must be settled before the database is removed.</p>
          </div>
          <label className="mt-5 block text-[12.5px] font-semibold text-ink-700" htmlFor={`${titleId}-confirmation`}>
            Type <code className="rounded-[4px] bg-track-1 px-1.5 py-0.5 font-mono text-[11.5px] text-ink-900">{phrase}</code> to confirm
          </label>
          <input
            id={`${titleId}-confirmation`}
            value={confirmation}
            onChange={(event) => setConfirmation(event.target.value)}
            autoComplete="off"
            spellCheck={false}
            autoFocus
            disabled={busy}
            className={`mt-2 h-10 w-full rounded-[7px] border border-line-1 bg-white px-3 font-mono text-[12px] text-ink-900 outline-none focus:border-neg-700 ${focusRing}`}
          />
          {error ? <p role="alert" className="mb-0 mt-3 text-[12px] text-neg-700">{error}</p> : null}
        </div>

        <div className="flex justify-end gap-2 border-t border-line-3 px-5 py-4">
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className={`h-10 rounded-[7px] border border-line-2 bg-transparent px-4 text-[12.5px] font-semibold text-ink-600 disabled:opacity-50 ${focusRing}`}
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={busy || confirmation !== phrase}
            className={`h-10 rounded-[7px] border-none bg-neg-700 px-4 text-[12.5px] font-semibold text-white disabled:cursor-not-allowed disabled:opacity-45 ${focusRing}`}
          >
            {busy ? "Saving request..." : "Permanently delete workspace"}
          </button>
        </div>
      </form>
    </dialog>
  );
}

export function WorkspaceDeletionPanel({
  onDeletionLockChange,
}: {
  onDeletionLockChange?: (locked: boolean) => void;
}) {
  const [preparation, setPreparation] = useState<WorkspaceDeletionPreparation | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [dialogError, setDialogError] = useState<string | null>(null);
  const createRequestId = useRef<string | null>(null);
  const retryRequestId = useRef<string | null>(null);

  const deletion = preparation?.deletion ?? null;
  const polling = deletion?.status === "queued" || deletion?.status === "processing";

  const load = async (signal?: AbortSignal) => {
    setLoading(true);
    setError(null);
    try {
      const next = await loadWorkspaceDeletionPreparation(signal);
      setPreparation(next);
      onDeletionLockChange?.(Boolean(next.deletion));
    } catch (loadError) {
      if (loadError instanceof DOMException && loadError.name === "AbortError") return;
      setError(loadError instanceof Error ? loadError.message : "Deletion settings could not be loaded.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
    // The initial request is intentionally mounted once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!deletion || !polling) return;
    const controller = new AbortController();
    let stopped = false;
    const timer = setTimeout(async () => {
      try {
        const next = await loadWorkspaceDeletion(deletion.id, controller.signal);
        if (!stopped) {
          setPreparation((current) => current ? { ...current, deletion: next } : current);
          setError(null);
        }
      } catch (pollError) {
        if (stopped || (pollError instanceof DOMException && pollError.name === "AbortError")) return;
        if (pollError instanceof WorkspaceDeletionClientError && pollError.status === 401) {
          setError("Your sign-in session ended while deletion was running. Contact support if you need final confirmation.");
        } else {
          setError("Live deletion status is temporarily unavailable. The saved request will continue independently.");
        }
      }
    }, 2_500);
    return () => {
      stopped = true;
      clearTimeout(timer);
      controller.abort();
    };
  }, [deletion, polling]);

  const confirmDeletion = async (confirmation: string) => {
    if (!preparation?.confirmationPhrase || busy) return;
    setBusy(true);
    setDialogError(null);
    createRequestId.current ??= newDeletionRequestId("create");
    try {
      const result = await createWorkspaceDeletion({
        confirmation,
        requestId: createRequestId.current,
      });
      createRequestId.current = null;
      setPreparation({ ...preparation, deletion: result.deletion, confirmationPhrase: null, role: null, canDelete: true });
      onDeletionLockChange?.(true);
      setDialogOpen(false);
    } catch (createError) {
      setDialogError(createError instanceof Error ? createError.message : "The request could not be saved.");
    } finally {
      setBusy(false);
    }
  };

  const retry = async () => {
    if (!deletion || busy) return;
    setBusy(true);
    setError(null);
    retryRequestId.current ??= newDeletionRequestId("retry");
    try {
      const result = await retryWorkspaceDeletion({
        deletionRequestId: deletion.id,
        requestId: retryRequestId.current,
      });
      retryRequestId.current = null;
      setPreparation((current) => current ? { ...current, deletion: result.deletion } : current);
    } catch (retryError) {
      setError(retryError instanceof Error ? retryError.message : "The cleanup retry could not be saved.");
    } finally {
      setBusy(false);
    }
  };

  if (loading && !preparation) {
    return <div role="status" className="flex items-center gap-2 py-3 text-[12.5px] text-ink-400"><LuRefreshCw aria-hidden className="animate-spin" /> Loading deletion status</div>;
  }

  if (error && !preparation) {
    return (
      <div>
        <p role="alert" className="m-0 text-[12.5px] text-neg-700">{error}</p>
        <button type="button" onClick={() => void load()} className={`mt-3 h-9 rounded-[7px] border border-line-2 bg-white px-3 text-[12px] font-semibold text-ink-700 ${focusRing}`}>Try again</button>
      </div>
    );
  }

  if (deletion) {
    const copy = STATUS_COPY[deletion.status];
    return (
      <div className="min-w-0">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              {deletion.status === "needs_attention" ? <LuCircleAlert aria-hidden className="text-neg-700" /> : <LuClock3 aria-hidden className="text-plum" />}
              <h3 className="m-0 text-[15px] font-semibold text-ink-900">{copy.label}</h3>
            </div>
            <p className="mb-0 mt-1 max-w-[610px] text-[12.5px] leading-5 text-ink-500">{copy.detail}</p>
          </div>
          <button
            type="button"
            onClick={() => void load()}
            disabled={loading || busy}
            aria-label="Refresh deletion status"
            title="Refresh deletion status"
            className={`grid h-9 w-9 place-items-center rounded-[7px] border border-line-2 bg-white text-ink-500 disabled:opacity-45 ${focusRing}`}
          >
            <LuRefreshCw aria-hidden className={loading ? "animate-spin" : ""} />
          </button>
        </div>

        <dl className="mt-4 grid grid-cols-[minmax(120px,auto)_minmax(0,1fr)] gap-x-4 gap-y-2 border-y border-line-3 py-3 text-[12px]">
          <dt className="text-ink-400">Current stage</dt><dd className="font-semibold text-ink-700">{deletion.stage.replaceAll("_", " ")}</dd>
          <dt className="text-ink-400">Subscription</dt><dd className="text-ink-700">{prerequisiteLabel(deletion.stripeStatus)}</dd>
          <dt className="text-ink-400">Private files</dt><dd className="text-ink-700">{prerequisiteLabel(deletion.blobStatus)}</dd>
          <dt className="text-ink-400">Provider access</dt><dd className="text-ink-700">{providerSummary(deletion)}</dd>
          <dt className="text-ink-400">Attempt</dt><dd className="font-mono text-ink-700">{deletion.attempt}</dd>
        </dl>

        {error ? <p role="alert" className="mb-0 mt-3 text-[12px] text-neg-700">{error}</p> : null}
        {deletion.failureMessage ? <p role="alert" className="mb-0 mt-3 text-[12px] text-neg-700">{deletion.failureMessage}</p> : null}
        {deletion.warningCodes.length ? (
          <ul className="mb-0 mt-3 space-y-1 pl-5 text-[12px] leading-5 text-ink-500">
            {[...new Set(deletion.warningCodes.map(warningLabel))].map((warning) => <li key={warning}>{warning}</li>)}
          </ul>
        ) : null}

        <div className="mt-4 flex flex-wrap gap-2">
          {deletion.status === "needs_attention" ? (
            <button type="button" disabled={busy} onClick={() => void retry()} className={`h-9 rounded-[7px] bg-ink-900 px-3 text-[12px] font-semibold text-white disabled:opacity-45 ${focusRing}`}>
              {busy ? "Retrying..." : "Retry cleanup"}
            </button>
          ) : null}
          {TERMINAL.has(deletion.status) ? (
            <a href="mailto:rahbanigabriel@gmail.com?subject=Marpin%20deletion%20follow-up" className={`inline-flex h-9 items-center rounded-[7px] border border-line-2 bg-white px-3 text-[12px] font-semibold text-ink-700 no-underline ${focusRing}`}>Contact support</a>
          ) : null}
        </div>
      </div>
    );
  }

  if (!preparation?.canDelete || preparation.role !== "owner" || !preparation.confirmationPhrase) {
    return <p className="m-0 max-w-[610px] text-[12.5px] leading-5 text-ink-500">Only the workspace owner can request complete workspace deletion. An owner can remove the workspace without granting another member access to the request.</p>;
  }

  return (
    <div>
      <p className="m-0 max-w-[610px] text-[12.5px] leading-5 text-ink-500">Disconnect one provider from Manage connections, or permanently delete the entire workspace here. Deletion stops active jobs and must settle billing and private-file cleanup before database removal.</p>
      <button type="button" onClick={() => { setDialogError(null); setDialogOpen(true); }} className={`mt-4 inline-flex h-9 items-center gap-2 rounded-[7px] border border-neg-700 bg-white px-3 text-[12px] font-semibold text-neg-700 ${focusRing}`}>
        <LuTrash2 aria-hidden /> Delete workspace
      </button>
      <DeleteConfirmationDialog
        phrase={preparation.confirmationPhrase}
        open={dialogOpen}
        busy={busy}
        error={dialogError}
        onClose={() => { if (!busy) setDialogOpen(false); }}
        onConfirm={(confirmation) => void confirmDeletion(confirmation)}
      />
    </div>
  );
}
