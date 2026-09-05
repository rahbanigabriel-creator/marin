"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  LuChartNoAxesCombined,
  LuFileText,
  LuPlug,
  LuPanelLeftClose,
  LuPanelLeftOpen,
  LuPlus,
  LuRefreshCw,
  LuSparkles,
} from "react-icons/lu";

import type { ContentAssetDto } from "@/lib/content/types";
import type {
  PaidCampaignApprovalDto,
  PaidCampaignDraftDto,
  PaidCampaignOperationAttemptDto,
} from "@/lib/paid-drafts/dto";
import type { PaidLaunchTemplate } from "@/lib/paid-drafts/types";

import { PaidDraftEditor } from "./PaidDraftEditor";
import { PaidDraftGenerationDialog } from "./PaidDraftGenerationDialog";
import { PaidDraftReview } from "./PaidDraftReview";
import { MetaDeliverySettings } from "./MetaDeliverySettings";
import {
  PaidDraftRequestError,
  PaidDraftRequestLedger,
  approvePaidDraft,
  confirmPaidDraftProviderPaused,
  createPaidDraft,
  executePaidDraft,
  generatePaidDraft,
  loadPaidAssets,
  loadPaidConnections,
  loadPaidDraft,
  loadPaidDrafts,
  markPaidDraftReady,
  recordPaidDraftExternalActivationOutcome,
  reconcileMetaDraft,
  updatePaidDraft,
  uploadPaidAsset,
} from "./paid-draft-client";
import {
  PLATFORM_LABEL,
  createPaidDraftForm,
  formFromPaidDraft,
  paidDraftFormFingerprint,
  validatePaidDraftForm,
  type PaidConnectionOption,
  type PaidDraftFormIssue,
  type PaidDraftFormValue,
} from "./paid-draft-form";

const focusRing = "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-plum";

const STATE_LABEL: Record<PaidCampaignDraftDto["state"], string> = {
  draft: "Draft",
  ready: "Ready",
  creating_paused: "Creating paused",
  provider_paused: "Provider paused",
  activating: "Activating",
  activation_requested: "Activation requested",
  active: "Active",
  in_review: "In review",
  rejected: "Rejected",
  needs_reconciliation: "Needs reconciliation",
};

function sortDrafts(drafts: PaidCampaignDraftDto[]): PaidCampaignDraftDto[] {
  return [...drafts].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt) || right.id.localeCompare(left.id));
}

function replaceDraft(drafts: PaidCampaignDraftDto[], draft: PaidCampaignDraftDto): PaidCampaignDraftDto[] {
  return sortDrafts([draft, ...drafts.filter((item) => item.id !== draft.id)]);
}

