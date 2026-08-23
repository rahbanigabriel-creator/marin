import { Prisma, type WorkspaceDeletionRequest } from "@prisma/client";

import type { ResolvedIdentity, WorkspaceRole } from "@/lib/auth";
import {
  reconcilePersistedWorkspaceRole,
  WorkspaceAuthorizationError,
} from "@/lib/auth";
import type { DisconnectConnectionRecord } from "@/lib/connectors/disconnect";
import { prisma } from "@/lib/db";
import type {
  ClerkUserDeletionResult,
  StripeDeletionResult,
} from "@/lib/privacy/deletion/adapters";
import {
  DeletionConflictError,
  DeletionNotFoundError,
  DeletionValidationError,
} from "@/lib/privacy/deletion/errors";
import {
  providerOutcomesFromJson,
  toDeletionRequestView,
  type CreateDeletionInput,
  type DeletionIdentity,
  type DeletionRequestView,
  type ProviderDeletionOutcome,
  type RetryDeletionInput,
} from "@/lib/privacy/deletion/types";
import {
  createDeletionRequestHash,
  deletionConfirmationPhrase,
  retryDeletionRequestHash,
} from "@/lib/privacy/deletion/validation";

const ACTIVE_AGENT_STATUSES = ["queued", "running", "waiting_input", "waiting_approval"];
const TERMINAL_SUBSCRIPTION_STATUSES = new Set(["canceled", "inactive", "incomplete_expired"]);
const PROCESSING_LEASE_MS = 15 * 60 * 1_000;

export type DeletionDispatchResult = "sent" | "unavailable" | "failed";

export interface WorkspaceDeletionDependencies {
  now(): Date;
  dispatch(input: { deletionRequestId: string; workspaceId: string }): Promise<DeletionDispatchResult>;
  cancelStripe(input: {
    subscriptionId: string;
    deletionRequestId: string;
  }): Promise<StripeDeletionResult>;
  revokeProviderGrants(
    connections: readonly DisconnectConnectionRecord[],
  ): Promise<ProviderDeletionOutcome[]>;
  isAssetStorageConfigured(): Promise<boolean>;
  deleteAsset(input: { workspaceId: string; assetId: string; storageKey: string }): Promise<void>;
  deleteClerkUser(clerkUserId: string): Promise<ClerkUserDeletionResult>;
}

function defaults(): WorkspaceDeletionDependencies {
  return {
    now: () => new Date(),
    dispatch: async (input) => {
      const { dispatchWorkspaceDeletion } = await import("@/lib/privacy/deletion/dispatch");
      return dispatchWorkspaceDeletion(input);
    },
    cancelStripe: async (input) =>
      (await import("@/lib/privacy/deletion/adapters")).cancelStripeSubscriptionForDeletion(input),
    revokeProviderGrants: async (connections) =>
      (await import("@/lib/privacy/deletion/adapters")).revokeProviderGrantsForDeletion(connections),
    isAssetStorageConfigured: async () =>
      (await import("@/lib/privacy/deletion/adapters")).assetStorageAvailableForDeletion(),
    deleteAsset: async (input) =>
      (await import("@/lib/privacy/deletion/adapters")).deleteAssetForWorkspaceDeletion(input),
    deleteClerkUser: async (clerkUserId) =>
      (await import("@/lib/privacy/deletion/adapters")).deletePersonalClerkUser(clerkUserId),
  };
}

function identityForDeletion(identity: ResolvedIdentity): DeletionIdentity {
  return {
    clerkUserId: identity.clerkUserId,
    clerkOrgId: identity.clerkOrgId,
    workspaceSlug: identity.slug,
  };
}

function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

function isPotentiallyBillable(subscription: {
  stripeSubId: string | null;
  status: string;
} | null): subscription is { stripeSubId: string; status: string } {
  return Boolean(
    subscription?.stripeSubId &&
      !TERMINAL_SUBSCRIPTION_STATUSES.has(subscription.status.toLowerCase()),
  );
}

