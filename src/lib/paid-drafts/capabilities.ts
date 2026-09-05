import type { PaidDraftState, PaidPlatform } from "./types";

export type PaidWriteOperation = "create_paused" | "activate" | "change_budget";
export type PaidProviderReviewStatus = "not_requested" | "pending" | "approved" | "rejected";
export type PaidExecutionPath = "assisted" | "provider_reviewed" | "provider_checked";
export type PaidApprovalStatus = "approved" | "consumed" | "rejected" | "expired";

const WRITE_OPERATIONS = new Set<PaidWriteOperation>([
  "create_paused",
  "activate",
  "change_budget",
]);

// Provider writes become available only by shipping and reviewing a server
// adapter, then adding its exact operations here. Environment variables or
// browser input cannot enable execution.
const REVIEWED_PROVIDER_WRITERS: Readonly<
  Partial<Record<PaidPlatform, readonly PaidWriteOperation[]>>
> = Object.freeze({});

export interface PaidConnectionWriteAccess {
  readonly platform: PaidPlatform;
  readonly connectionId: string;
  readonly accountId: string;
  readonly oauthConnected: boolean;
  readonly providerReviewStatus: PaidProviderReviewStatus;
  readonly grantedOperations: readonly PaidWriteOperation[];
}

export interface PaidOperationCapability {
  readonly operation: PaidWriteOperation;
  readonly path: PaidExecutionPath;
  readonly canExecuteProvider: boolean;
  readonly assistedHandoffAvailable: true;
  readonly reason:
    | "provider_write_ready"
    | "provider_preflight_required"
    | "oauth_disconnected"
    | "provider_review_required"
    | "provider_review_pending"
    | "provider_review_rejected"
    | "operation_not_granted";
}

export interface PaidDraftCapabilities {
  readonly mode: PaidExecutionPath;
  readonly createPaused: PaidOperationCapability;
  readonly activation: PaidOperationCapability;
  readonly budgetChange: PaidOperationCapability;
}

export interface PaidOperationApproval {
  readonly approvalId: string;
  readonly status: PaidApprovalStatus;
  readonly kind: PaidWriteOperation;
  readonly platform: PaidPlatform;
  readonly connectionId: string;
  readonly accountId: string;
  readonly snapshotVersion: number;
  readonly snapshotHash: string;
}

export interface PaidOperationRequest {
  readonly operation: PaidWriteOperation;
  readonly state: PaidDraftState;
  readonly platform: PaidPlatform;
  readonly connectionId: string;
  readonly accountId: string;
  readonly snapshotVersion: number;
  readonly snapshotHash: string;
}

export function serverOwnedPaidConnectionWriteAccess(input: {
  platform: PaidPlatform;
  connectionId: string;
  accountId: string;
  oauthConnected: boolean;
}): PaidConnectionWriteAccess {
  const grantedOperations = REVIEWED_PROVIDER_WRITERS[input.platform] ?? [];
  return Object.freeze({
    ...input,
    providerReviewStatus: grantedOperations.length ? "approved" : "not_requested",
    grantedOperations,
  });
}

export type PaidOperationDenialReason =
  | "invalid_operation"
  | "provider_write_unavailable"
  | "account_mismatch"
  | "invalid_state"
  | "approval_not_approved"
  | "approval_consumed"
  | "approval_kind_mismatch"
  | "stale_approval"
  | "invalid_snapshot_binding";

export type PaidOperationDecision =
  | {
      readonly allowed: true;
      readonly operation: PaidWriteOperation;
      readonly nextState: PaidDraftState;
      readonly providerCreateStatus?: "paused";
    }
  | {
      readonly allowed: false;
      readonly reason: PaidOperationDenialReason;
      readonly useAssistedHandoff: boolean;
    };

export class PaidDraftCapabilityError extends Error {
  readonly name = "PaidDraftCapabilityError";
}

/** Validates approval/state binding without making a provider-capability claim. */
export function evaluatePaidApprovalBinding(
  request: PaidOperationRequest,
  approval: PaidOperationApproval,
): PaidOperationDecision {
  if (!WRITE_OPERATIONS.has(request.operation)) {
    return denied("invalid_operation");
  }
  if (!stateAllowsOperation(request.state, request.operation)) {
    return denied("invalid_state");
  }
  if (approval.status === "consumed") return denied("approval_consumed");
  if (approval.status !== "approved") return denied("approval_not_approved");
  if (approval.kind !== request.operation) return denied("approval_kind_mismatch");
  if (
    approval.platform !== request.platform ||
    approval.connectionId !== request.connectionId ||
    approval.accountId !== request.accountId
  ) {
    return denied("account_mismatch");
  }
  if (
    !Number.isSafeInteger(request.snapshotVersion) ||
    request.snapshotVersion < 1 ||
    !/^[a-f0-9]{64}$/.test(request.snapshotHash) ||
    !Number.isSafeInteger(approval.snapshotVersion) ||
    approval.snapshotVersion < 1 ||
    !/^[a-f0-9]{64}$/.test(approval.snapshotHash)
  ) {
    return denied("invalid_snapshot_binding");
  }
  if (
    approval.snapshotVersion !== request.snapshotVersion ||
    approval.snapshotHash !== request.snapshotHash
  ) {
    return denied("stale_approval");
  }
  return {
    allowed: true,
    operation: request.operation,
    nextState: nextStateForOperation(request.state, request.operation),
    ...(request.operation === "create_paused" ? { providerCreateStatus: "paused" as const } : {}),
  };
}

