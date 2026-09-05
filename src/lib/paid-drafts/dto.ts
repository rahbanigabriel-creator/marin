import type { WorkspaceRole } from "@/lib/auth";
import {
  paidDraftCapabilities,
  type PaidConnectionWriteAccess,
  type PaidDraftCapabilities,
} from "./capabilities";
import type {
  PaidCampaignSnapshotV1,
  PaidDraftState,
  PaidPlatform,
} from "./types";
import { parsePaidCampaignSnapshotV1 } from "./validation";
import type { MetaCreationOutcome } from "./meta-paused-execution";

export interface PaidAssistedHandoffDto {
  kind: "assisted_handoff";
  providerSideEffect: "none";
  message: string;
  nextSteps: string[];
}

export interface PaidExternalActivationOutcomeDto {
  kind: "external_activation_outcome";
  providerSideEffect: "user_asserted_unverified";
  outcome: "activated" | "not_activated";
  message: string;
}

export type PaidProviderOutcomeDto =
  | PaidAssistedHandoffDto
  | MetaCreationOutcome
  | PaidExternalActivationOutcomeDto;

export interface PaidCampaignOperationAttemptDto {
  id: string;
  approvalId: string;
  operation: "create_paused" | "activate";
  snapshotVersion: number;
  snapshotHash: string;
  status: "assisted_handoff" | "running" | "succeeded" | "failed" | "needs_reconciliation";
  capabilityReason: string;
  providerOutcome: PaidProviderOutcomeDto | null;
  attemptedAt: string;
}

export interface PaidCampaignApprovalDto {
  id: string;
  kind: "create_paused" | "activate";
  snapshotVersion: number;
  snapshotHash: string;
  status: "approved" | "consumed";
  approvedAt: string;
  consumedByAttemptId: string | null;
}

export interface PaidProviderPausedConfirmationDto {
  providerCampaignId: string;
  verificationStatus: "user_asserted_unverified" | "provider_verified";
  snapshotVersion: number;
  snapshotHash: string;
  confirmedAt: string;
}

export interface PaidCampaignDraftCapabilityDto {
  canManage: boolean;
  canEdit: boolean;
  canMarkReady: boolean;
  canApproveCreatePaused: boolean;
  canConfirmProviderPaused?: boolean;
  canApproveActivation: boolean;
  canRecordExternalActivationOutcome?: boolean;
  execution: PaidDraftCapabilities;
}

export interface PaidCampaignDraftDto {
  id: string;
  platform: PaidPlatform;
  connection: PaidCampaignSnapshotV1["connection"];
  source: PaidCampaignSnapshotV1["source"];
  template: PaidCampaignSnapshotV1["template"];
  state: PaidDraftState;
  snapshot: PaidCampaignSnapshotV1;
  snapshotHash: string;
  version: number;
  readyAt: string | null;
  createdAt: string;
  updatedAt: string;
  capabilities: PaidCampaignDraftCapabilityDto;
  providerPausedConfirmation?: PaidProviderPausedConfirmationDto | null;
  approvals: PaidCampaignApprovalDto[];
  attempts: PaidCampaignOperationAttemptDto[];
}

export interface PaidDraftAttemptRecord {
  id: string;
  approvalId: string;
  operation: string;
  snapshotVersion: number;
  snapshotHash: string;
  status: string;
  capabilityReason: string;
  providerOutcome: unknown;
  attemptedAt: Date;
}

export interface PaidDraftApprovalRecord {
  id: string;
  kind: string;
  snapshotVersion: number;
  snapshotHash: string;
  approvedAt: Date;
  attempt: { id: string } | null;
}

export interface PaidDraftRecord {
  id: string;
  platform: string;
  connectionId: string | null;
  accountId: string;
  accountName: string;
  source: string;
  template: string;
  state: string;
  snapshot: unknown;
  snapshotHash: string;
  version: number;
  readyAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  providerPausedConfirmation: {
    providerCampaignId: string;
    verificationStatus: string;
    snapshotVersion: number;
    snapshotHash: string;
    confirmedAt: Date;
  } | null;
  approvals: PaidDraftApprovalRecord[];
  attempts: PaidDraftAttemptRecord[];
}

function canManage(role: WorkspaceRole): boolean {
  return role === "owner" || role === "admin";
}