function mergeWarnings(existing: readonly string[], next: readonly string[]): string[] {
  return [...new Set([...existing, ...next])].slice(0, 12);
}

function warningsForProviderOutcomes(outcomes: readonly ProviderDeletionOutcome[]): string[] {
  return outcomes.flatMap((outcome) => {
    if (outcome.status === "confirmed") return [];
    if (outcome.provider === "tiktok" && outcome.status === "unavailable") {
      return ["tiktok_revocation_manual_required"];
    }
    return [`${outcome.provider}_revocation_${outcome.status}`];
  });
}

function jsonWarnings(row: WorkspaceDeletionRequest): string[] {
  return Array.isArray(row.warningCodes)
    ? row.warningCodes.filter((value): value is string => typeof value === "string").slice(0, 12)
    : [];
}

async function lockWorkspaceAndFence(
  tx: Prisma.TransactionClient,
  workspaceId: string,
  now: Date,
): Promise<boolean> {
  const locked = await tx.$queryRaw<Array<{ id: string }>>`
    SELECT "id" FROM "workspaces" WHERE "id" = ${workspaceId} FOR UPDATE
  `;
  if (!locked.length) return false;

  await tx.agentRun.updateMany({
    where: { workspaceId, status: { in: ACTIVE_AGENT_STATUSES } },
    data: {
      status: "cancelled",
      cancelRequestedAt: now,
      completedAt: now,
      failureCode: "workspace_deletion",
      failureMessage: "The workspace owner requested deletion",
      version: { increment: 1 },
    },
  });
  await tx.connection.updateMany({
    where: { workspaceId, status: { not: "revoked" } },
    data: {
      status: "revoked",
      lastErrorCode: "workspace_deletion",
      lastErrorMessage: "Workspace deletion is pending",
    },
  });
  return true;
}

export async function getDeletionPreparation(
  clerkIdentity: ResolvedIdentity,
): Promise<
  | { deletion: DeletionRequestView; confirmationPhrase: null; role: null }
  | { deletion: null; confirmationPhrase: string; role: WorkspaceRole }
  | null
> {
  const identity = identityForDeletion(clerkIdentity);
  const deletion = await prisma.workspaceDeletionRequest.findFirst({
    where: { requestedBy: identity.clerkUserId, workspaceSlug: identity.workspaceSlug },
    orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
  });
  if (deletion) {
    return { deletion: toDeletionRequestView(deletion), confirmationPhrase: null, role: null };
  }

  const workspace = await prisma.workspace.findUnique({
    where: { slug: identity.workspaceSlug },
    select: {
      id: true,
      slug: true,
      memberships: {
        where: { clerkUserId: identity.clerkUserId },
        select: { id: true, role: true },
        take: 1,
      },
    },
  });
  const membership = workspace?.memberships[0];
  if (!workspace || !membership) return null;
  const role = reconcilePersistedWorkspaceRole(membership.role, clerkIdentity);
  if (role !== membership.role) {
    await prisma.membership.updateMany({
      where: {
        id: membership.id,
        workspaceId: workspace.id,
        role: membership.role,
      },
      data: { role },
    });
  }
  return {
    deletion: null,
    confirmationPhrase: deletionConfirmationPhrase(workspace.slug),
    role,
  };
}

export async function getDeletionRequestForRequester(input: {
  deletionRequestId: string;
  clerkUserId: string;
}): Promise<DeletionRequestView> {
  const row = await prisma.workspaceDeletionRequest.findFirst({
    where: { id: input.deletionRequestId, requestedBy: input.clerkUserId },
  });
  if (!row) throw new DeletionNotFoundError();
  return toDeletionRequestView(row);
}

