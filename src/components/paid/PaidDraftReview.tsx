"use client";

import { useEffect, useId, useRef, useState } from "react";
import {
  LuArrowRight,
  LuCheck,
  LuCircleAlert,
  LuCopy,
  LuExternalLink,
  LuPencil,
  LuRefreshCw,
  LuShieldCheck,
  LuX,
} from "react-icons/lu";

import type {
  PaidCampaignApprovalDto,
  PaidCampaignDraftDto,
  PaidCampaignOperationAttemptDto,
} from "@/lib/paid-drafts/dto";
import type { PaidOperationCapability } from "@/lib/paid-drafts/capabilities";
import { PROVIDER_PAUSED_CONFIRMATION } from "@/lib/paid-drafts/parsers";

import { CALL_TO_ACTION_LABEL, PLATFORM_LABEL, TEMPLATE_LABEL, currencyFractionDigits } from "./paid-draft-form";
import { PaidDraftRequestError, checkMetaDraftReadiness, type MetaDraftReadiness } from "./paid-draft-client";

const focusRing = "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-plum";

const STATE_LABEL: Record<PaidCampaignDraftDto["state"], string> = {
  draft: "Draft",
  ready: "Ready for approval",
  creating_paused: "Creating paused",
  provider_paused: "Provider paused · user asserted",
  activating: "Activating",
  activation_requested: "Activation requested",
  active: "Active externally · unverified",
  in_review: "Provider review",
  rejected: "Rejected",
  needs_reconciliation: "Needs reconciliation",
};

function dateTime(value: string, timezone: string): string {
  return new Intl.DateTimeFormat("en", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: timezone,
  }).format(new Date(value));
}

function money(amountMinor: number, currency: string): string {
  try {
    return new Intl.NumberFormat("en", { style: "currency", currency }).format(
      amountMinor / (10 ** currencyFractionDigits(currency)),
    );
  } catch {
    return `${amountMinor} ${currency} minor units`;
  }
}

function capabilityCopy(capability: PaidOperationCapability): string {
  if (capability.path === "provider_checked" || capability.reason === "provider_preflight_required") return "Meta permissions and this exact snapshot must pass a live check before approval and paused creation. This is not Meta app-review approval.";
  if (capability.canExecuteProvider) return "Provider execution is available for this exact operation, subject to live permission checks.";
  if (capability.reason === "oauth_disconnected") return "The account is disconnected. Only a no-side-effect assisted handoff is available.";
  if (capability.reason === "provider_review_pending") return "Provider write review is pending. Only a no-side-effect assisted handoff is available.";
  if (capability.reason === "provider_review_rejected") return "Provider write access was rejected. Only a no-side-effect assisted handoff is available.";
  return "Provider writing is not reviewed for this operation. Marpin can only prepare an assisted handoff with no provider side effect.";
}

function MetaDeliverySummary({ draft }: { draft: PaidCampaignDraftDto }) {
  const delivery = draft.snapshot.platform === "meta_ads" ? draft.snapshot.metaDelivery : null;
  if (!delivery) return null;
  return <dl aria-label="Exact Meta delivery settings" className="mt-3 grid gap-x-3 gap-y-2 border-t border-line-2 pt-3 text-[11px] sm:grid-cols-[110px_minmax(0,1fr)]">
    <dt className="font-semibold text-ink-400">Facebook Page</dt><dd className="m-0 break-words text-ink-800">{delivery.pageName} · {delivery.pageId}</dd>
    <dt className="font-semibold text-ink-400">Placement</dt><dd className="m-0 text-ink-800">Facebook feed only</dd>
    <dt className="font-semibold text-ink-400">Beneficiary</dt><dd className="m-0 break-words text-ink-800">{delivery.beneficiary}</dd>
    <dt className="font-semibold text-ink-400">Payer</dt><dd className="m-0 break-words text-ink-800">{delivery.payer}</dd>
    <dt className="font-semibold text-ink-400">Special category</dt><dd className="m-0 text-ink-800">None, confirmed by the draft author</dd>
    <dt className="font-semibold text-ink-400">Delivery</dt><dd className="m-0 text-ink-800">Campaign, ad set and ads created paused. No activation.</dd>
  </dl>;
}

function MetaCreationProgress({ draft, attempt, verified }: { draft: PaidCampaignDraftDto; attempt: PaidCampaignOperationAttemptDto; verified: boolean }) {
  const outcome = attempt.providerOutcome;
  if (outcome?.kind !== "meta_paused_creation") return null;
  const accountId = draft.connection.accountId.replace(/^act_/, "");
  const link = /^\d{1,32}$/.test(accountId) && outcome.campaignId && /^\d{1,32}$/.test(outcome.campaignId)
    ? `https://adsmanager.facebook.com/adsmanager/manage/campaigns?act=${accountId}&selected_campaign_ids=${outcome.campaignId}` : null;
  const labels = { campaign: "Campaign", image: "Image", adset: "Ad set", creative: "Creative", ad: "Ad" };
  return <div aria-label="Meta creation progress" className="mt-4 border-t border-line-2 pt-3">
    <p className={`m-0 flex items-center gap-2 text-[12px] font-semibold ${verified ? "text-pos-700" : "text-[#745616]"}`}>{verified ? <LuShieldCheck aria-hidden /> : <LuCircleAlert aria-hidden />}{verified ? "Paused objects verified by Meta" : attempt.status === "running" ? "Creation in progress, not yet verified" : "Creation requires verification"}</p>
    <p className="mb-0 mt-2 text-[11px] leading-relaxed text-ink-600">{outcome.message}</p>
    <ol className="m-0 mt-3 grid list-none gap-0 p-0">{outcome.steps.map((step, index) => <li key={`${step.key}:${index}`} className="flex min-w-0 flex-wrap items-center justify-between gap-2 border-b border-line-3 py-2 text-[11px]"><span className="inline-flex items-center gap-2 text-ink-600">{step.status === "created" ? <LuCheck aria-hidden className={verified ? "text-pos-700" : "text-ink-400"} /> : <LuRefreshCw aria-hidden className="text-ink-400" />}{labels[step.kind]}<span className="font-mono text-[9px] text-ink-400">{step.key}</span></span><span className="min-w-0 break-all text-right font-mono text-[10px] text-ink-500">{step.id || "No provider ID recorded"}<span className="ml-2 font-sans">{step.status === "created" ? "Recorded" : "Submission uncertain"}</span></span></li>)}</ol>
    {outcome.code ? <p className="mb-0 mt-2 text-[10px] text-ink-500">Status code: <span className="font-mono">{outcome.code}</span></p> : null}
    {verified && outcome.verifiedAt ? <p className="mb-0 mt-2 text-[10px] text-ink-400">Verified {new Date(outcome.verifiedAt).toLocaleString()}</p> : null}
    {link ? <a href={link} target="_blank" rel="noreferrer" className={`mt-3 inline-flex items-center gap-1.5 text-[11px] font-semibold text-plum ${focusRing}`}><LuExternalLink aria-hidden />View campaign in Meta</a> : null}
  </div>;
}