function capabilityReason(
  access: PaidConnectionWriteAccess,
  operation: PaidWriteOperation,
): PaidOperationCapability["reason"] {
  if (access.oauthConnected !== true) return "oauth_disconnected";
  if (access.providerReviewStatus === "not_requested") return "provider_review_required";
  if (access.providerReviewStatus === "pending") return "provider_review_pending";
  if (access.providerReviewStatus === "rejected") return "provider_review_rejected";
  if (
    access.providerReviewStatus !== "approved" ||
    !WRITE_OPERATIONS.has(operation) ||
    !Array.isArray(access.grantedOperations) ||
    !access.grantedOperations.includes(operation)
  ) {
    return "operation_not_granted";
  }
  return "provider_write_ready";
}

export function paidOperationCapability(
  access: PaidConnectionWriteAccess,
  operation: PaidWriteOperation,
): PaidOperationCapability {
  const reason = capabilityReason(access, operation);
  const canExecuteProvider = reason === "provider_write_ready";
  return Object.freeze({
    operation,
    path: canExecuteProvider ? "provider_reviewed" : "assisted",
    canExecuteProvider,
    assistedHandoffAvailable: true,
    reason,
  });
}

export function paidDraftCapabilities(access: PaidConnectionWriteAccess): PaidDraftCapabilities {
  const createPaused = paidOperationCapability(access, "create_paused");
  const activation = paidOperationCapability(access, "activate");
  const budgetChange = paidOperationCapability(access, "change_budget");
  return Object.freeze({
    mode:
      createPaused.canExecuteProvider || activation.canExecuteProvider || budgetChange.canExecuteProvider
        ? "provider_reviewed"
        : "assisted",
    createPaused,
    activation,
    budgetChange,
  });
}

function stateAllowsOperation(state: PaidDraftState, operation: PaidWriteOperation): boolean {
  if (operation === "create_paused") return state === "ready";
  if (operation === "activate") return state === "provider_paused";
  return state === "provider_paused" || state === "active";
}

function nextStateForOperation(
  state: PaidDraftState,
  operation: PaidWriteOperation,
): PaidDraftState {
  if (operation === "create_paused") return "creating_paused";
  if (operation === "activate") return "activating";
  return state;
}

function denied(
  reason: PaidOperationDenialReason,
  useAssistedHandoff = false,
): PaidOperationDecision {
  return { allowed: false, reason, useAssistedHandoff };
}

export function evaluatePaidOperation(
  request: PaidOperationRequest,
  approval: PaidOperationApproval,
  access: PaidConnectionWriteAccess,
): PaidOperationDecision {
  if (!WRITE_OPERATIONS.has(request.operation)) {
    return denied("invalid_operation");
  }
  if (
    request.platform !== access.platform ||
    request.connectionId !== access.connectionId ||
    request.accountId !== access.accountId
  ) {
    return denied("account_mismatch");
  }
  if (!stateAllowsOperation(request.state, request.operation)) {
    return denied("invalid_state");
  }
  const capability = paidOperationCapability(access, request.operation);
  if (!capability.canExecuteProvider) {
    return denied("provider_write_unavailable", true);
  }
  return evaluatePaidApprovalBinding(request, approval);
}

export function consumePaidOperationApproval(
  approval: PaidOperationApproval,
): PaidOperationApproval {
  if (approval.status !== "approved") {
    throw new PaidDraftCapabilityError("Only an approved operation can be consumed");
  }
  return Object.freeze({ ...approval, status: "consumed" });
}

const NORMAL_TRANSITIONS: Readonly<Record<PaidDraftState, readonly PaidDraftState[]>> = {
  draft: ["ready"],
  ready: ["creating_paused"],
  creating_paused: ["provider_paused"],
  provider_paused: ["activating"],
  activating: ["activation_requested"],
  activation_requested: ["active", "in_review", "rejected"],
  active: [],
  in_review: ["active", "rejected"],
  rejected: [],
  needs_reconciliation: [],
};

const UNCERTAIN_EFFECT_STATES = new Set<PaidDraftState>([
  "creating_paused",
  "provider_paused",
  "activating",
  "activation_requested",
  "active",
  "in_review",
]);

const RECONCILIATION_TARGETS = new Set<PaidDraftState>([
  "provider_paused",
  "activation_requested",
  "active",
  "in_review",
  "rejected",
]);

export interface PaidStateTransitionOptions {
  /** The provider adapter proves that no write request was sent. Consumes the old approval. */
  readonly confirmedNoExternalEffect?: boolean;
  readonly uncertainExternalEffect?: boolean;
  readonly reconciled?: boolean;
  readonly assistedConfirmation?: boolean;
  /** A user recorded the outcome of an exact assisted activation handoff. */
  readonly assistedActivationOutcome?: boolean;
}

export function canTransitionPaidDraftState(
  from: PaidDraftState,
  to: PaidDraftState,
  options: PaidStateTransitionOptions = {},
): boolean {
  if (from === "creating_paused" && to === "draft") return options.confirmedNoExternalEffect === true;
  if (from === "ready" && to === "provider_paused") {
    return options.assistedConfirmation === true;
  }
  if (from === "provider_paused" && to === "active") {
    return options.assistedActivationOutcome === true;
  }
  if (to === "needs_reconciliation") {
    return options.uncertainExternalEffect === true && UNCERTAIN_EFFECT_STATES.has(from);
  }
  if (from === "needs_reconciliation") {
    return options.reconciled === true && RECONCILIATION_TARGETS.has(to);
  }
  return NORMAL_TRANSITIONS[from].includes(to);
}

export function transitionPaidDraftState(
  from: PaidDraftState,
  to: PaidDraftState,
  options: PaidStateTransitionOptions = {},
): PaidDraftState {
  if (!canTransitionPaidDraftState(from, to, options)) {
    throw new PaidDraftCapabilityError(`Cannot transition a paid draft from ${from} to ${to}`);
  }
  return to;
}