async function settleDispatch(input: {
  deletionRequestId: string;
  result: DeletionDispatchResult;
  commandId?: string;
}): Promise<WorkspaceDeletionRequest> {
  const dispatchErrorCode =
    input.result === "unavailable"
      ? "dispatch_unavailable"
      : input.result === "failed"
        ? "dispatch_failed"
        : null;
  await prisma.$transaction(async (tx) => {
    await tx.workspaceDeletionRequest.updateMany({
      where: {
        id: input.deletionRequestId,
        ...(input.result === "sent" ? {} : { status: "queued" }),
      },
      data: {
        dispatchStatus: input.result,
        dispatchErrorCode,
        ...(input.result === "sent"
          ? {}
          : {
              status: "needs_attention",
              stage: "dispatch",
              failureCode: dispatchErrorCode,
              failureMessage: "Deletion could not be queued. Retry is required.",
            }),
        version: { increment: 1 },
      },
    });
    if (input.commandId) {
      await tx.workspaceDeletionCommand.update({
        where: { id: input.commandId },
        data: { resultStatus: input.result },
      });
    }
  });
  return prisma.workspaceDeletionRequest.findUniqueOrThrow({
    where: { id: input.deletionRequestId },
  });
}

export async function createWorkspaceDeletionRequest(input: {
  identity: ResolvedIdentity;
  request: CreateDeletionInput;
  dependencies?: Partial<WorkspaceDeletionDependencies>;
}): Promise<{ deletion: DeletionRequestView; replayed: boolean }> {
  const identity = identityForDeletion(input.identity);
  const requestHash = createDeletionRequestHash({
    workspaceSlug: identity.workspaceSlug,
    requestId: input.request.requestId,
    confirmation: input.request.confirmation,
  });
  const replay = await prisma.workspaceDeletionRequest.findUnique({
    where: {
      requestedBy_requestId: {
        requestedBy: identity.clerkUserId,
        requestId: input.request.requestId,
      },
    },
  });
  if (replay) {
    if (replay.requestHash !== requestHash) {
      throw new DeletionConflictError(
        "request_id_conflict",
        "This requestId is already bound to a different deletion request",
      );
    }
    return { deletion: toDeletionRequestView(replay), replayed: true };
  }

  const now = input.dependencies?.now?.() ?? new Date();
  let creation: { row: WorkspaceDeletionRequest; replayed: boolean };
  try {
    creation = await prisma.$transaction(async (tx) => {
      const workspace = await tx.workspace.findUnique({
        where: { slug: identity.workspaceSlug },
        select: { id: true, slug: true },
      });
      if (!workspace) throw new DeletionNotFoundError();

      const membership = await tx.membership.findUnique({
        where: {
          workspaceId_clerkUserId: {
            workspaceId: workspace.id,
            clerkUserId: identity.clerkUserId,
          },
        },
        select: { id: true, role: true },
      });
      if (!membership) throw new WorkspaceAuthorizationError();
      const role = reconcilePersistedWorkspaceRole(membership.role, input.identity);
      if (role !== membership.role) {
        await tx.membership.update({
          where: { id: membership.id },
          data: { role },
        });
      }
      if (role !== "owner") throw new WorkspaceAuthorizationError();

      const expected = deletionConfirmationPhrase(workspace.slug);
      if (input.request.confirmation !== expected) {
        throw new DeletionValidationError(
          "confirmation_mismatch",
          "The confirmation phrase does not match exactly",
        );
      }

      if (!(await lockWorkspaceAndFence(tx, workspace.id, now))) {
        throw new DeletionNotFoundError();
      }
      const lateReplay = await tx.workspaceDeletionRequest.findUnique({
        where: {
          requestedBy_requestId: {
            requestedBy: identity.clerkUserId,
            requestId: input.request.requestId,
          },
        },
      });
      if (lateReplay) {
        if (lateReplay.requestHash !== requestHash) {
          throw new DeletionConflictError(
            "request_id_conflict",
            "This requestId is already bound to a different deletion request",
          );
        }
        return { row: lateReplay, replayed: true };
      }
      const existing = await tx.workspaceDeletionRequest.findUnique({
        where: { workspaceId: workspace.id },
      });
      if (existing) {
        throw new DeletionConflictError(
          "deletion_already_requested",
          "A deletion request already exists for this workspace",
        );
      }
      const otherMemberships = await tx.membership.count({
        where: {
          clerkUserId: identity.clerkUserId,
          workspaceId: { not: workspace.id },
        },
      });
      const row = await tx.workspaceDeletionRequest.create({
        data: {
          workspaceId: workspace.id,
          workspaceSlug: workspace.slug,
          requestedBy: identity.clerkUserId,
          requestId: input.request.requestId,
          requestHash,
          isClerkOrganization: Boolean(identity.clerkOrgId),
          clerkUserDeletionEligible: !identity.clerkOrgId && otherMemberships === 0,
          requestedAt: now,
        },
      });
      return { row, replayed: false };
    });
  } catch (error) {
    if (!isUniqueViolation(error)) throw error;
    const raced = await prisma.workspaceDeletionRequest.findUnique({
      where: {
        requestedBy_requestId: {
          requestedBy: identity.clerkUserId,
          requestId: input.request.requestId,
        },
      },
    });
    if (raced?.requestHash === requestHash) {
      return { deletion: toDeletionRequestView(raced), replayed: true };
    }
    throw new DeletionConflictError(
      "request_id_conflict",
      "This requestId is already bound to a different deletion request",
    );
  }

  if (creation.replayed) {
    return { deletion: toDeletionRequestView(creation.row), replayed: true };
  }
  const created = creation.row;

  const dependencies = { ...defaults(), ...input.dependencies };
  let dispatch: DeletionDispatchResult;
  try {
    dispatch = await dependencies.dispatch({
      deletionRequestId: created.id,
      workspaceId: created.workspaceId,
    });
  } catch {
    dispatch = "failed";
  }
  const settled = await settleDispatch({ deletionRequestId: created.id, result: dispatch });
  return { deletion: toDeletionRequestView(settled), replayed: false };
}

