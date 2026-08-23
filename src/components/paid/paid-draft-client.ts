import type { ContentAssetDto } from "@/lib/content/types";
import type {
  PaidCampaignDraftDto,
  PaidCampaignOperationAttemptDto,
  PaidCampaignApprovalDto,
} from "@/lib/paid-drafts/dto";
import type { PaidCampaignSnapshotV1 } from "@/lib/paid-drafts/types";
import type { PaidLaunchTemplate } from "@/lib/paid-drafts/types";
import { PROVIDER_PAUSED_CONFIRMATION } from "@/lib/paid-drafts/parsers";
import { MAX_ASSET_BYTES, MAX_SERVER_ASSET_BYTES } from "@/lib/storage/limits";

import type { PaidConnectionOption } from "./paid-draft-form";

interface ApiFailure {
  error?: string;
  code?: string;
  message?: string;
  path?: string;
  currentVersion?: number;
}

export class PaidDraftRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
    readonly path?: string,
    readonly currentVersion?: number,
  ) {
    super(message);
    this.name = "PaidDraftRequestError";
  }
}

async function responseJson<T>(response: Response): Promise<T> {
  const payload = await response.json().catch(() => ({})) as T & ApiFailure;
  if (!response.ok) {
    throw new PaidDraftRequestError(
      payload.message ?? payload.error ?? `Request failed (${response.status})`,
      response.status,
      payload.code ?? payload.error,
      payload.path,
      payload.currentVersion,
    );
  }
  return payload;
}

export function newPaidDraftRequestId(prefix: string): string {
  const id = typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `${prefix}-${id}`.slice(0, 120);
}

/** Keeps one replay identity per semantic browser action until it succeeds. */
export class PaidDraftRequestLedger {
  private readonly ids = new Map<string, string>();

  get(actionKey: string, prefix: string): string {
    const existing = this.ids.get(actionKey);
    if (existing) return existing;
    const created = newPaidDraftRequestId(prefix);
    this.ids.set(actionKey, created);
    return created;
  }

  complete(actionKey: string): void {
    this.ids.delete(actionKey);
  }
}

export async function loadPaidDrafts(): Promise<PaidCampaignDraftDto[]> {
  const payload = await fetch("/api/paid/drafts?limit=100", { cache: "no-store" })
    .then((response) => responseJson<{ drafts?: PaidCampaignDraftDto[] }>(response));
  return Array.isArray(payload.drafts) ? payload.drafts : [];
}

export async function loadPaidDraft(id: string): Promise<PaidCampaignDraftDto> {
  const payload = await fetch(`/api/paid/drafts/${encodeURIComponent(id)}`, { cache: "no-store" })
    .then((response) => responseJson<{ draft: PaidCampaignDraftDto }>(response));
  return payload.draft;
}

export async function loadPaidConnections(): Promise<PaidConnectionOption[]> {
  const payload = await fetch("/api/connections", { cache: "no-store" })
    .then((response) => responseJson<{ accounts?: Array<Record<string, unknown>> }>(response));
  const paidPlatforms = new Set(["google_ads", "meta_ads", "tiktok_ads"]);
  return (payload.accounts ?? []).flatMap((account) => {
    const platform = account.connectorPlatform;
    if (
      !paidPlatforms.has(String(platform))
      || account.status !== "connected"
      || typeof account.connectionId !== "string"
      || typeof account.externalAccountId !== "string"
    ) {
      return [];
    }
    return [{
      id: account.connectionId,
      platform: platform as PaidConnectionOption["platform"],
      accountId: account.externalAccountId,
      accountName: typeof account.displayName === "string" && account.displayName.trim()
        ? account.displayName
        : account.externalAccountId,
      currency: typeof account.currency === "string" ? account.currency : null,
      timezone: typeof account.timezone === "string" ? account.timezone : null,
    }];
  });
}

export async function loadPaidAssets(): Promise<ContentAssetDto[]> {
  const payload = await fetch("/api/assets", { cache: "no-store" })
    .then((response) => responseJson<{ assets?: ContentAssetDto[] }>(response));
  return Array.isArray(payload.assets) ? payload.assets : [];
}

export async function uploadPaidAsset(file: File): Promise<ContentAssetDto> {
  if (file.size <= 0 || file.size > MAX_ASSET_BYTES) {
    throw new PaidDraftRequestError("Choose a file between 1 byte and 30 MB.", 400);
  }
  const byExtension: Record<string, string> = {
    gif: "image/gif", jpeg: "image/jpeg", jpg: "image/jpeg", mov: "video/quicktime",
    mp4: "video/mp4", png: "image/png", webm: "video/webm", webp: "image/webp",
  };
  const claimed = file.type.trim().toLowerCase();
  const mimeType = [
    "image/gif", "image/jpeg", "image/png", "image/webp",
    "video/mp4", "video/quicktime", "video/webm",
  ].includes(claimed)
    ? claimed
    : byExtension[file.name.split(".").pop()?.toLowerCase() ?? ""];
  if (!mimeType) {
    throw new PaidDraftRequestError("Use a PNG, JPEG, WebP, GIF, MP4, MOV, or WebM file.", 400);
  }
  if (file.size > MAX_SERVER_ASSET_BYTES) {
    const reservation = await fetch("/api/assets/reservations", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ filename: file.name, bytes: file.size, mimeType }),
    }).then((response) => responseJson<{
      reservationId: string;
      pathname: string;
      uploadUrl: string;
    }>(response));
    const upload = await fetch(reservation.uploadUrl, {
      method: "PUT",
      headers: { "Content-Type": mimeType },
      body: file,
    });
    if (!upload.ok) {
      throw new PaidDraftRequestError(`The private media upload failed (${upload.status}).`, upload.status);
    }
    let lastFailure: unknown = null;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        const completed = await fetch(
          `/api/assets/reservations/${encodeURIComponent(reservation.reservationId)}/complete`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json", Accept: "application/json" },
            body: JSON.stringify({ pathname: reservation.pathname }),
          },
        ).then((response) => responseJson<{ asset: ContentAssetDto }>(response));
        return completed.asset;
      } catch (error) {
        lastFailure = error;
        if (!(error instanceof PaidDraftRequestError) || error.status !== 503) break;
        await new Promise((resolve) => globalThis.setTimeout(resolve, 350 * (attempt + 1)));
      }
    }
    throw lastFailure instanceof Error
      ? lastFailure
      : new PaidDraftRequestError("The media upload could not be completed.", 503);
  }
  const form = new FormData();
  form.set("file", file);
  const payload = await fetch("/api/assets", { method: "POST", body: form })
    .then((response) => responseJson<{ asset?: ContentAssetDto; reason?: string }>(response));
  if (!payload.asset) {
    throw new PaidDraftRequestError(payload.reason ?? "The asset upload did not finish.", 500);
  }
  return payload.asset;
}

