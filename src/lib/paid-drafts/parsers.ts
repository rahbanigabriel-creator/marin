import type { PaidDraftState, PaidPlatform } from "./types";
import { PaidDraftBadRequestError } from "./errors";
import { PaidDraftValidationError } from "./validation";

type JsonObject = Record<string, unknown>;

const PLATFORMS = new Set<PaidPlatform>(["google_ads", "meta_ads", "tiktok_ads"]);
const STATES = new Set<PaidDraftState>([
  "draft",
  "ready",
  "creating_paused",
  "provider_paused",
  "activating",
  "activation_requested",
  "active",
  "in_review",
  "rejected",
  "needs_reconciliation",
]);
const APPROVAL_KINDS = new Set(["create_paused", "activate"] as const);
const ACTIVATION_OUTCOMES = new Set(["activated", "not_activated"] as const);
const REQUEST_ID = /^[A-Za-z0-9_-]{10,120}$/;
const IDENTIFIER = /^[A-Za-z0-9_-]{1,191}$/;
const HASH = /^[a-f0-9]{64}$/;
const PROVIDER_CAMPAIGN_ID = /^[0-9]{1,32}$/;

export const PROVIDER_PAUSED_CONFIRMATION =
  "I created this campaign in the provider and left it paused" as const;

export type PaidApprovalKind = "create_paused" | "activate";

export interface CreatePaidDraftBody {
  requestId: string;
  connectionId: string;
  snapshot: unknown;
}

export interface UpdatePaidDraftBody {
  requestId: string;
  expectedVersion: number;
  snapshot: unknown;
}

export interface MarkPaidDraftReadyBody {
  requestId: string;
  expectedVersion: number;
  snapshotHash: string;
}

export interface ApprovePaidDraftBody extends MarkPaidDraftReadyBody {
  kind: PaidApprovalKind;
}

export interface ExecutePaidDraftBody extends MarkPaidDraftReadyBody {
  approvalId: string;
  operation: PaidApprovalKind;
}

export interface ConfirmProviderPausedBody extends MarkPaidDraftReadyBody {
  providerCampaignId: string;
  confirmation: typeof PROVIDER_PAUSED_CONFIRMATION;
}

export type ExternalActivationOutcome = "activated" | "not_activated";

export interface RecordExternalActivationOutcomeBody extends MarkPaidDraftReadyBody {
  attemptId: string;
  outcome: ExternalActivationOutcome;
}

export interface PaidDraftListQuery {
  platform?: PaidPlatform;
  state?: PaidDraftState;
  limit: number;
}

function object(value: unknown): JsonObject {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new PaidDraftBadRequestError("invalid_body", "A JSON object is required");
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new PaidDraftBadRequestError("invalid_body", "A plain JSON object is required");
  }
  return value as JsonObject;
}

function onlyKeys(body: JsonObject, allowed: readonly string[]): void {
  const accepted = new Set(allowed);
  const unknown = Object.keys(body).find((key) => !accepted.has(key));
  if (unknown) {
    throw new PaidDraftValidationError(
      "unknown_field",
      `${unknown} is not supported`,
      unknown,
    );
  }
}

function identifier(value: unknown, field: string): string {
  if (typeof value !== "string" || !IDENTIFIER.test(value)) {
    throw new PaidDraftValidationError(
      "invalid_identifier",
      `${field} is invalid`,
      field,
    );
  }
  return value;
}

function requestId(value: unknown): string {
  if (typeof value !== "string" || !REQUEST_ID.test(value)) {
    throw new PaidDraftValidationError(
      "invalid_request_id",
      "requestId is invalid",
      "requestId",
    );
  }
  return value;
}

function expectedVersion(value: unknown): number {
  if (!Number.isSafeInteger(value) || Number(value) < 1) {
    throw new PaidDraftValidationError(
      "invalid_version",
      "expectedVersion must be a positive integer",
      "expectedVersion",
    );
  }
  return Number(value);
}

function snapshotHash(value: unknown): string {
  if (typeof value !== "string" || !HASH.test(value)) {
    throw new PaidDraftValidationError(
      "invalid_snapshot_hash",
      "snapshotHash must be a lowercase SHA-256 hash",
      "snapshotHash",
    );
  }
  return value;
}

function approvalKind(value: unknown, field: string): PaidApprovalKind {
  if (typeof value !== "string" || !APPROVAL_KINDS.has(value as PaidApprovalKind)) {
    throw new PaidDraftValidationError(
      "invalid_operation",
      `${field} must be create_paused or activate`,
      field,
    );
  }
  return value as PaidApprovalKind;
}

export function parsePaidDraftId(value: unknown): string {
  return identifier(value, "draftId");
}

export function parsePaidApprovalId(value: unknown): string {
  return identifier(value, "approvalId");
}

export function parseCreatePaidDraftBody(value: unknown): CreatePaidDraftBody {
  const body = object(value);
  onlyKeys(body, ["requestId", "connectionId", "snapshot"]);
  if (!Object.hasOwn(body, "snapshot")) {
    throw new PaidDraftValidationError("required", "snapshot is required", "snapshot");
  }
  return {
    requestId: requestId(body.requestId),
    connectionId: identifier(body.connectionId, "connectionId"),
    snapshot: body.snapshot,
  };
}