export async function retryWorkspaceDeletion(input: {
  identity: ResolvedIdentity;
  deletionRequestId: string;
  request: RetryDeletionInput;
  dependencies?: Partial<WorkspaceDeletionDependencies>;
}): Promise<{ deletion: DeletionRequestView; replayed: boolean }> {
  const identity = identityForDeletion(input.identity);
  const requestHash = retryDeletionRequestHash({
    deletionRequestId: input.deletionRequestId,
    requestId: input.request.requestId,
  });
  const replay = await prisma.workspaceDeletionCommand.findUnique({
    where: {
      requestedBy_requestId: {
        requestedBy: identity.clerkUserId,
        requestId: input.request.requestId,
      },
    },
    include: { deletionRequest: true },
  });
  if (replay) {
    if (
      replay.requestHash !== requestHash ||
      replay.deletionRequestId !== input.deletionRequestId
    ) {
      throw new DeletionConflictError(
        "request_id_conflict",
        "This requestId is already bound to a different retry",
      );
    }
    return { deletion: toDeletionRequestView(replay.deletionRequest), replayed: true };
  }

  const now = input.dependencies?.now?.() ?? new Date();
  let claimed: {
    updated: WorkspaceDeletionRequest;
    commandId: string | null;
    replayed: boolean;
  };
  try {
    claimed = await prisma.$transaction(async (tx) => {
      await tx.$queryRaw<Array<{ id: string }>>`
        SELECT "id" FROM "workspace_deletion_requests"
        WHERE "id" = ${input.deletionRequestId} FOR UPDATE
      `;
      const deletion = await tx.workspaceDeletionRequest.findFirst({
        where: { id: input.deletionRequestId, requestedBy: identity.clerkUserId },
      });
      if (!deletion) throw new DeletionNotFoundError();
      const lateReplay = await tx.workspaceDeletionCommand.findUnique({
        where: {
          requestedBy_requestId: {
            requestedBy: identity.clerkUserId,
            requestId: input.request.requestId,
          },
        },
      });
      if (lateReplay) {
        if (
          lateReplay.requestHash !== requestHash ||
          lateReplay.deletionRequestId !== input.deletionRequestId
        ) {
          throw new DeletionConflictError(
            "request_id_conflict",
            "This requestId is already bound to a different retry",
          );
        }
        return { updated: deletion, commandId: null, replayed: true };
      }
      if (deletion.status !== "needs_attention") {
        throw new DeletionConflictError(
          "deletion_not_retryable",
          "This deletion request is not waiting for a retry",
        );
      }
      await lockWorkspaceAndFence(tx, deletion.workspaceId, now);
      const updated = await tx.workspaceDeletionRequest.update({
        where: { id: deletion.id },
        data: {
          status: "queued",
          stage: "retry_queued",
          dispatchStatus: "pending",
          dispatchErrorCode: null,
          failureCode: null,
          failureMessage: null,
          version: { increment: 1 },
        },
      });
      const command = await tx.workspaceDeletionCommand.create({
        data: {
          deletionRequestId: deletion.id,
          requestedBy: identity.clerkUserId,
          requestId: input.request.requestId,
          requestHash,
          kind: "retry",
          resultStatus: "pending",
        },
      });
      return { updated, commandId: command.id, replayed: false };
    });
  } catch (error) {
    if (!isUniqueViolation(error)) throw error;
    const raced = await prisma.workspaceDeletionCommand.findUnique({
      where: {
        requestedBy_requestId: {
          requestedBy: identity.clerkUserId,
          requestId: input.request.requestId,
        },
      },
      include: { deletionRequest: true },
    });
    if (
      raced?.requestHash === requestHash &&
      raced.deletionRequestId === input.deletionRequestId
    ) {
      return { deletion: toDeletionRequestView(raced.deletionRequest), replayed: true };
    }
    throw new DeletionConflictError(
      "request_id_conflict",
      "This requestId is already bound to a different retry",
    );
  }

  if (claimed.replayed) {
    return { deletion: toDeletionRequestView(claimed.updated), replayed: true };
  }

  const dependencies = { ...defaults(), ...input.dependencies };
  let dispatch: DeletionDispatchResult;
  try {
    dispatch = await dependencies.dispatch({
      deletionRequestId: claimed.updated.id,
      workspaceId: claimed.updated.workspaceId,
    });
  } catch {
    dispatch = "failed";
  }
  const settled = await settleDispatch({
    deletionRequestId: claimed.updated.id,
    result: dispatch,
    commandId: claimed.commandId ?? undefined,
  });
  return { deletion: toDeletionRequestView(settled), replayed: false };
}