function currentApproval(
  draft: PaidCampaignDraftDto,
  kind: "create_paused" | "activate",
): PaidCampaignApprovalDto | null {
  return draft.approvals.find((approval) =>
    approval.kind === kind
    && approval.status === "approved"
    && approval.snapshotVersion === draft.version
    && approval.snapshotHash === draft.snapshotHash,
  ) ?? null;
}

function providerUrl(platform: PaidCampaignDraftDto["platform"]): string {
  if (platform === "google_ads") return "https://ads.google.com/aw/overview";
  if (platform === "meta_ads") return "https://adsmanager.facebook.com/adsmanager/manage/campaigns";
  return "https://ads.tiktok.com/i18n/perf";
}

function isPendingAssistedHandoff(
  attempt: PaidCampaignOperationAttemptDto | null,
): attempt is PaidCampaignOperationAttemptDto & { providerOutcome: { kind: "assisted_handoff"; providerSideEffect: "none"; message: string; nextSteps: string[] } } {
  return attempt?.status === "assisted_handoff" && attempt.providerOutcome?.kind === "assisted_handoff";
}

function AssistedHandoffTools({
  draft,
  busy,
  activation,
  onRecordActivationOutcome,
}: {
  draft: PaidCampaignDraftDto;
  busy: boolean;
  activation: PaidCampaignOperationAttemptDto | null;
  onRecordActivationOutcome: (attempt: PaidCampaignOperationAttemptDto) => void;
}) {
  const [copyStatus, setCopyStatus] = useState<"idle" | "copied" | "failed">("idle");
  const copySnapshot = async () => {
    try {
      if (!navigator.clipboard) throw new Error("clipboard_unavailable");
      await navigator.clipboard.writeText(JSON.stringify(draft.snapshot, null, 2));
      setCopyStatus("copied");
    } catch {
      setCopyStatus("failed");
    }
  };
  return (
    <div className="mt-[10px] flex flex-wrap items-center gap-[8px]">
      <a href={providerUrl(draft.platform)} target="_blank" rel="noreferrer" className={`inline-flex h-[34px] items-center gap-[6px] rounded-[7px] border border-line-1 bg-surface-card px-[10px] text-[11.5px] font-semibold text-ink-700 ${focusRing}`}><LuExternalLink aria-hidden /> Open provider</a>
      <button type="button" disabled={busy} onClick={() => void copySnapshot()} className={`inline-flex h-[34px] items-center gap-[6px] rounded-[7px] border border-line-1 bg-surface-card px-[10px] text-[11.5px] font-semibold text-ink-700 disabled:opacity-45 ${focusRing}`}><LuCopy aria-hidden /> {copyStatus === "copied" ? "Snapshot copied" : copyStatus === "failed" ? "Copy failed · retry" : "Copy snapshot"}</button>
      {isPendingAssistedHandoff(activation) ? <button type="button" disabled={busy} onClick={() => onRecordActivationOutcome(activation)} className={`inline-flex h-[34px] items-center gap-[6px] rounded-[7px] border border-[#B88824] bg-[#FBF6E8] px-[10px] text-[11.5px] font-semibold text-[#745616] disabled:opacity-45 ${focusRing}`}><LuShieldCheck aria-hidden /> Record activation outcome</button> : null}
    </div>
  );
}