export function PaidDraftWorkspace({
  onShowPerformance,
  onOpenConnections,
  canManage,
}: {
  onShowPerformance: () => void;
  onOpenConnections: () => void;
  canManage: boolean;
}): React.JSX.Element {
  const [drafts, setDrafts] = useState<PaidCampaignDraftDto[]>([]);
  const [connections, setConnections] = useState<PaidConnectionOption[]>([]);
  const [assets, setAssets] = useState<ContentAssetDto[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [form, setForm] = useState<PaidDraftFormValue | null>(null);
  const [baseline, setBaseline] = useState("");
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [uncertainDraftId, setUncertainDraftId] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [issues, setIssues] = useState<PaidDraftFormIssue[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [billingErrorMessage, setBillingErrorMessage] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [stateFilter, setStateFilter] = useState<"all" | PaidCampaignDraftDto["state"]>("all");
  const [search, setSearch] = useState("");
  const [draftsExpanded, setDraftsExpanded] = useState(false);
  const [generationOpen, setGenerationOpen] = useState(false);
  const [generationError, setGenerationError] = useState<string | null>(null);
  const requestIds = useRef(new PaidDraftRequestLedger());

  const actionRequestId = (key: string, prefix: string): string => {
    return requestIds.current.get(key, prefix);
  };

  const completeAction = (key: string): void => {
    requestIds.current.complete(key);
  };

  const selected = useMemo(
    () => selectedId ? drafts.find((draft) => draft.id === selectedId) ?? null : null,
    [drafts, selectedId],
  );
  const dirty = form ? paidDraftFormFingerprint(form) !== baseline : false;

  const selectDraft = useCallback((draft: PaidCampaignDraftDto) => {
    const nextForm = formFromPaidDraft(draft.snapshot);
    setSelectedId(draft.id);
    setDraftsExpanded(false);
    setCreating(false);
    setEditing(draft.state === "draft" && draft.capabilities.canEdit);
    setForm(nextForm);
    setBaseline(paidDraftFormFingerprint(nextForm));
    setIssues([]);
    setError(null);
    setNotice(null);
    setUncertainDraftId(null);
  }, []);

  const load = useCallback(async (preferredId?: string | null) => {
    setLoading(true);
    setError(null);
    try {
      const [incomingDrafts, incomingConnections, incomingAssets] = await Promise.all([
        loadPaidDrafts(),
        loadPaidConnections(),
        loadPaidAssets().catch(() => []),
      ]);
      const sorted = sortDrafts(incomingDrafts);
      setDrafts(sorted);
      setConnections(incomingConnections);
      setAssets(incomingAssets);
      const next = sorted.find((draft) => draft.id === preferredId) ?? sorted[0] ?? null;
      if (next) selectDraft(next);
      else {
        setSelectedId(null);
        setForm(null);
        setCreating(false);
        setEditing(false);
      }
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Paid campaign drafts could not be loaded.");
    } finally {
      setLoading(false);
    }
  }, [selectDraft]);

  useEffect(() => { void load(); }, [load]);

  const beginCreate = () => {
    if (!canManage) return;
    const connection = connections[0];
    if (!connection) {
      onOpenConnections();
      return;
    }
    const next = createPaidDraftForm(connection);
    setCreating(true);
    setDraftsExpanded(false);
    setEditing(true);
    setSelectedId(null);
    setForm(next);
    setBaseline("");
    setIssues([]);
    setError(null);
    setNotice(null);
  };

  const updateSelected = (draft: PaidCampaignDraftDto, showReview = false) => {
    setDrafts((current) => replaceDraft(current, draft));
    setSelectedId(draft.id);
    setCreating(false);
    setEditing(showReview ? false : draft.capabilities.canEdit);
    const nextForm = formFromPaidDraft(draft.snapshot);
    setForm(nextForm);
    setBaseline(paidDraftFormFingerprint(nextForm));
  };

  const recoverConflict = async (failure: PaidDraftRequestError) => {
    if (!selectedId || failure.status !== 409) return false;
    try {
      const current = await loadPaidDraft(selectedId);
      updateSelected(current, current.state !== "draft");
      setError(`${failure.message}. The latest saved version has been reloaded.`);
    } catch {
      setError(`${failure.message}. Reload the draft workspace before continuing.`);
    }
    return true;
  };

  const save = async () => {
    if (!form) return;
    const validation = validatePaidDraftForm(form);
    setIssues(validation.issues);
    if (!validation.snapshot) {
      setError(null);
      return;
    }
    const fingerprint = paidDraftFormFingerprint(form);
    const actionKey = creating
      ? `create:${fingerprint}`
      : `update:${selected?.id ?? "missing"}:${selected?.version ?? 0}:${fingerprint}`;
    const requestId = actionRequestId(actionKey, creating ? "draft-create" : "draft-update");
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const saved = creating
        ? await createPaidDraft({ requestId, connectionId: form.connection.id, snapshot: validation.snapshot })
        : selected
          ? await updatePaidDraft({ requestId, id: selected.id, expectedVersion: selected.version, snapshot: validation.snapshot })
          : null;
      if (!saved) return;
      completeAction(actionKey);
      updateSelected(saved);
      setNotice(creating ? "Campaign draft created. No provider action was taken." : `Draft v${saved.version} saved. Any earlier approval is no longer valid.`);
    } catch (saveError) {
      if (saveError instanceof PaidDraftRequestError && await recoverConflict(saveError)) return;
      const failure = saveError instanceof PaidDraftRequestError ? saveError : null;
      if (failure?.path) setIssues([{ path: failure.path, message: failure.message }]);
      setError(saveError instanceof Error ? saveError.message : "The paid campaign draft could not be saved.");
    } finally {
      setBusy(false);
    }
  };

  const markReady = async () => {
    if (!selected || dirty) return;
    const actionKey = `ready:${selected.id}:${selected.version}:${selected.snapshotHash}`;
    const requestId = actionRequestId(actionKey, "draft-ready");
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const ready = await markPaidDraftReady(selected, requestId);
      completeAction(actionKey);
      updateSelected(ready, true);
      setNotice(`Version ${ready.version} is ready. Review its exact hash before approving an operation.`);
    } catch (readyError) {
      if (readyError instanceof PaidDraftRequestError && await recoverConflict(readyError)) return;
      setError(readyError instanceof Error ? readyError.message : "The draft could not be marked ready.");
    } finally {
      setBusy(false);
    }
  };

  const approve = async (kind: "create_paused" | "activate") => {
    if (!selected) return;
    const actionKey = `approve:${kind}:${selected.id}:${selected.version}:${selected.snapshotHash}`;
    const requestId = actionRequestId(actionKey, `approve-${kind}`);
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const result = await approvePaidDraft(selected, kind, requestId);
      completeAction(actionKey);
      updateSelected(result.draft, true);
      setNotice(`${kind === "activate" ? "Activation" : "Create-paused"} approval bound to v${result.approval.snapshotVersion} and its exact snapshot hash.`);
    } catch (approvalError) {
      setBillingErrorMessage(approvalError instanceof PaidDraftRequestError && approvalError.status === 402 ? approvalError.message : null);
      if (approvalError instanceof PaidDraftRequestError && await recoverConflict(approvalError)) return;
      setError(approvalError instanceof Error ? approvalError.message : "Approval could not be recorded.");
    } finally {
      setBusy(false);
    }
  };

  const execute = async (approval: PaidCampaignApprovalDto) => {
    if (!selected) return;
    const actionKey = `execute:${approval.kind}:${selected.id}:${selected.version}:${selected.snapshotHash}:${approval.id}`;
    const requestId = actionRequestId(actionKey, `execute-${approval.kind}`);
    setBusy(true);
    setError(null);
    setNotice(null);
    const metaCreation = selected.snapshot.platform === "meta_ads" && Boolean(selected.snapshot.metaDelivery) && approval.kind === "create_paused";
    if (metaCreation) setUncertainDraftId(selected.id);
    try {
      const result = await executePaidDraft(selected, approval, requestId);
      completeAction(actionKey);
      updateSelected(result.draft, true);
      setUncertainDraftId(null);
      setNotice(result.attempt.providerOutcome?.kind === "assisted_handoff" && result.attempt.providerOutcome.providerSideEffect === "none"
        ? "Assisted handoff prepared. Marpin made no provider change and spent no budget."
        : result.attempt.status === "failed" && result.attempt.providerOutcome?.providerSideEffect === "none"
          ? "Meta made no provider changes. The approval was consumed; edit and mark ready before a fresh approval."
        : result.draft.state === "provider_paused" && result.draft.providerPausedConfirmation?.verificationStatus === "provider_verified"
          ? "Meta objects were verified paused. No activation was requested."
          : "The creation attempt was recorded but is not verified complete. Check the recorded objects below; do not create another campaign.");
    } catch (operationError) {
      setBillingErrorMessage(operationError instanceof PaidDraftRequestError && operationError.status === 402 ? operationError.message : null);
      if (metaCreation) {
        try {
          const latest = await loadPaidDraft(selected.id);
          updateSelected(latest, true);
          if (latest.attempts.some((attempt) => attempt.operation === "create_paused" && attempt.snapshotHash === selected.snapshotHash)) setUncertainDraftId(null);
        } catch { /* Keep execution blocked until the saved status is available. */ }
        setError(operationError instanceof Error ? operationError.message : "The Meta response was interrupted. Check saved status before continuing.");
        return;
      }
      if (operationError instanceof PaidDraftRequestError && await recoverConflict(operationError)) return;
      setError(operationError instanceof Error ? operationError.message : "The operation could not be prepared.");
    } finally {
      setBusy(false);
    }
  };

  const reconcileMeta = async () => {
    if (!selected || busy) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const result = await reconcileMetaDraft(selected.id);
      updateSelected(result.draft, true);
      setUncertainDraftId(null);
      setNotice(result.draft.state === "provider_paused" && result.draft.providerPausedConfirmation?.verificationStatus === "provider_verified"
        ? "Existing Meta objects verified paused. No new objects were created."
        : "Existing objects checked. Creation is still unresolved; no new objects were created.");
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Existing Meta objects could not be verified.");
    } finally { setBusy(false); }
  };

  const confirmProviderPaused = async (providerCampaignId: string) => {
    if (!selected) return;
    const actionKey = `provider-paused:${selected.id}:${selected.version}:${selected.snapshotHash}:${providerCampaignId}`;
    const requestId = actionRequestId(actionKey, "confirm-provider-paused");
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const confirmed = await confirmPaidDraftProviderPaused(
        selected,
        providerCampaignId,
        requestId,
      );
      completeAction(actionKey);
      updateSelected(confirmed, true);
      setNotice(`Campaign ${providerCampaignId} was recorded as paused at the provider. Activation still requires a separate approval.`);
    } catch (confirmationError) {
      if (
        confirmationError instanceof PaidDraftRequestError
        && await recoverConflict(confirmationError)
      ) return;
      setError(
        confirmationError instanceof Error
          ? confirmationError.message
          : "The paused provider campaign could not be confirmed.",
      );
    } finally {
      setBusy(false);
    }
  };

  const recordActivationOutcome = async (
    attempt: PaidCampaignOperationAttemptDto,
    outcome: "activated" | "not_activated",
  ) => {
    if (!selected) return;
    const actionKey = `activation-outcome:${selected.id}:${selected.version}:${selected.snapshotHash}:${attempt.id}:${outcome}`;
    const requestId = actionRequestId(actionKey, "record-activation-outcome");
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const recorded = await recordPaidDraftExternalActivationOutcome(
        selected,
        attempt,
        outcome,
        requestId,
      );
      completeAction(actionKey);
      updateSelected(recorded, true);
      setNotice(outcome === "activated"
        ? "External activation was recorded as a user assertion. Marpin did not verify it with the provider."
        : "The activation handoff was cancelled as not activated. You can request a new exact approval to retry.");
    } catch (outcomeError) {
      if (outcomeError instanceof PaidDraftRequestError && await recoverConflict(outcomeError)) return;
      setError(outcomeError instanceof Error ? outcomeError.message : "The external activation outcome could not be recorded.");
    } finally {
      setBusy(false);
    }
  };

  const upload = async (file: File) => {
    if (busy || uploading) return;
    setUploading(true);
    setError(null);
    try {
      const asset = await uploadPaidAsset(file);
      setAssets((current) => [asset, ...current.filter((item) => item.id !== asset.id)]);
      setForm((current) => {
        if (!current || current.connection.platform === "google_ads") return current;
        let assigned = false;
        return {
          ...current,
          adGroups: current.adGroups.map((group) => ({
            ...group,
            ads: group.ads.map((ad) => {
              if (assigned || ad.assetId) return ad;
              assigned = true;
              return { ...ad, assetId: asset.id, format: asset.kind };
            }),
          })),
        };
      });
      setNotice("Creative uploaded to the shared asset library and selected for the first empty ad.");
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : "The creative could not be uploaded.");
    } finally {
      setUploading(false);
    }
  };

  const generate = async (input: {
    connectionId: string;
    template: PaidLaunchTemplate;
    instruction: string;
  }) => {
    if (busy || uploading) return;
    const normalizedInstruction = input.instruction.trim();
    const actionKey = `generate:${input.connectionId}:${input.template}:${normalizedInstruction}`;
    const requestId = actionRequestId(actionKey, "draft-generate");
    setBusy(true);
    setGenerationError(null);
    setNotice(null);
    try {
      const result = await generatePaidDraft({ ...input, requestId });
      completeAction(actionKey);
      updateSelected(result.draft);
      setGenerationOpen(false);
      setNotice(`AI draft created with ${result.credits} credit${result.credits === 1 ? "" : "s"}. Review and edit every field before marking it ready. No provider action was taken.`);
    } catch (generationError) {
      setGenerationError(generationError instanceof Error ? generationError.message : "The AI campaign draft could not be generated.");
    } finally {
      setBusy(false);
    }
  };

  const filteredDrafts = useMemo(() => {
    const query = search.trim().toLowerCase();
    return drafts.filter((draft) =>
      (stateFilter === "all" || draft.state === stateFilter)
      && (!query
        || draft.snapshot.campaign.name.toLowerCase().includes(query)
        || draft.connection.accountName.toLowerCase().includes(query)
        || PLATFORM_LABEL[draft.platform].toLowerCase().includes(query)),
    );
  }, [drafts, search, stateFilter]);

  return (
    <section className="flex min-h-0 min-w-0 w-full flex-1 flex-col overflow-hidden bg-surface-panel" aria-labelledby="paid-drafts-title">
      <header className="flex-none border-b border-line-2 bg-surface-panel px-[14px] py-[13px] sm:px-[20px] lg:px-[24px]">
        <div className="flex min-w-0 flex-wrap items-center justify-between gap-[12px]">
          <div><p className="m-0 font-mono text-[9.5px] font-semibold uppercase tracking-[0.08em] text-ink-300">Paid campaigns</p><h1 id="paid-drafts-title" className="mb-0 mt-[2px] text-[20px] font-semibold text-ink-900">Campaign drafts</h1></div>
          <div className="flex flex-wrap items-center gap-[7px]">
            <button type="button" aria-label={draftsExpanded ? "Hide saved campaign drafts" : "Show saved campaign drafts"} title={draftsExpanded ? "Hide saved campaign drafts" : "Show saved campaign drafts"} aria-expanded={draftsExpanded} aria-controls="saved-paid-drafts" onClick={() => setDraftsExpanded(!draftsExpanded)} className={`grid h-[36px] w-[36px] place-items-center rounded-[7px] border border-line-1 bg-surface-card text-ink-600 ${focusRing}`}>{draftsExpanded ? <LuPanelLeftClose aria-hidden /> : <LuPanelLeftOpen aria-hidden />}</button>
            <button type="button" aria-label="Refresh campaign drafts" disabled={loading || busy} onClick={() => void load(selectedId)} className={`grid h-[36px] w-[36px] place-items-center rounded-[7px] border border-line-1 bg-surface-card text-ink-600 disabled:opacity-45 ${focusRing}`}><LuRefreshCw aria-hidden className={loading ? "animate-spin" : ""} /></button>
            <button type="button" onClick={onOpenConnections} className={`inline-flex h-[36px] items-center gap-[6px] rounded-[7px] border border-line-1 bg-surface-card px-[11px] text-[11.5px] font-semibold text-ink-700 ${focusRing}`}><LuPlug aria-hidden /> Accounts</button>
            <button type="button" disabled={!canManage || !connections.length || busy || uploading} title={uploading ? "Wait for the creative upload to finish" : undefined} onClick={() => { setGenerationError(null); setGenerationOpen(true); }} className={`inline-flex h-[36px] items-center gap-[6px] rounded-[7px] border border-plum-border bg-plum-soft px-[11px] text-[11.5px] font-semibold text-plum-deep disabled:cursor-not-allowed disabled:opacity-45 ${focusRing}`}><LuSparkles aria-hidden /> Generate draft</button>
            <button type="button" disabled={!canManage || !connections.length || busy} onClick={beginCreate} className={`inline-flex h-[36px] items-center gap-[6px] rounded-[7px] bg-plum px-[12px] text-[12px] font-semibold text-white disabled:cursor-not-allowed disabled:opacity-45 ${focusRing}`}><LuPlus aria-hidden /> New draft</button>
          </div>
        </div>
        <div className="mt-[12px] inline-grid h-[36px] grid-cols-2 rounded-[8px] bg-track-1 p-[3px]" aria-label="Paid workspace view">
          <button type="button" onClick={onShowPerformance} className={`flex min-w-[112px] items-center justify-center gap-[6px] rounded-[6px] px-[10px] text-[12px] font-semibold text-ink-400 ${focusRing}`}><LuChartNoAxesCombined aria-hidden /> Performance</button>
          <button type="button" aria-pressed="true" className={`flex min-w-[112px] items-center justify-center gap-[6px] rounded-[6px] bg-surface-card px-[10px] text-[12px] font-semibold text-ink-900 shadow-sm ${focusRing}`}><LuFileText aria-hidden /> Drafts</button>
        </div>
      </header>

      {error ? <div role="alert" className="mx-[14px] mt-[10px] border-l-[3px] border-neg-700 bg-neg-bg px-[12px] py-[9px] text-[12px] text-neg-700 sm:mx-[20px]">{error}{billingErrorMessage === error ? <> <a href="/settings/billing" className={`font-semibold underline underline-offset-2 ${focusRing}`}>Review plan</a></> : null}</div> : null}
      {notice ? <div role="status" aria-live="polite" className="mx-[14px] mt-[10px] border-l-[3px] border-pos-500 bg-pos-bg px-[12px] py-[9px] text-[12px] text-pos-700 sm:mx-[20px]">{notice}</div> : null}

      <div className={`grid min-h-0 flex-1 grid-cols-1 overflow-hidden ${draftsExpanded ? "lg:grid-cols-[300px_minmax(0,1fr)]" : "lg:grid-cols-[44px_minmax(0,1fr)]"}`}>
        {!draftsExpanded ? <div className="hidden border-r border-line-2 bg-surface-card px-1 pt-3 lg:block"><button type="button" aria-label="Open saved drafts" title="Open saved drafts" onClick={() => setDraftsExpanded(true)} className={`grid h-9 w-9 place-items-center rounded-[6px] text-ink-500 hover:bg-track-1 ${focusRing}`}><LuPanelLeftOpen aria-hidden /></button></div> : null}
        <aside id="saved-paid-drafts" className={`${draftsExpanded ? "" : "hidden"} min-h-0 border-b border-line-2 bg-surface-card lg:border-b-0 lg:border-r`} aria-label="Saved campaign drafts">
          <div className="grid grid-cols-[minmax(0,1fr)_112px] gap-[7px] border-b border-line-2 p-[11px]">
            <label className="min-w-0"><span className="sr-only">Search campaign drafts</span><input type="search" aria-label="Search campaign drafts" placeholder="Search drafts" value={search} onChange={(event) => setSearch(event.target.value)} className={`w-full min-w-0 rounded-[7px] border border-line-1 bg-surface-card px-[9px] py-[7px] text-[12px] outline-none focus:border-plum-border ${focusRing}`} /></label>
            <label><span className="sr-only">Filter campaign draft state</span><select aria-label="Filter campaign draft state" value={stateFilter} onChange={(event) => setStateFilter(event.target.value as typeof stateFilter)} className={`w-full rounded-[7px] border border-line-1 bg-surface-card px-[8px] py-[7px] text-[11px] text-ink-600 outline-none ${focusRing}`}><option value="all">All states</option><option value="draft">Draft</option><option value="ready">Ready</option><option value="provider_paused">Paused</option><option value="active">Active</option><option value="needs_reconciliation">Reconcile</option></select></label>
          </div>
          <div className="max-h-[250px] overflow-y-auto p-[7px] lg:h-[calc(100%-58px)] lg:max-h-none">
            {loading ? <p role="status" className="m-0 p-[12px] text-[12px] text-ink-400">Loading drafts…</p> : null}
            {!loading && !filteredDrafts.length ? <div className="p-[13px]"><p className="m-0 text-[12px] text-ink-400">{drafts.length ? "No drafts match this filter." : "No campaign drafts yet."}</p>{!connections.length ? <button type="button" onClick={onOpenConnections} className={`mt-[10px] inline-flex items-center gap-[5px] border-0 bg-transparent p-0 text-[11.5px] font-semibold text-plum ${focusRing}`}><LuPlug aria-hidden /> Connect a paid account</button> : null}</div> : null}
            <div className="grid gap-[4px]">
              {filteredDrafts.map((draft) => {
                const active = draft.id === selectedId && !creating;
                return <button key={draft.id} type="button" aria-pressed={active} onClick={() => selectDraft(draft)} className={`min-w-0 rounded-[7px] border px-[10px] py-[9px] text-left ${focusRing} ${active ? "border-plum-border bg-plum-soft" : "border-transparent hover:border-line-2 hover:bg-track-1"}`}><span className="block truncate text-[12.5px] font-semibold text-ink-900">{draft.snapshot.campaign.name}</span><span className="mt-[4px] flex min-w-0 items-center justify-between gap-[6px] text-[10.5px] text-ink-400"><span className="truncate">{PLATFORM_LABEL[draft.platform]} · {draft.connection.accountName}</span><span className="flex-none">v{draft.version}</span></span><span className="mt-[3px] block text-[10px] font-semibold text-ink-500">{STATE_LABEL[draft.state]}</span></button>;
              })}
            </div>
          </div>
        </aside>

        <div role="region" aria-label="Paid campaign draft editor" className="min-h-0 overflow-y-auto px-[14px] py-[16px] sm:px-[20px] lg:px-[26px] lg:py-[22px]">
          {!connections.length && !loading ? <div className="grid min-h-[360px] place-items-center text-center"><div><LuPlug aria-hidden className="mx-auto h-[25px] w-[25px] text-ink-300" /><h2 className="mb-0 mt-[9px] text-[17px] font-semibold text-ink-900">Connect a paid account first</h2><p className="mx-auto mb-0 mt-[6px] max-w-[420px] text-[12px] leading-[1.55] text-ink-400">Drafts are bound to one exact Google Ads or Meta Ads account.</p><button type="button" onClick={onOpenConnections} className={`mt-[13px] h-[36px] rounded-[7px] bg-plum px-[13px] text-[12px] font-semibold text-white ${focusRing}`}>Manage connections</button></div></div> : null}
          {connections.length && !form && !loading ? <div className="grid min-h-[360px] place-items-center text-center"><div><LuFileText aria-hidden className="mx-auto h-[25px] w-[25px] text-ink-300" /><h2 className="mb-0 mt-[9px] text-[17px] font-semibold text-ink-900">{canManage ? "Create a manual campaign draft" : "No campaign drafts yet"}</h2><p className="mx-auto mb-0 mt-[6px] max-w-[420px] text-[12px] leading-[1.55] text-ink-400">{canManage ? "Prepare a versioned campaign without changing any provider account." : "This workspace is read-only for your role. An owner or admin can prepare the first paid draft."}</p>{canManage ? <button type="button" onClick={beginCreate} className={`mt-[13px] inline-flex h-[36px] items-center gap-[6px] rounded-[7px] bg-plum px-[13px] text-[12px] font-semibold text-white ${focusRing}`}><LuPlus aria-hidden /> Create first draft</button> : null}</div></div> : null}
          {form && (creating || editing) ? <PaidDraftEditor value={form} connections={connections} assets={assets} issues={issues} isNew={creating} disabled={busy || !canManage || (!creating && !selected?.capabilities.canEdit)} saving={busy} uploading={uploading} dirty={dirty} onChange={(next) => { setForm(next); setIssues([]); }} onConnectionChange={(connectionId) => { const connection = connections.find((item) => item.id === connectionId); if (connection) setForm(createPaidDraftForm(connection)); }} onTemplateChange={(template: PaidLaunchTemplate) => { if (form) setForm({ ...form, template }); }} onSave={() => void save()} onReady={() => void markReady()} canMarkReady={canManage && Boolean(selected?.capabilities.canMarkReady)} onUpload={(file) => void upload(file)} deliverySettings={form.connection.platform === "meta_ads" ? <MetaDeliverySettings key={`${selectedId ?? "new"}:${form.connection.id}`} value={form} disabled={busy || !canManage || (!creating && !selected?.capabilities.canEdit)} onChange={(next) => { setForm(next); setIssues([]); }} onConnect={() => !dirty || window.confirm("This draft has unsaved changes. Continue to Meta permissions in a new tab? Nothing will be saved automatically. Cancel to save a regular draft first.")} /> : undefined} /> : null}
          {selected && !creating && !editing ? <PaidDraftReview key={selected.id} draft={selected} busy={busy} executionUncertain={uncertainDraftId === selected.id} onReconcileMeta={() => void reconcileMeta()} onEdit={() => { setDraftsExpanded(false); setEditing(true); }} onApprove={(kind) => void approve(kind)} onExecute={(approval) => void execute(approval)} onConfirmProviderPaused={(providerCampaignId) => void confirmProviderPaused(providerCampaignId)} onRecordActivationOutcome={(attempt, outcome) => void recordActivationOutcome(attempt, outcome)} /> : null}
        </div>
      </div>
      {generationOpen ? <PaidDraftGenerationDialog connections={connections} busy={busy} error={generationError} onClose={() => { setGenerationOpen(false); setGenerationError(null); }} onGenerate={(input) => void generate(input)} /> : null}
    </section>
  );
}