async function needsAttention(input: {
  deletionRequestId: string;
  statusField?: "stripeStatus" | "blobStatus";
  status?: "failed" | "unavailable";
  stage: string;
  code: string;
  message: string;
}): Promise<WorkspaceDeletionRequest> {
  return prisma.workspaceDeletionRequest.update({
    where: { id: input.deletionRequestId },
    data: {
      status: "needs_attention",
      stage: input.stage,
      ...(input.statusField && input.status ? { [input.statusField]: input.status } : {}),
      failureCode: input.code,
      failureMessage: input.message,
      version: { increment: 1 },
    },
  });
}

type ProcessingSnapshot = {
  deletion: WorkspaceDeletionRequest;
  subscription: { stripeSubId: string | null; status: string } | null;
  connections: DisconnectConnectionRecord[];
  assets: Array<{ id: string; storageKey: string }>;
};

async function claimProcessing(input: {
  deletionRequestId: string;
  workspaceId: string;
  now: Date;
}): Promise<ProcessingSnapshot | WorkspaceDeletionRequest> {
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw<Array<{ id: string }>>`
      SELECT "id" FROM "workspace_deletion_requests"
      WHERE "id" = ${input.deletionRequestId} FOR UPDATE
    `;
    const deletion = await tx.workspaceDeletionRequest.findFirst({
      where: { id: input.deletionRequestId, workspaceId: input.workspaceId },
    });
    if (!deletion) throw new DeletionNotFoundError();
    if (deletion.status === "completed" || deletion.status === "completed_with_warnings") {
      return deletion;
    }
    if (deletion.status === "needs_attention") return deletion;
    if (
      deletion.status === "processing" &&
      deletion.updatedAt.getTime() > input.now.getTime() - PROCESSING_LEASE_MS
    ) {
      return deletion;
    }
    if (deletion.status !== "queued" && deletion.status !== "processing") return deletion;

    const workspaceExists = await lockWorkspaceAndFence(tx, input.workspaceId, input.now);
    if (!workspaceExists) {
      if (deletion.stage === "local_deleted") return deletion;
      return tx.workspaceDeletionRequest.update({
        where: { id: deletion.id },
        data: {
          status: "needs_attention",
          stage: "local_workspace_missing",
          failureCode: "local_workspace_missing",
          failureMessage: "Local workspace deletion could not be reconciled automatically.",
          version: { increment: 1 },
        },
      });
    }

    const [subscription, connections, assets, otherMemberships] = await Promise.all([
      tx.subscription.findUnique({
        where: { workspaceId: input.workspaceId },
        select: { stripeSubId: true, status: true },
      }),
      tx.connection.findMany({
        where: { workspaceId: input.workspaceId },
        select: {
          id: true,
          workspaceId: true,
          platform: true,
          externalAccountId: true,
          encAccessToken: true,
          encRefreshToken: true,
        },
        orderBy: { id: "asc" },
      }),
      tx.asset.findMany({
        where: { workspaceId: input.workspaceId },
        select: { id: true, storageKey: true },
        orderBy: { id: "asc" },
      }),
      tx.membership.count({
        where: {
          clerkUserId: deletion.requestedBy,
          workspaceId: { not: input.workspaceId },
        },
      }),
    ]);
    const updated = await tx.workspaceDeletionRequest.update({
      where: { id: deletion.id },
      data: {
        status: "processing",
        stage: "external_prerequisites",
        processingStartedAt: input.now,
        attempt: { increment: 1 },
        failureCode: null,
        failureMessage: null,
        clerkUserDeletionEligible:
          !deletion.isClerkOrganization && otherMemberships === 0,
        version: { increment: 1 },
      },
    });
    return { deletion: updated, subscription, connections, assets };
  });
}

