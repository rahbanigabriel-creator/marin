import type { Prisma, WorkspaceDeletionRequest } from "@prisma/client";

export const WORKSPACE_DELETION_STATUSES = [
  "queued",
  "processing",
  "needs_attention",
  "completed",
  "completed_with_warnings",
] as const;

export type WorkspaceDeletionStatus = (typeof WORKSPACE_DELETION_STATUSES)[number];
export type ExternalPrerequisiteStatus =
  | "pending"
  | "confirmed"
  | "not_applicable"
  | "failed"
  | "unavailable";
export type ClerkDeletionStatus = "pending" | "confirmed" | "not_applicable" | "failed";
export type DeletionDispatchStatus = "pending" | "sent" | "unavailable" | "failed";
export type ProviderDeletionOutcome = {
  provider: "google" | "meta" | "tiktok";
  status: "confirmed" | "failed" | "unavailable";
};

export interface CreateDeletionInput {
  requestId: string;
  confirmation: string;
}

export interface RetryDeletionInput {
  requestId: string;
}

export interface DeletionIdentity {
  clerkUserId: string;
  clerkOrgId: string | null;
  workspaceSlug: string;
}

export interface DeletionRequestView {
  id: string;
  status: WorkspaceDeletionStatus;
  stage: string;
  dispatchStatus: DeletionDispatchStatus;
  stripeStatus: ExternalPrerequisiteStatus;
  blobStatus: ExternalPrerequisiteStatus;
  providerOutcomes: ProviderDeletionOutcome[];
  warningCodes: string[];
  failureCode: string | null;
  failureMessage: string | null;
  clerkStatus: ClerkDeletionStatus;
  attempt: number;
  version: number;
  requestedAt: string;
  processingStartedAt: string | null;
  completedAt: string | null;
  updatedAt: string;
}

function safeStringArray(value: Prisma.JsonValue, maximum: number): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === "string")
    .slice(0, maximum);
}

export function providerOutcomesFromJson(value: Prisma.JsonValue): ProviderDeletionOutcome[] {
  if (!Array.isArray(value)) return [];
  const outcomes: ProviderDeletionOutcome[] = [];
  for (const item of value.slice(0, 4)) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const provider = "provider" in item ? item.provider : null;
    const status = "status" in item ? item.status : null;
    if (
      (provider === "google" || provider === "meta" || provider === "tiktok") &&
      (status === "confirmed" || status === "failed" || status === "unavailable")
    ) {
      outcomes.push({ provider, status });
    }
  }
  return outcomes;
}

export function toDeletionRequestView(row: WorkspaceDeletionRequest): DeletionRequestView {
  return {
    id: row.id,
    status: row.status as WorkspaceDeletionStatus,
    stage: row.stage,
    dispatchStatus: row.dispatchStatus as DeletionDispatchStatus,
    stripeStatus: row.stripeStatus as ExternalPrerequisiteStatus,
    blobStatus: row.blobStatus as ExternalPrerequisiteStatus,
    providerOutcomes: providerOutcomesFromJson(row.providerOutcomes),
    warningCodes: safeStringArray(row.warningCodes, 12),
    failureCode: row.failureCode,
    failureMessage: row.failureMessage,
    clerkStatus: row.clerkStatus as ClerkDeletionStatus,
    attempt: row.attempt,
    version: row.version,
    requestedAt: row.requestedAt.toISOString(),
    processingStartedAt: row.processingStartedAt?.toISOString() ?? null,
    completedAt: row.completedAt?.toISOString() ?? null,
    updatedAt: row.updatedAt.toISOString(),
  };
}