export async function createPaidDraft(input: {
  requestId: string;
  connectionId: string;
  snapshot: PaidCampaignSnapshotV1;
}): Promise<PaidCampaignDraftDto> {
  const payload = await fetch("/api/paid/drafts", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      requestId: input.requestId,
      connectionId: input.connectionId,
      snapshot: input.snapshot,
    }),
  }).then((response) => responseJson<{ draft: PaidCampaignDraftDto }>(response));
  return payload.draft;
}

export async function generatePaidDraft(input: {
  requestId: string;
  connectionId: string;
  template: PaidLaunchTemplate;
  instruction: string;
}): Promise<{ draft: PaidCampaignDraftDto; credits: number; model: string }> {
  return fetch("/api/paid/drafts/generate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      requestId: input.requestId,
      connectionId: input.connectionId,
      template: input.template,
      instruction: input.instruction.trim() || null,
    }),
  }).then((response) => responseJson<{
    draft: PaidCampaignDraftDto;
    credits: number;
    model: string;
  }>(response));
}

export async function updatePaidDraft(input: {
  requestId: string;
  id: string;
  expectedVersion: number;
  snapshot: PaidCampaignSnapshotV1;
}): Promise<PaidCampaignDraftDto> {
  const payload = await fetch(`/api/paid/drafts/${encodeURIComponent(input.id)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      requestId: input.requestId,
      expectedVersion: input.expectedVersion,
      snapshot: input.snapshot,
    }),
  }).then((response) => responseJson<{ draft: PaidCampaignDraftDto }>(response));
  return payload.draft;
}

export async function markPaidDraftReady(
  draft: PaidCampaignDraftDto,
  requestId: string,
): Promise<PaidCampaignDraftDto> {
  const payload = await fetch(`/api/paid/drafts/${encodeURIComponent(draft.id)}/ready`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      requestId,
      expectedVersion: draft.version,
      snapshotHash: draft.snapshotHash,
    }),
  }).then((response) => responseJson<{ draft: PaidCampaignDraftDto }>(response));
  return payload.draft;
}

export async function approvePaidDraft(
  draft: PaidCampaignDraftDto,
  kind: "create_paused" | "activate",
  requestId: string,
): Promise<{ draft: PaidCampaignDraftDto; approval: PaidCampaignApprovalDto }> {
  return fetch(`/api/paid/drafts/${encodeURIComponent(draft.id)}/approvals`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      requestId,
      kind,
      expectedVersion: draft.version,
      snapshotHash: draft.snapshotHash,
    }),
  }).then((response) => responseJson<{
    draft: PaidCampaignDraftDto;
    approval: PaidCampaignApprovalDto;
  }>(response));
}

export async function executePaidDraft(
  draft: PaidCampaignDraftDto,
  approval: PaidCampaignApprovalDto,
  requestId: string,
): Promise<{ draft: PaidCampaignDraftDto; attempt: PaidCampaignOperationAttemptDto }> {
  return fetch(`/api/paid/drafts/${encodeURIComponent(draft.id)}/operations`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      requestId,
      approvalId: approval.id,
      operation: approval.kind,
      expectedVersion: draft.version,
      snapshotHash: draft.snapshotHash,
    }),
  }).then((response) => responseJson<{
    draft: PaidCampaignDraftDto;
    attempt: PaidCampaignOperationAttemptDto;
  }>(response));
}

export async function confirmPaidDraftProviderPaused(
  draft: PaidCampaignDraftDto,
  providerCampaignId: string,
  requestId: string,
): Promise<PaidCampaignDraftDto> {
  const payload = await fetch(
    `/api/paid/drafts/${encodeURIComponent(draft.id)}/provider-paused`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        requestId,
        expectedVersion: draft.version,
        snapshotHash: draft.snapshotHash,
        providerCampaignId,
        confirmation: PROVIDER_PAUSED_CONFIRMATION,
      }),
    },
  ).then((response) => responseJson<{ draft: PaidCampaignDraftDto }>(response));
  return payload.draft;
}

export async function recordPaidDraftExternalActivationOutcome(
  draft: PaidCampaignDraftDto,
  attempt: PaidCampaignOperationAttemptDto,
  outcome: "activated" | "not_activated",
  requestId: string,
): Promise<PaidCampaignDraftDto> {
  const payload = await fetch(
    `/api/paid/drafts/${encodeURIComponent(draft.id)}/activation-outcome`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        requestId,
        expectedVersion: draft.version,
        snapshotHash: draft.snapshotHash,
        attemptId: attempt.id,
        outcome,
      }),
    },
  ).then((response) => responseJson<{ draft: PaidCampaignDraftDto }>(response));
  return payload.draft;
}