async function finishClerkAndTombstone(input: {
  deletion: WorkspaceDeletionRequest;
  warnings: string[];
  dependencies: WorkspaceDeletionDependencies;
  now: Date;
}): Promise<WorkspaceDeletionRequest> {
  let clerkStatus: "confirmed" | "not_applicable" | "failed" = "not_applicable";
  const remainingMemberships = await prisma.membership.count({
    where: { clerkUserId: input.deletion.requestedBy },
  });
  const eligible =
    !input.deletion.isClerkOrganization &&
    input.deletion.clerkUserDeletionEligible &&
    remainingMemberships === 0;
  if (eligible) {
    try {
      clerkStatus = await input.dependencies.deleteClerkUser(input.deletion.requestedBy);
    } catch {
      clerkStatus = "failed";
    }
  }
  const warnings = mergeWarnings(
    input.warnings,
    clerkStatus === "failed" ? ["clerk_user_deletion_failed"] : [],
  );
  return prisma.workspaceDeletionRequest.update({
    where: { id: input.deletion.id },
    data: {
      status: warnings.length ? "completed_with_warnings" : "completed",
      stage: "completed",
      clerkStatus,
      warningCodes: warnings,
      failureCode: null,
      failureMessage: null,
      completedAt: input.now,
      version: { increment: 1 },
    },
  });
}