function operation(value: string): "create_paused" | "activate" {
  return value === "activate" ? "activate" : "create_paused";
}

function attemptStatus(
  value: string,
): PaidCampaignOperationAttemptDto["status"] {
  if (value === "running" || value === "succeeded" || value === "failed" || value === "needs_reconciliation") {
    return value;
  }
  return "assisted_handoff";
}

function metaStepKey(key: string, kind: MetaCreationOutcome["steps"][number]["kind"]): boolean {
  if (kind === "campaign" || kind === "adset") return key === kind;
  const prefix = `${kind}:`;
  const identifier = key.slice(prefix.length);
  // Match snapshot identifiers (191 characters) plus the engine's step prefix (up to 9).
  return key.startsWith(prefix) && identifier.length <= 191
    && /^[A-Za-z0-9]/.test(identifier) && !/[^A-Za-z0-9._:-]/.test(identifier);
}

export function paidProviderOutcome(value: unknown): PaidProviderOutcomeDto | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  if (row.kind === "meta_paused_creation"
    && (row.providerSideEffect === "paused_objects" || row.providerSideEffect === "possible" || row.providerSideEffect === "none")
    && Array.isArray(row.steps) && row.steps.length <= 20 && typeof row.message === "string") {
    const steps: MetaCreationOutcome["steps"] = [];
    for (const raw of row.steps) {
      if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
      const step = raw as Record<string, unknown>;
      if (typeof step.key !== "string"
        || (step.kind !== "campaign" && step.kind !== "image" && step.kind !== "adset" && step.kind !== "creative" && step.kind !== "ad")
        || (step.status !== "submitting" && step.status !== "created")
        || !metaStepKey(step.key, step.kind)) return null;
      if (step.id !== undefined && (typeof step.id !== "string" || !(step.kind === "image" ? /^[a-fA-F0-9]{32}$/ : /^\d{1,32}$/).test(step.id))) return null;
      steps.push({ key: step.key, kind: step.kind as MetaCreationOutcome["steps"][number]["kind"], status: step.status as "submitting" | "created", ...(step.id ? { id: step.id as string } : {}) });
    }
    return {
      kind: "meta_paused_creation", providerSideEffect: row.providerSideEffect, steps,
      message: row.message.slice(0, 500),
      ...(typeof row.campaignId === "string" && /^\d{1,32}$/.test(row.campaignId) ? { campaignId: row.campaignId } : {}),
      ...(typeof row.code === "string" && /^[a-z_]{1,100}$/.test(row.code) ? { code: row.code } : {}),
      ...(typeof row.verifiedAt === "string" && Number.isFinite(Date.parse(row.verifiedAt)) ? { verifiedAt: row.verifiedAt } : {}),
    };
  }
  if (row.kind === "assisted_handoff") {
    if (
      row.providerSideEffect !== "none" ||
      typeof row.message !== "string" ||
      !Array.isArray(row.nextSteps)
    ) {
      return null;
    }
    const nextSteps = row.nextSteps.filter(
      (item): item is string => typeof item === "string",
    ).slice(0, 5);
    return {
      kind: "assisted_handoff",
      providerSideEffect: "none",
      message: row.message.slice(0, 500),
      nextSteps: nextSteps.map((item) => item.slice(0, 300)),
    };
  }
  if (
    row.kind === "external_activation_outcome" &&
    row.providerSideEffect === "user_asserted_unverified" &&
    (row.outcome === "activated" || row.outcome === "not_activated") &&
    typeof row.message === "string"
  ) {
    return {
      kind: "external_activation_outcome",
      providerSideEffect: "user_asserted_unverified",
      outcome: row.outcome,
      message: row.message.slice(0, 500),
    };
  }
  return null;
}

function canConfirmProviderPaused(input: PaidDraftRecord): boolean {
  return input.attempts.some((attempt) => {
    const outcome = paidProviderOutcome(attempt.providerOutcome);
    return (
      attempt.operation === "create_paused" &&
      attempt.status === "assisted_handoff" &&
      attempt.snapshotVersion === input.version &&
      attempt.snapshotHash === input.snapshotHash &&
      outcome?.providerSideEffect === "none"
    );
  });
}