function ActivationOutcomeDialog({
  busy,
  onClose,
  onRecord,
}: {
  busy: boolean;
  onClose: () => void;
  onRecord: (outcome: "activated" | "not_activated") => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const titleId = useId();
  useEffect(() => {
    const dialog = dialogRef.current;
    previousFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (dialog && !dialog.open) dialog.showModal();
    return () => {
      if (dialog?.open) dialog.close();
      previousFocusRef.current?.focus();
    };
  }, []);
  return (
    <dialog ref={dialogRef} aria-labelledby={titleId} onCancel={(event) => { event.preventDefault(); if (!busy) onClose(); }} className="m-auto w-[min(520px,calc(100vw-24px))] rounded-[8px] border border-line-1 bg-surface-card p-0 text-ink-900 shadow-modal backdrop:bg-black/35">
      <header className="flex items-start justify-between gap-[12px] border-b border-line-2 px-[16px] py-[14px]">
        <div><p className="m-0 font-mono text-[9.5px] font-semibold uppercase tracking-[0.08em] text-ink-300">External result</p><h2 id={titleId} className="mb-0 mt-[3px] text-[18px] font-semibold text-ink-900">Record activation outcome</h2></div>
        <button type="button" aria-label="Close outcome" disabled={busy} onClick={onClose} className={`grid h-[32px] w-[32px] place-items-center rounded-[6px] border border-line-2 bg-transparent text-ink-500 ${focusRing}`}><LuX aria-hidden /></button>
      </header>
      <div className="px-[16px] py-[15px]"><p className="m-0 text-[12px] leading-[1.55] text-ink-600">Marpin did not activate or verify this campaign. Choose the result you observed at the provider. Recording “not activated” cancels this handoff and lets you request a fresh exact approval.</p></div>
      <footer className="flex flex-wrap justify-end gap-[8px] border-t border-line-2 px-[16px] py-[12px]">
        <button type="button" disabled={busy} onClick={() => onRecord("not_activated")} className={`h-[36px] rounded-[7px] border border-line-1 bg-surface-card px-[12px] text-[12px] font-semibold text-ink-600 disabled:opacity-50 ${focusRing}`}>Not activated</button>
        <button autoFocus type="button" disabled={busy} onClick={() => onRecord("activated")} className={`inline-flex h-[36px] items-center gap-[6px] rounded-[7px] bg-ink-900 px-[12px] text-[12px] font-semibold text-white disabled:opacity-50 ${focusRing}`}><LuShieldCheck aria-hidden /> Activated externally</button>
      </footer>
    </dialog>
  );
}

function ApprovalDialog({
  draft,
  kind,
  capability,
  busy,
  onClose,
  onApprove,
  canApprove = true,
}: {
  draft: PaidCampaignDraftDto;
  kind: "create_paused" | "activate";
  capability: PaidOperationCapability;
  busy: boolean;
  onClose: () => void;
  onApprove: () => void;
  canApprove?: boolean;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const titleId = useId();
  const descriptionId = useId();
  useEffect(() => {
    const dialog = dialogRef.current;
    previousFocusRef.current = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    if (dialog && !dialog.open) dialog.showModal();
    return () => {
      if (dialog?.open) dialog.close();
      previousFocusRef.current?.focus();
    };
  }, []);
  return (
    <dialog
      ref={dialogRef}
      aria-labelledby={titleId}
      aria-describedby={descriptionId}
      onCancel={(event) => {
        event.preventDefault();
        if (!busy) onClose();
      }}
      onMouseDown={(event) => {
        const rect = event.currentTarget.getBoundingClientRect();
        const outside = event.clientX < rect.left || event.clientX > rect.right
          || event.clientY < rect.top || event.clientY > rect.bottom;
        if (outside && !busy) onClose();
      }}
      className="m-auto w-[min(560px,calc(100vw-24px))] rounded-[8px] border border-line-1 bg-surface-card p-0 text-ink-900 shadow-modal backdrop:bg-black/35"
    >
        <header className="flex items-start justify-between gap-[12px] border-b border-line-2 px-[16px] py-[14px]">
          <div><p className="m-0 font-mono text-[9.5px] font-semibold uppercase tracking-[0.08em] text-ink-300">Bound approval</p><h2 id={titleId} className="mb-0 mt-[3px] text-[18px] font-semibold text-ink-900">Approve {kind === "activate" ? "activation" : "create paused"}</h2></div>
          <button type="button" aria-label="Close approval" disabled={busy} onClick={onClose} className={`grid h-[32px] w-[32px] place-items-center rounded-[6px] border border-line-2 bg-transparent text-ink-500 ${focusRing}`}><LuX aria-hidden /></button>
        </header>
        <div className="max-h-[60vh] overflow-y-auto px-[16px] py-[15px]">
          <p id={descriptionId} className="m-0 text-[13px] leading-[1.55] text-ink-600">This approval applies only to the immutable snapshot below. Any later edit requires a new approval.</p>
          <dl className="mt-[13px] grid gap-[8px] border-y border-line-2 py-[11px] text-[11.5px] sm:grid-cols-[120px_minmax(0,1fr)]">
            <dt className="font-semibold text-ink-400">Operation</dt><dd className="m-0 text-ink-800">{kind === "activate" ? "Activate campaign" : "Create campaign paused"}</dd>
            <dt className="font-semibold text-ink-400">Version</dt><dd className="m-0 font-mono text-ink-800">v{draft.version}</dd>
            <dt className="font-semibold text-ink-400">Snapshot hash</dt><dd className="m-0 break-all font-mono text-[10px] text-ink-700">{draft.snapshotHash}</dd>
            <dt className="font-semibold text-ink-400">Account</dt><dd className="m-0 text-ink-800">{draft.connection.accountName} · {draft.connection.accountId}</dd>
          </dl>
          {kind === "create_paused" ? <><p className="text-[11px] text-ink-600">{money(draft.snapshot.budget.amountMinor, draft.snapshot.budget.currency)} · {draft.snapshot.budget.cadence} · {dateTime(draft.snapshot.schedule.startsAt, draft.snapshot.schedule.timezone)} to {dateTime(draft.snapshot.schedule.endsAt, draft.snapshot.schedule.timezone)} ({draft.snapshot.schedule.timezone})</p><MetaDeliverySummary draft={draft} /></> : null}
          <div className="mt-[12px] border-l-[3px] border-[#B88824] bg-[#FBF6E8] px-[11px] py-[9px] text-[11.5px] leading-[1.5] text-[#745616]">{capabilityCopy(capability)}</div>
        </div>
        <footer className="flex flex-wrap justify-end gap-[8px] border-t border-line-2 px-[16px] py-[12px]">
          <button autoFocus type="button" disabled={busy} onClick={onClose} className={`h-[36px] rounded-[7px] border border-line-1 bg-surface-card px-[12px] text-[12px] font-semibold text-ink-600 disabled:opacity-50 ${focusRing}`}>Cancel</button>
          <button type="button" disabled={busy || !canApprove} onClick={onApprove} className={`inline-flex h-[36px] items-center gap-[6px] rounded-[7px] bg-ink-900 px-[12px] text-[12px] font-semibold text-white disabled:opacity-50 ${focusRing}`}><LuShieldCheck aria-hidden /> {busy ? "Approving…" : "Approve exact snapshot"}</button>
        </footer>
    </dialog>
  );
}

function ProviderPausedDialog({
  draft,
  busy,
  onClose,
  onConfirm,
}: {
  draft: PaidCampaignDraftDto;
  busy: boolean;
  onClose: () => void;
  onConfirm: (providerCampaignId: string) => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const titleId = useId();
  const descriptionId = useId();
  const [providerCampaignId, setProviderCampaignId] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const validProviderCampaignId = /^[0-9]{1,32}$/.test(providerCampaignId);

  useEffect(() => {
    const dialog = dialogRef.current;
    previousFocusRef.current = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    if (dialog && !dialog.open) dialog.showModal();
    return () => {
      if (dialog?.open) dialog.close();
      previousFocusRef.current?.focus();
    };
  }, []);

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby={titleId}
      aria-describedby={descriptionId}
      onCancel={(event) => {
        event.preventDefault();
        if (!busy) onClose();
      }}
      onMouseDown={(event) => {
        const rect = event.currentTarget.getBoundingClientRect();
        const outside = event.clientX < rect.left || event.clientX > rect.right
          || event.clientY < rect.top || event.clientY > rect.bottom;
        if (outside && !busy) onClose();
      }}
      className="m-auto w-[min(560px,calc(100vw-24px))] rounded-[8px] border border-line-1 bg-surface-card p-0 text-ink-900 shadow-modal backdrop:bg-black/35"
    >
      <header className="flex items-start justify-between gap-[12px] border-b border-line-2 px-[16px] py-[14px]">
        <div>
          <p className="m-0 font-mono text-[9.5px] font-semibold uppercase tracking-[0.08em] text-ink-300">Provider confirmation</p>
          <h2 id={titleId} className="mb-0 mt-[3px] text-[18px] font-semibold text-ink-900">Confirm paused provider campaign</h2>
        </div>
        <button type="button" aria-label="Close confirmation" disabled={busy} onClick={onClose} className={`grid h-[32px] w-[32px] place-items-center rounded-[6px] border border-line-2 bg-transparent text-ink-500 ${focusRing}`}><LuX aria-hidden /></button>
      </header>
      <div className="grid gap-[13px] px-[16px] py-[15px]">
        <p id={descriptionId} className="m-0 text-[12px] leading-[1.55] text-ink-600">Marpin did not create or verify this campaign. Enter the numeric campaign ID only after you created it in {PLATFORM_LABEL[draft.platform]} and confirmed it is paused.</p>
        <label className="grid gap-[5px] text-[11px] font-semibold text-ink-600">
          Provider campaign ID
          <input
            autoFocus
            inputMode="numeric"
            pattern="[0-9]*"
            autoComplete="off"
            value={providerCampaignId}
            onChange={(event) => setProviderCampaignId(event.target.value.replace(/\D/g, "").slice(0, 32))}
            aria-describedby={`${descriptionId}-campaign-id`}
            className={`h-[38px] rounded-[7px] border border-line-1 bg-surface-card px-[10px] font-mono text-[12px] text-ink-900 outline-none focus:border-plum-border ${focusRing}`}
          />
          <span id={`${descriptionId}-campaign-id`} className="font-normal text-ink-400">Digits only. This ID is stored as a user assertion and is not provider-verified.</span>
        </label>
        <label className="flex items-start gap-[8px] rounded-[7px] border border-line-2 bg-track-1 px-[10px] py-[9px] text-[11.5px] leading-[1.45] text-ink-700">
          <input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} className="mt-[2px] h-[15px] w-[15px] accent-plum" />
          <span>{PROVIDER_PAUSED_CONFIRMATION}</span>
        </label>
      </div>
      <footer className="flex flex-wrap justify-end gap-[8px] border-t border-line-2 px-[16px] py-[12px]">
        <button type="button" disabled={busy} onClick={onClose} className={`h-[36px] rounded-[7px] border border-line-1 bg-surface-card px-[12px] text-[12px] font-semibold text-ink-600 disabled:opacity-50 ${focusRing}`}>Cancel</button>
        <button type="button" disabled={busy || !validProviderCampaignId || !confirmed} onClick={() => onConfirm(providerCampaignId)} className={`inline-flex h-[36px] items-center gap-[6px] rounded-[7px] bg-ink-900 px-[12px] text-[12px] font-semibold text-white disabled:cursor-not-allowed disabled:opacity-45 ${focusRing}`}><LuShieldCheck aria-hidden /> {busy ? "Recording…" : "Record paused campaign"}</button>
      </footer>
    </dialog>
  );
}

export function PaidDraftReview({
  draft,
  busy,
  onEdit,
  onApprove,
  onExecute,
  onConfirmProviderPaused,
  onRecordActivationOutcome,
  onReconcileMeta,
  executionUncertain = false,
}: {
  draft: PaidCampaignDraftDto;
  busy: boolean;
  onEdit: () => void;
  onApprove: (kind: "create_paused" | "activate") => void;
  onExecute: (approval: PaidCampaignApprovalDto) => void;
  onConfirmProviderPaused: (providerCampaignId: string) => void;
  onRecordActivationOutcome: (
    attempt: PaidCampaignOperationAttemptDto,
    outcome: "activated" | "not_activated",
  ) => void;
  onReconcileMeta?: () => void;
  executionUncertain?: boolean;
}): React.JSX.Element {
  const [approvalKind, setApprovalKind] = useState<"create_paused" | "activate" | null>(null);
  const [providerPausedOpen, setProviderPausedOpen] = useState(false);
  const [activationOutcomeAttempt, setActivationOutcomeAttempt] = useState<PaidCampaignOperationAttemptDto | null>(null);
  const [readiness, setReadiness] = useState<(MetaDraftReadiness & { draftId: string }) | null>(null);
  const [checkingMeta, setCheckingMeta] = useState(false);
  const [checkError, setCheckError] = useState<string | null>(null);
  const [billingBlocked, setBillingBlocked] = useState(false);
  const snapshot = draft.snapshot;
  const createApproval = currentApproval(draft, "create_paused");
  const activationApproval = currentApproval(draft, "activate");
  const currentCreateAttempt = [...draft.attempts].sort((left, right) => right.attemptedAt.localeCompare(left.attemptedAt)).find((attempt) =>
    attempt.operation === "create_paused"
    && !(attempt.status === "failed" && attempt.providerOutcome?.providerSideEffect === "none")
    && (attempt.snapshotVersion === draft.version || attempt.providerOutcome?.kind === "meta_paused_creation" || (snapshot.platform === "meta_ads" && Boolean(snapshot.metaDelivery)))
    && attempt.snapshotHash === draft.snapshotHash,
  ) ?? null;
  const currentActivationAttempt = draft.attempts.find((attempt) =>
    attempt.operation === "activate"
    && attempt.snapshotVersion === draft.version
    && attempt.snapshotHash === draft.snapshotHash,
  ) ?? null;
  const createCapability = draft.capabilities.execution.createPaused;
  const activationCapability = draft.capabilities.execution.activation;
  const previousNoEffectFailure = !currentCreateAttempt ? draft.attempts.find((attempt) => attempt.operation === "create_paused" && attempt.snapshotHash === draft.snapshotHash && attempt.status === "failed" && attempt.providerOutcome?.providerSideEffect === "none") : null;
  const directMeta = snapshot.platform === "meta_ads" && Boolean(snapshot.metaDelivery);
  const metaReady = Boolean(readiness?.ready && readiness.draftId === draft.id && readiness.version === draft.version && readiness.snapshotHash === draft.snapshotHash);
  const verifiedPaused = draft.state === "provider_paused" && draft.providerPausedConfirmation?.verificationStatus === "provider_verified" && draft.providerPausedConfirmation.snapshotHash === draft.snapshotHash;
  const canApproveCreate = !directMeta || metaReady;
  const checkMeta = async () => {
    if (busy || checkingMeta || !draft.capabilities.canManage) return;
    setCheckingMeta(true);
    setReadiness(null);
    setCheckError(null);
    setBillingBlocked(false);
    try {
      const result = await checkMetaDraftReadiness(draft.id);
      if (result.ready !== true || result.version !== draft.version || result.snapshotHash !== draft.snapshotHash) throw new Error("The draft changed. Refresh it and check this version again.");
      setReadiness({ ...result, draftId: draft.id });
    } catch (failure) {
      setCheckError(failure instanceof Error ? failure.message : "Meta readiness could not be checked.");
      setBillingBlocked(failure instanceof PaidDraftRequestError && failure.status === 402);
    }
    finally { setCheckingMeta(false); }
  };

  return (
    <div className="mx-auto w-full max-w-[980px]">
      <header className="flex flex-wrap items-start justify-between gap-[12px] border-b border-line-2 pb-[16px]">
        <div>
          <p className="m-0 font-mono text-[9.5px] font-semibold uppercase tracking-[0.08em] text-ink-300">Review exact snapshot</p>
          <h2 className="mb-0 mt-[3px] text-[20px] font-semibold text-ink-900">{snapshot.campaign.name}</h2>
          <div className="mt-[7px] flex flex-wrap gap-[6px]"><span className={`rounded-[5px] px-[7px] py-[3px] text-[10.5px] font-semibold ${verifiedPaused ? "bg-pos-bg text-pos-700" : draft.state === "needs_reconciliation" || draft.state === "creating_paused" ? "bg-[#FBF6E8] text-[#745616]" : "bg-track-1 text-ink-600"}`}>{verifiedPaused ? "Verified paused" : STATE_LABEL[draft.state]}</span><span className="rounded-[5px] bg-track-1 px-[7px] py-[3px] text-[10.5px] font-semibold text-ink-500">v{draft.version}</span><span className="rounded-[5px] bg-track-1 px-[7px] py-[3px] text-[10.5px] font-semibold capitalize text-ink-500">{draft.source} source</span></div>
        </div>
        {draft.capabilities.canEdit ? <button type="button" disabled={busy} onClick={onEdit} className={`inline-flex h-[36px] items-center gap-[6px] rounded-[7px] border border-line-1 bg-surface-card px-[11px] text-[12px] font-semibold text-ink-700 disabled:opacity-45 ${focusRing}`}><LuPencil aria-hidden /> Edit draft</button> : null}
      </header>

      <section className="border-b border-line-2 py-[17px]" aria-labelledby="review-binding-title">
        <h3 id="review-binding-title" className="m-0 text-[14px] font-semibold text-ink-900">Version binding</h3>
        <dl className="mt-[10px] grid gap-x-[18px] gap-y-[9px] text-[11.5px] sm:grid-cols-[130px_minmax(0,1fr)]">
          <dt className="font-semibold text-ink-400">Snapshot hash</dt><dd className="m-0 break-all font-mono text-[10px] text-ink-700">{draft.snapshotHash}</dd>
          <dt className="font-semibold text-ink-400">Updated</dt><dd className="m-0 text-ink-700">{new Date(draft.updatedAt).toLocaleString()}</dd>
          <dt className="font-semibold text-ink-400">Account</dt><dd className="m-0 text-ink-700">{PLATFORM_LABEL[draft.platform]} · {draft.connection.accountName} · {draft.connection.accountId}</dd>
          <dt className="font-semibold text-ink-400">Template</dt><dd className="m-0 text-ink-700">{TEMPLATE_LABEL[draft.template]}</dd>
        </dl>
      </section>

      <section className="border-b border-line-2 py-[17px]" aria-labelledby="review-delivery-title">
        <h3 id="review-delivery-title" className="m-0 text-[14px] font-semibold text-ink-900">Budget and delivery</h3>
        <dl className="mt-[10px] grid gap-[12px] sm:grid-cols-2 lg:grid-cols-4">
          <div><dt className="text-[10px] font-semibold uppercase text-ink-300">Budget</dt><dd className="m-0 mt-[3px] text-[13px] font-semibold text-ink-800">{money(snapshot.budget.amountMinor, snapshot.budget.currency)} · {snapshot.budget.cadence}</dd></div>
          <div><dt className="text-[10px] font-semibold uppercase text-ink-300">Timezone</dt><dd className="m-0 mt-[3px] text-[13px] font-semibold text-ink-800">{snapshot.schedule.timezone}</dd></div>
          <div><dt className="text-[10px] font-semibold uppercase text-ink-300">Starts</dt><dd className="m-0 mt-[3px] text-[13px] font-semibold text-ink-800">{dateTime(snapshot.schedule.startsAt, snapshot.schedule.timezone)}</dd></div>
          <div><dt className="text-[10px] font-semibold uppercase text-ink-300">Ends</dt><dd className="m-0 mt-[3px] text-[13px] font-semibold text-ink-800">{dateTime(snapshot.schedule.endsAt, snapshot.schedule.timezone)}</dd></div>
        </dl>
        <MetaDeliverySummary draft={draft} />
        <div className="mt-[13px]"><h4 className="m-0 text-[11px] font-semibold text-ink-500">Assumptions</h4>{snapshot.assumptions.length ? <ul className="mb-0 mt-[6px] list-disc pl-[18px] text-[12px] leading-[1.55] text-ink-600">{snapshot.assumptions.map((assumption) => <li key={assumption}>{assumption}</li>)}</ul> : <p className="mb-0 mt-[5px] text-[12px] text-ink-400">No assumptions recorded.</p>}</div>
      </section>

      <section className="border-b border-line-2 py-[17px]" aria-labelledby="review-groups-title">
        <h3 id="review-groups-title" className="m-0 text-[14px] font-semibold text-ink-900">Ad groups and ads</h3>
        {snapshot.adGroups.map((group, index) => (
          <div key={group.localId} className="border-t border-line-3 py-[14px] first:mt-[8px]">
            <div className="flex flex-wrap items-baseline justify-between gap-[7px]"><h4 className="m-0 text-[13px] font-semibold text-ink-800">{index + 1}. {group.name}</h4><span className="font-mono text-[9.5px] text-ink-300">{group.ads.length} {group.ads.length === 1 ? "ad" : "ads"}</span></div>
            <div className="mt-[7px] grid gap-[5px] text-[11.5px] text-ink-500 sm:grid-cols-2">
              <p className="m-0"><strong className="text-ink-600">Locations:</strong> {group.targeting.locations.join(", ")}</p>
              <p className="m-0"><strong className="text-ink-600">Languages:</strong> {group.targeting.languages.join(", ")}</p>
              {group.targeting.kind === "search" ? <><p className="m-0 sm:col-span-2"><strong className="text-ink-600">Keywords:</strong> {group.targeting.keywords.map((keyword) => `${keyword.matchType}: ${keyword.text}`).join(" · ")}</p><p className="m-0 sm:col-span-2"><strong className="text-ink-600">Negatives:</strong> {group.targeting.negativeKeywords.join(", ") || "None"}</p></> : <><p className="m-0"><strong className="text-ink-600">Age:</strong> {group.targeting.ageMin}–{group.targeting.ageMax}</p><p className="m-0"><strong className="text-ink-600">Gender:</strong> {group.targeting.genders.join(", ")}</p><p className="m-0 sm:col-span-2"><strong className="text-ink-600">Interests:</strong> {group.targeting.interests.join(", ") || "None"}</p></>}
            </div>
            <div className="mt-[10px] border-l-2 border-line-2 pl-[12px]">
              {group.ads.map((ad) => (
                <div key={ad.localId} className="border-b border-line-3 py-[10px] last:border-b-0">
                  <div className="flex flex-wrap items-center justify-between gap-[6px]"><span className="text-[12px] font-semibold text-ink-800">{ad.name}</span><span className="font-mono text-[9.5px] text-ink-300">{ad.format}</span></div>
                  {"headlines" in ad ? <><p className="mb-0 mt-[5px] text-[11.5px] text-ink-600"><strong>Headlines:</strong> {ad.headlines.join(" · ")}</p><p className="mb-0 mt-[4px] text-[11.5px] text-ink-600"><strong>Descriptions:</strong> {ad.descriptions.join(" · ")}</p></> : <><p className="mb-0 mt-[5px] text-[11.5px] text-ink-600">{ad.primaryText}</p><p className="mb-0 mt-[4px] text-[11.5px] text-ink-600"><strong>{ad.headline}</strong> · {CALL_TO_ACTION_LABEL[ad.callToAction]} · asset {ad.assetIds[0]}</p></>}
                  <a href={ad.destinationUrl} target="_blank" rel="noreferrer" className={`mt-[5px] inline-flex max-w-full items-center gap-[4px] break-all text-[11px] font-semibold text-plum ${focusRing}`}>{ad.destinationUrl}<LuExternalLink aria-hidden className="flex-none" /></a>
                </div>
              ))}
            </div>
          </div>
        ))}
      </section>

      <section className="border-b border-line-2 py-[17px]" aria-labelledby="review-operation-title">
        <h3 id="review-operation-title" className="m-0 text-[14px] font-semibold text-ink-900">{directMeta ? "Create in Meta, paused" : "Paused campaign handoff"}</h3>
        <p className="mb-0 mt-[6px] text-[12px] leading-[1.55] text-ink-500">{capabilityCopy(createCapability)}</p>
        {directMeta && draft.state === "ready" && !currentCreateAttempt ? <div className="mt-3 flex flex-wrap items-center gap-2"><button type="button" disabled={busy || checkingMeta || !draft.capabilities.canManage} onClick={() => void checkMeta()} className={`inline-flex min-h-9 items-center gap-1.5 rounded-[7px] border border-line-1 bg-surface-card px-3 text-xs font-semibold text-ink-700 disabled:opacity-50 ${focusRing}`}><LuRefreshCw aria-hidden className={checkingMeta ? "animate-spin" : ""} />{checkingMeta ? "Checking Meta readiness…" : "Check Meta readiness"}</button>{metaReady ? <span role="status" className="text-[11px] text-ink-600">Readiness checked for v{draft.version}. Approval still required.</span> : null}</div> : null}
        {checkError ? <div role="alert" className="mb-0 mt-2 border-l-2 border-neg-700 pl-2 text-[11px] text-neg-700"><p className="m-0">{checkError}</p>{billingBlocked ? <p className="mb-0 mt-1">Real Meta creation requires a plan with campaign execution. <a href="/settings/billing" className={`font-semibold underline underline-offset-2 ${focusRing}`}>Review plan</a></p> : null}</div> : null}
        {previousNoEffectFailure ? <div className="mt-3 border-l-2 border-line-1 pl-2 text-[11px] text-ink-600"><p className="m-0 font-semibold">Previous attempt: no provider changes</p><p className="mb-0 mt-1">{previousNoEffectFailure.providerOutcome?.message}</p><p className="mb-0 mt-1">The previous approval was consumed. Edit the draft and mark a new version ready before requesting a fresh approval.</p></div> : null}
        {executionUncertain ? <p role="alert" className="mb-0 mt-2 border-l-2 border-[#B88824] pl-2 text-[11px] text-[#745616]">The creation response was interrupted. Refresh the saved status before any further action. Do not create this campaign again.</p> : null}
        <div className="mt-[11px] flex flex-wrap gap-[8px]">
          {draft.state === "ready" && !currentCreateAttempt && !createApproval ? <button type="button" disabled={busy || checkingMeta || executionUncertain || !draft.capabilities.canApproveCreatePaused || !canApproveCreate} title={!canApproveCreate ? "Check Meta readiness for this exact snapshot first" : undefined} onClick={() => setApprovalKind("create_paused")} className={`inline-flex h-[36px] items-center gap-[6px] rounded-[7px] bg-ink-900 px-[12px] text-[12px] font-semibold text-white disabled:cursor-not-allowed disabled:opacity-45 ${focusRing}`}><LuShieldCheck aria-hidden /> Approve create paused</button> : null}
          {!currentCreateAttempt && createApproval ? <button type="button" disabled={busy || checkingMeta || executionUncertain || (directMeta && !metaReady)} onClick={() => onExecute(createApproval)} className={`inline-flex h-[36px] items-center gap-[6px] rounded-[7px] bg-plum px-[12px] text-[12px] font-semibold text-white disabled:opacity-45 ${focusRing}`}><LuArrowRight aria-hidden /> {createCapability.canExecuteProvider || directMeta ? "Create paused campaign" : "Prepare assisted handoff"}</button> : null}
          {createApproval ? <span className="inline-flex items-center gap-[5px] text-[11px] font-semibold text-pos-700"><LuCheck aria-hidden /> Approval bound to v{createApproval.snapshotVersion}</span> : null}
          {currentCreateAttempt ? <span className={`inline-flex items-center gap-[5px] text-[11px] font-semibold ${currentCreateAttempt.status === "assisted_handoff" || verifiedPaused ? "text-pos-700" : "text-ink-600"}`}><LuCheck aria-hidden /> {currentCreateAttempt.status === "assisted_handoff" ? "Assisted handoff prepared" : "Paused-creation attempt recorded"}</span> : null}
          {directMeta && (draft.state === "creating_paused" || draft.state === "needs_reconciliation") && onReconcileMeta ? <button type="button" disabled={busy || !draft.capabilities.canManage} onClick={onReconcileMeta} className={`inline-flex min-h-9 items-center gap-1.5 rounded-[7px] border border-line-1 bg-surface-card px-3 text-xs font-semibold text-ink-700 disabled:opacity-50 ${focusRing}`}><LuRefreshCw aria-hidden />Check created objects</button> : null}
        </div>
        {draft.capabilities.canConfirmProviderPaused ? <div className="mt-[12px] border-l-[3px] border-[#B88824] bg-[#FBF6E8] px-[11px] py-[10px]"><p className="m-0 text-[11.5px] leading-[1.5] text-[#745616]">After creating the campaign in {PLATFORM_LABEL[draft.platform]} and leaving it paused, record its campaign ID here. Marpin will treat this as your unverified assertion.</p><button type="button" disabled={busy} onClick={() => setProviderPausedOpen(true)} className={`mt-[8px] h-[34px] rounded-[7px] border border-[#B88824] bg-surface-card px-[10px] text-[11.5px] font-semibold text-[#745616] disabled:opacity-45 ${focusRing}`}>Confirm campaign is paused at provider</button></div> : null}
        {draft.providerPausedConfirmation ? <div className={`mt-[11px] grid gap-[3px] rounded-[7px] border px-[10px] py-[9px] text-[11.5px] ${verifiedPaused ? "border-pos-500 bg-pos-bg text-pos-700" : "border-line-2 bg-track-1 text-ink-600"}`}><strong>{verifiedPaused ? "Verified paused" : "Paused campaign recorded"}</strong><span>Provider campaign {draft.providerPausedConfirmation.providerCampaignId} · {draft.providerPausedConfirmation.verificationStatus === "provider_verified" ? `provider-verified ${new Date(draft.providerPausedConfirmation.confirmedAt).toLocaleString()}` : "user asserted, not provider-verified"}</span></div> : null}
        {currentCreateAttempt?.providerOutcome?.kind === "meta_paused_creation" ? <MetaCreationProgress draft={draft} attempt={currentCreateAttempt} verified={verifiedPaused} /> : null}
        {isPendingAssistedHandoff(currentCreateAttempt) ? <AssistedHandoffTools draft={draft} busy={busy} activation={null} onRecordActivationOutcome={() => undefined} /> : null}
      </section>

      <section className="border-b border-line-2 py-[17px]" aria-labelledby="review-activation-title">
        <h3 id="review-activation-title" className="m-0 text-[14px] font-semibold text-ink-900">Activation · separate approval required</h3>
        {draft.state !== "provider_paused" ? <p className="mb-0 mt-[6px] text-[12px] text-ink-400">Activation is disabled until the campaign is independently confirmed as paused at the provider.</p> : <><p className="mb-0 mt-[6px] text-[12px] leading-[1.55] text-ink-500">{capabilityCopy(activationCapability)}</p><div className="mt-[11px] flex flex-wrap gap-[8px]">{activationApproval ? <button type="button" disabled={busy} onClick={() => onExecute(activationApproval)} className={`inline-flex h-[36px] items-center gap-[6px] rounded-[7px] bg-plum px-[12px] text-[12px] font-semibold text-white disabled:opacity-45 ${focusRing}`}><LuArrowRight aria-hidden /> {activationCapability.canExecuteProvider ? "Activate campaign" : "Prepare activation handoff"}</button> : null}{!activationApproval && draft.capabilities.canApproveActivation ? <button type="button" disabled={busy} onClick={() => setApprovalKind("activate")} className={`inline-flex h-[36px] items-center gap-[6px] rounded-[7px] bg-ink-900 px-[12px] text-[12px] font-semibold text-white disabled:opacity-45 ${focusRing}`}><LuShieldCheck aria-hidden /> Approve activation</button> : null}</div>{draft.capabilities.canRecordExternalActivationOutcome && isPendingAssistedHandoff(currentActivationAttempt) ? <div className="mt-[12px] border-l-[3px] border-[#B88824] bg-[#FBF6E8] px-[11px] py-[10px]"><p className="m-0 text-[11.5px] leading-[1.5] text-[#745616]">This approval is consumed by the assisted handoff. Open the provider, copy this exact snapshot, then record whether the campaign was activated or cancel this handoff as not activated.</p><AssistedHandoffTools draft={draft} busy={busy} activation={currentActivationAttempt} onRecordActivationOutcome={setActivationOutcomeAttempt} /></div> : null}</>}
      </section>

      <section className="py-[17px]" aria-labelledby="review-history-title">
        <h3 id="review-history-title" className="m-0 text-[14px] font-semibold text-ink-900">Approval and attempt history</h3>
        {!draft.approvals.length && !draft.attempts.length ? <p className="mb-0 mt-[7px] text-[12px] text-ink-400">No approvals or handoff attempts yet.</p> : null}
        <div className="mt-[8px] grid gap-[12px] lg:grid-cols-2">
          <div><h4 className="m-0 font-mono text-[9.5px] font-semibold uppercase tracking-[0.08em] text-ink-300">Approvals</h4>{draft.approvals.map((approval) => <div key={approval.id} className="border-b border-line-3 py-[8px] text-[11px] text-ink-600"><div className="flex justify-between gap-[8px]"><strong>{approval.kind === "activate" ? "Activation" : "Create paused"}</strong><span className="capitalize">{approval.status}</span></div><div className="mt-[3px] font-mono text-[9.5px] text-ink-300">v{approval.snapshotVersion} · {approval.snapshotHash.slice(0, 12)}… · {new Date(approval.approvedAt).toLocaleString()}</div></div>)}</div>
          <div><h4 className="m-0 font-mono text-[9.5px] font-semibold uppercase tracking-[0.08em] text-ink-300">Attempts</h4>{draft.attempts.map((attempt) => <div key={attempt.id} className="border-b border-line-3 py-[8px] text-[11px] text-ink-600"><div className="flex justify-between gap-[8px]"><strong>{attempt.operation === "activate" ? "Activation" : "Create paused"}</strong><span className="capitalize">{attempt.status.replaceAll("_", " ")}</span></div><div className="mt-[3px] font-mono text-[9.5px] text-ink-300">v{attempt.snapshotVersion} · {new Date(attempt.attemptedAt).toLocaleString()}</div>{attempt.providerOutcome?.kind === "assisted_handoff" ? <div className="mt-[7px] border-l-[3px] border-[#B88824] bg-[#FBF6E8] px-[9px] py-[7px] text-[#745616]"><p className="m-0 font-semibold">No provider side effect</p><p className="mb-0 mt-[3px]">{attempt.providerOutcome.message}</p>{attempt.providerOutcome.nextSteps.length ? <ol className="mb-0 mt-[4px] list-decimal pl-[17px]">{attempt.providerOutcome.nextSteps.map((step) => <li key={step}>{step}</li>)}</ol> : null}</div> : null}{attempt.providerOutcome?.kind === "external_activation_outcome" ? <div className="mt-[7px] border-l-[3px] border-[#B88824] bg-[#FBF6E8] px-[9px] py-[7px] text-[#745616]"><p className="m-0 font-semibold">External result: {attempt.providerOutcome.outcome === "activated" ? "activated" : "not activated"}</p><p className="mb-0 mt-[3px]">{attempt.providerOutcome.message}</p></div> : null}</div>)}</div>
        </div>
      </section>

      {approvalKind ? <ApprovalDialog draft={draft} kind={approvalKind} capability={approvalKind === "activate" ? activationCapability : createCapability} busy={busy} canApprove={approvalKind !== "create_paused" || (canApproveCreate && !executionUncertain && !currentCreateAttempt)} onClose={() => setApprovalKind(null)} onApprove={() => { if (approvalKind === "create_paused" && (!canApproveCreate || executionUncertain || currentCreateAttempt)) return; onApprove(approvalKind); setApprovalKind(null); }} /> : null}
      {providerPausedOpen ? <ProviderPausedDialog draft={draft} busy={busy} onClose={() => setProviderPausedOpen(false)} onConfirm={(providerCampaignId) => { onConfirmProviderPaused(providerCampaignId); setProviderPausedOpen(false); }} /> : null}
      {activationOutcomeAttempt ? <ActivationOutcomeDialog busy={busy} onClose={() => setActivationOutcomeAttempt(null)} onRecord={(outcome) => { onRecordActivationOutcome(activationOutcomeAttempt, outcome); setActivationOutcomeAttempt(null); }} /> : null}
    </div>
  );
}