export async function processWorkspaceDeletion(input: {
  deletionRequestId: string;
  workspaceId: string;
  dependencies?: Partial<WorkspaceDeletionDependencies>;
}): Promise<DeletionRequestView> {
  const dependencies = { ...defaults(), ...input.dependencies };
  const now = dependencies.now();
  const claimed = await claimProcessing({ ...input, now });
  if (!("subscription" in claimed)) {
    if (claimed.stage === "local_deleted" && claimed.status === "processing") {
      const finished = await finishClerkAndTombstone({
        deletion: claimed,
        warnings: jsonWarnings(claimed),
        dependencies,
        now,
      });
      return toDeletionRequestView(finished);
    }
    return toDeletionRequestView(claimed);
  }

  const { deletion, subscription, connections, assets } = claimed;
  let warnings = jsonWarnings(deletion).filter(
    (code) =>
      !code.startsWith("google_revocation_") &&
      !code.startsWith("meta_revocation_") &&
      !code.startsWith("tiktok_revocation_"),
  );

  if (isPotentiallyBillable(subscription)) {
    let cancellation: StripeDeletionResult;
    try {
      cancellation = await dependencies.cancelStripe({
        subscriptionId: subscription.stripeSubId,
        deletionRequestId: deletion.id,
      });
    } catch {
      cancellation = "failed";
    }
    if (cancellation !== "confirmed") {
      const blocked = await needsAttention({
        deletionRequestId: deletion.id,
        statusField: "stripeStatus",
        status: cancellation,
        stage: "stripe_cancellation",
        code: `stripe_cancellation_${cancellation}`,
        message: "Subscription cancellation could not be confirmed. Retry is required.",
      });
      return toDeletionRequestView(blocked);
    }
    await prisma.workspaceDeletionRequest.update({
      where: { id: deletion.id },
      data: { stripeStatus: "confirmed", stage: "provider_revocation" },
    });
  } else {
    await prisma.workspaceDeletionRequest.update({
      where: { id: deletion.id },
      data: { stripeStatus: "not_applicable", stage: "provider_revocation" },
    });
  }

  let providerOutcomes: ProviderDeletionOutcome[];
  try {
    providerOutcomes = await dependencies.revokeProviderGrants(connections);
  } catch {
    const providers = new Set(
      connections.flatMap((connection) =>
        ["google_ads", "ga4", "search_console"].includes(connection.platform)
          ? ["google" as const]
          : connection.platform === "meta_ads"
            ? ["meta" as const]
            : connection.platform === "tiktok_ads"
              ? ["tiktok" as const]
              : [],
      ),
    );
    providerOutcomes = [...providers].map((provider) => ({ provider, status: "failed" }));
  }
  warnings = mergeWarnings(warnings, warningsForProviderOutcomes(providerOutcomes));
  await prisma.workspaceDeletionRequest.update({
    where: { id: deletion.id },
    data: {
      providerOutcomes,
      warningCodes: warnings,
      stage: "asset_deletion",
    },
  });

  if (assets.length) {
    let storageConfigured = false;
    try {
      storageConfigured = await dependencies.isAssetStorageConfigured();
    } catch {
      storageConfigured = false;
    }
    if (!storageConfigured) {
      const blocked = await needsAttention({
        deletionRequestId: deletion.id,
        statusField: "blobStatus",
        status: "unavailable",
        stage: "asset_deletion",
        code: "asset_storage_unavailable",
        message: "Private asset deletion could not be confirmed. Retry is required.",
      });
      return toDeletionRequestView(blocked);
    }
    let failed = false;
    for (const asset of assets) {
      try {
        await dependencies.deleteAsset({
          workspaceId: deletion.workspaceId,
          assetId: asset.id,
          storageKey: asset.storageKey,
        });
      } catch {
        failed = true;
      }
    }
    if (failed) {
      const blocked = await needsAttention({
        deletionRequestId: deletion.id,
        statusField: "blobStatus",
        status: "failed",
        stage: "asset_deletion",
        code: "asset_deletion_failed",
        message: "Private asset deletion could not be confirmed. Retry is required.",
      });
      return toDeletionRequestView(blocked);
    }
    await prisma.workspaceDeletionRequest.update({
      where: { id: deletion.id },
      data: { blobStatus: "confirmed", stage: "local_deletion" },
    });
  } else {
    await prisma.workspaceDeletionRequest.update({
      where: { id: deletion.id },
      data: { blobStatus: "not_applicable", stage: "local_deletion" },
    });
  }

  const local = await prisma.$transaction(async (tx) => {
    const exists = await lockWorkspaceAndFence(tx, deletion.workspaceId, now);
    if (!exists) {
      return tx.workspaceDeletionRequest.findUniqueOrThrow({ where: { id: deletion.id } });
    }
    const [currentAssets, currentSubscription, otherMemberships] = await Promise.all([
      tx.asset.findMany({
        where: { workspaceId: deletion.workspaceId },
        select: { id: true },
        orderBy: { id: "asc" },
      }),
      tx.subscription.findUnique({
        where: { workspaceId: deletion.workspaceId },
        select: { stripeSubId: true, status: true },
      }),
      tx.membership.count({
        where: {
          clerkUserId: deletion.requestedBy,
          workspaceId: { not: deletion.workspaceId },
        },
      }),
    ]);
    const snapshotAssetIds = new Set(assets.map((asset) => asset.id));
    if (
      currentAssets.length !== assets.length ||
      currentAssets.some((asset) => !snapshotAssetIds.has(asset.id))
    ) {
      return tx.workspaceDeletionRequest.update({
        where: { id: deletion.id },
        data: {
          status: "needs_attention",
          stage: "workspace_changed",
          failureCode: "workspace_changed",
          failureMessage: "Workspace data changed during deletion. Retry is required.",
          version: { increment: 1 },
        },
      });
    }
    if (
      isPotentiallyBillable(currentSubscription) &&
      currentSubscription.stripeSubId !== subscription?.stripeSubId
    ) {
      return tx.workspaceDeletionRequest.update({
        where: { id: deletion.id },
        data: {
          status: "needs_attention",
          stage: "subscription_changed",
          stripeStatus: "pending",
          failureCode: "subscription_changed",
          failureMessage: "Billing state changed during deletion. Retry is required.",
          version: { increment: 1 },
        },
      });
    }

    const removed = await tx.workspace.deleteMany({ where: { id: deletion.workspaceId } });
    if (removed.count !== 1) {
      return tx.workspaceDeletionRequest.update({
        where: { id: deletion.id },
        data: {
          status: "needs_attention",
          stage: "local_deletion",
          failureCode: "local_deletion_unconfirmed",
          failureMessage: "Local workspace deletion could not be confirmed. Retry is required.",
          version: { increment: 1 },
        },
      });
    }
    return tx.workspaceDeletionRequest.update({
      where: { id: deletion.id },
      data: {
        status: "processing",
        stage: "local_deleted",
        clerkUserDeletionEligible:
          !deletion.isClerkOrganization && otherMemberships === 0,
        failureCode: null,
        failureMessage: null,
        version: { increment: 1 },
      },
    });
  });
  if (local.stage !== "local_deleted" || local.status !== "processing") {
    return toDeletionRequestView(local);
  }

  const finished = await finishClerkAndTombstone({
    deletion: local,
    warnings,
    dependencies,
    now,
  });
  return toDeletionRequestView(finished);
}

export async function reconcileStaleWorkspaceDeletions(input: {
  now?: Date;
  take?: number;
} = {}): Promise<number> {
  const now = input.now ?? new Date();
  const staleBefore = new Date(now.getTime() - PROCESSING_LEASE_MS);
  const stale = await prisma.workspaceDeletionRequest.findMany({
    where: { status: "processing", updatedAt: { lt: staleBefore } },
    select: { id: true },
    orderBy: { updatedAt: "asc" },
    take: Math.min(Math.max(input.take ?? 100, 1), 250),
  });
  if (!stale.length) return 0;
  const result = await prisma.workspaceDeletionRequest.updateMany({
    where: { id: { in: stale.map((row) => row.id) }, status: "processing", updatedAt: { lt: staleBefore } },
    data: {
      status: "needs_attention",
      stage: "processing_interrupted",
      failureCode: "processing_interrupted",
      failureMessage: "Deletion processing was interrupted. Retry is required.",
      version: { increment: 1 },
    },
  });
  return result.count;
}

export function priorProviderOutcomes(row: WorkspaceDeletionRequest): ProviderDeletionOutcome[] {
  return providerOutcomesFromJson(row.providerOutcomes);
}