function canRecordExternalActivationOutcome(input: PaidDraftRecord): boolean {
  return input.state === "provider_paused" && input.attempts.some((attempt) => {
    const outcome = paidProviderOutcome(attempt.providerOutcome);
    return (
      attempt.operation === "activate" &&
      attempt.status === "assisted_handoff" &&
      attempt.snapshotVersion === input.version &&
      attempt.snapshotHash === input.snapshotHash &&
      outcome?.kind === "assisted_handoff" &&
      outcome.providerSideEffect === "none"
    );
  });
}

export function toPaidCampaignDraftDto(input: {
  row: PaidDraftRecord;
  actorRole: WorkspaceRole;
  writeAccess: PaidConnectionWriteAccess;
}): PaidCampaignDraftDto {
  const snapshot = parsePaidCampaignSnapshotV1(input.row.snapshot, {
    expectedPlatform: input.writeAccess.platform,
    expectedConnectionId: input.writeAccess.connectionId,
    expectedAccountId: input.writeAccess.accountId,
  });
  const state = input.row.state as PaidDraftState;
  const manager = canManage(input.actorRole);
  const pendingExternalActivationOutcome = canRecordExternalActivationOutcome(input.row);
  let execution = paidDraftCapabilities(input.writeAccess);
  if (snapshot.platform === "meta_ads" && snapshot.metaDelivery && input.writeAccess.oauthConnected) {
    execution = { ...execution, mode: "provider_checked", createPaused: { operation: "create_paused", path: "provider_checked", canExecuteProvider: true, assistedHandoffAvailable: true, reason: "provider_preflight_required" } };
  }
  return {
    id: input.row.id,
    platform: snapshot.platform,
    connection: snapshot.connection,
    source: snapshot.source,
    template: snapshot.template,
    state,
    snapshot,
    snapshotHash: input.row.snapshotHash,
    version: input.row.version,
    readyAt: input.row.readyAt?.toISOString() ?? null,
    createdAt: input.row.createdAt.toISOString(),
    updatedAt: input.row.updatedAt.toISOString(),
    capabilities: {
      canManage: manager,
      canEdit: manager && (state === "draft" || (state === "ready" && input.row.attempts.length === 0)),
      canMarkReady: manager && state === "draft",
      canApproveCreatePaused: manager && state === "ready",
      canConfirmProviderPaused:
        manager &&
        state === "ready" &&
        input.row.providerPausedConfirmation === null &&
        canConfirmProviderPaused(input.row),
      canApproveActivation:
        manager && state === "provider_paused" && !pendingExternalActivationOutcome,
      canRecordExternalActivationOutcome:
        manager && pendingExternalActivationOutcome,
      execution,
    },
    providerPausedConfirmation: input.row.providerPausedConfirmation
      ? {
          providerCampaignId:
            input.row.providerPausedConfirmation.providerCampaignId,
          verificationStatus: input.row.providerPausedConfirmation.verificationStatus === "provider_verified" ? "provider_verified" : "user_asserted_unverified",
          snapshotVersion:
            input.row.providerPausedConfirmation.snapshotVersion,
          snapshotHash: input.row.providerPausedConfirmation.snapshotHash,
          confirmedAt:
            input.row.providerPausedConfirmation.confirmedAt.toISOString(),
        }
      : null,
    approvals: input.row.approvals.map((approval) => ({
      id: approval.id,
      kind: operation(approval.kind),
      snapshotVersion: approval.snapshotVersion,
      snapshotHash: approval.snapshotHash,
      status: approval.attempt ? "consumed" : "approved",
      approvedAt: approval.approvedAt.toISOString(),
      consumedByAttemptId: approval.attempt?.id ?? null,
    })),
    attempts: input.row.attempts.map((attempt) => ({
      id: attempt.id,
      approvalId: attempt.approvalId,
      operation: operation(attempt.operation),
      snapshotVersion: attempt.snapshotVersion,
      snapshotHash: attempt.snapshotHash,
      status: attemptStatus(attempt.status),
      capabilityReason: attempt.capabilityReason.slice(0, 100),
      providerOutcome: paidProviderOutcome(attempt.providerOutcome),
      attemptedAt: attempt.attemptedAt.toISOString(),
    })),
  };
}