export function parseUpdatePaidDraftBody(value: unknown): UpdatePaidDraftBody {
  const body = object(value);
  onlyKeys(body, ["requestId", "expectedVersion", "snapshot"]);
  if (!Object.hasOwn(body, "snapshot")) {
    throw new PaidDraftValidationError("required", "snapshot is required", "snapshot");
  }
  return {
    requestId: requestId(body.requestId),
    expectedVersion: expectedVersion(body.expectedVersion),
    snapshot: body.snapshot,
  };
}

export function parseMarkPaidDraftReadyBody(value: unknown): MarkPaidDraftReadyBody {
  const body = object(value);
  onlyKeys(body, ["requestId", "expectedVersion", "snapshotHash"]);
  return {
    requestId: requestId(body.requestId),
    expectedVersion: expectedVersion(body.expectedVersion),
    snapshotHash: snapshotHash(body.snapshotHash),
  };
}

export function parseApprovePaidDraftBody(value: unknown): ApprovePaidDraftBody {
  const body = object(value);
  onlyKeys(body, ["requestId", "kind", "expectedVersion", "snapshotHash"]);
  return {
    requestId: requestId(body.requestId),
    kind: approvalKind(body.kind, "kind"),
    expectedVersion: expectedVersion(body.expectedVersion),
    snapshotHash: snapshotHash(body.snapshotHash),
  };
}

export function parseExecutePaidDraftBody(value: unknown): ExecutePaidDraftBody {
  const body = object(value);
  onlyKeys(body, [
    "requestId",
    "approvalId",
    "operation",
    "expectedVersion",
    "snapshotHash",
  ]);
  return {
    requestId: requestId(body.requestId),
    approvalId: parsePaidApprovalId(body.approvalId),
    operation: approvalKind(body.operation, "operation"),
    expectedVersion: expectedVersion(body.expectedVersion),
    snapshotHash: snapshotHash(body.snapshotHash),
  };
}

export function parseConfirmProviderPausedBody(
  value: unknown,
): ConfirmProviderPausedBody {
  const body = object(value);
  onlyKeys(body, [
    "requestId",
    "expectedVersion",
    "snapshotHash",
    "providerCampaignId",
    "confirmation",
  ]);
  if (
    typeof body.providerCampaignId !== "string" ||
    !PROVIDER_CAMPAIGN_ID.test(body.providerCampaignId)
  ) {
    throw new PaidDraftValidationError(
      "invalid_provider_campaign_id",
      "providerCampaignId must contain 1 to 32 digits",
      "providerCampaignId",
    );
  }
  if (body.confirmation !== PROVIDER_PAUSED_CONFIRMATION) {
    throw new PaidDraftValidationError(
      "invalid_confirmation",
      "The exact paused-campaign confirmation is required",
      "confirmation",
    );
  }
  return {
    requestId: requestId(body.requestId),
    expectedVersion: expectedVersion(body.expectedVersion),
    snapshotHash: snapshotHash(body.snapshotHash),
    providerCampaignId: body.providerCampaignId,
    confirmation: PROVIDER_PAUSED_CONFIRMATION,
  };
}

export function parseRecordExternalActivationOutcomeBody(
  value: unknown,
): RecordExternalActivationOutcomeBody {
  const body = object(value);
  onlyKeys(body, [
    "requestId",
    "expectedVersion",
    "snapshotHash",
    "attemptId",
    "outcome",
  ]);
  if (
    typeof body.outcome !== "string" ||
    !ACTIVATION_OUTCOMES.has(body.outcome as ExternalActivationOutcome)
  ) {
    throw new PaidDraftValidationError(
      "invalid_activation_outcome",
      "outcome must be activated or not_activated",
      "outcome",
    );
  }
  return {
    requestId: requestId(body.requestId),
    expectedVersion: expectedVersion(body.expectedVersion),
    snapshotHash: snapshotHash(body.snapshotHash),
    attemptId: identifier(body.attemptId, "attemptId"),
    outcome: body.outcome as ExternalActivationOutcome,
  };
}

export function parsePaidDraftListQuery(request: Request): PaidDraftListQuery {
  let url: URL;
  try {
    url = new URL(request.url);
  } catch {
    throw new PaidDraftBadRequestError("invalid_query", "Request URL is invalid");
  }
  const allowed = new Set(["platform", "state", "limit"]);
  for (const key of url.searchParams.keys()) {
    if (!allowed.has(key) || url.searchParams.getAll(key).length !== 1) {
      throw new PaidDraftBadRequestError(
        "invalid_query",
        "The paid draft query contains an unsupported or repeated parameter",
      );
    }
  }
  const platformValue = url.searchParams.get("platform");
  const stateValue = url.searchParams.get("state");
  const limitValue = url.searchParams.get("limit");
  if (platformValue && !PLATFORMS.has(platformValue as PaidPlatform)) {
    throw new PaidDraftBadRequestError("invalid_query", "platform is invalid");
  }
  if (stateValue && !STATES.has(stateValue as PaidDraftState)) {
    throw new PaidDraftBadRequestError("invalid_query", "state is invalid");
  }
  const limit = limitValue === null ? 100 : Number(limitValue);
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
    throw new PaidDraftBadRequestError("invalid_query", "limit must be from 1 to 100");
  }
  return {
    ...(platformValue ? { platform: platformValue as PaidPlatform } : {}),
    ...(stateValue ? { state: stateValue as PaidDraftState } : {}),
    limit,
  };
}
