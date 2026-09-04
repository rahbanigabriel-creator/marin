import { Prisma } from "@prisma/client";

import type { WorkspaceRole } from "@/lib/auth";
import { WorkspaceAuthorizationError } from "@/lib/auth";
import { commitUsageReservationWithDb } from "@/lib/billing/usage";
import { prisma } from "@/lib/db";
import {
  assertPaidDraftAssetSuitability,
  paidDraftAssetIds,
} from "./assets";
import {
  evaluatePaidApprovalBinding,
  paidOperationCapability,
  serverOwnedPaidConnectionWriteAccess,
  transitionPaidDraftState,
  type PaidOperationApproval,
  type PaidOperationDenialReason,
} from "./capabilities";
import {
  toPaidCampaignDraftDto,
  type PaidCampaignApprovalDto,
  type PaidCampaignDraftDto,
  type PaidCampaignOperationAttemptDto,
  type PaidDraftRecord,
} from "./dto";
import {
  PaidDraftConflictError,
  PaidDraftNotFoundError,
  PaidDraftUnavailableError,
} from "./errors";
import {
  hashPaidCampaignSnapshotV1,
  hashPaidDraftRequest,
} from "./hash";
import { assertPaidScheduleCurrent } from "./schedule";
import type {
  ApprovePaidDraftBody,
  ConfirmProviderPausedBody,
  CreatePaidDraftBody,
  ExecutePaidDraftBody,
  MarkPaidDraftReadyBody,
  PaidDraftListQuery,
  RecordExternalActivationOutcomeBody,
  UpdatePaidDraftBody,
} from "./parsers";
import type {
  PaidCampaignSnapshotV1,
  PaidDraftSource,
  PaidDraftState,
  PaidPlatform,
} from "./types";
import {
  PaidDraftValidationError,
  parsePaidCampaignSnapshotV1,
} from "./validation";

const PAID_PLATFORMS = new Set<PaidPlatform>([
  "google_ads",
  "meta_ads",
  "tiktok_ads",
]);

const draftInclude = {
  connection: {
    select: {
      id: true,
      workspaceId: true,
      platform: true,
      externalAccountId: true,
      displayName: true,
      status: true,
    },
  },
  approvals: {
    include: { attempt: { select: { id: true } } },
    orderBy: [{ approvedAt: "desc" as const }, { id: "desc" as const }],
  },
  attempts: {
    orderBy: [{ attemptedAt: "desc" as const }, { id: "desc" as const }],
  },
  providerPausedConfirmation: true,
} satisfies Prisma.PaidCampaignDraftInclude;

type PaidDraftRow = Prisma.PaidCampaignDraftGetPayload<{
  include: typeof draftInclude;
}>;

type PaidConnectionRow = NonNullable<PaidDraftRow["connection"]>;

export interface PaidDraftMutationResult {
  draft: PaidCampaignDraftDto;
  replayed: boolean;
}

export interface PaidDraftUsageSettlement {
  idempotencyKey: string;
  committedAt?: Date;
}

export interface PaidDraftApprovalResult extends PaidDraftMutationResult {
  approval: PaidCampaignApprovalDto;
}

export interface PaidDraftOperationResult extends PaidDraftMutationResult {
  attempt: PaidCampaignOperationAttemptDto;
}

function requireManager(role: WorkspaceRole): void {
  if (role !== "owner" && role !== "admin") {
    throw new WorkspaceAuthorizationError();
  }
}

function isUniqueConflict(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === "P2002"
  );
}

function paidPlatform(value: string): PaidPlatform {
  if (!PAID_PLATFORMS.has(value as PaidPlatform)) {
    throw new PaidDraftValidationError(
      "unsupported_connection",
      "The selected connection is not a supported paid platform",
      "connectionId",
    );
  }
  return value as PaidPlatform;
}

async function lockWorkspace(
  tx: Prisma.TransactionClient,
  workspaceId: string,
): Promise<void> {
  const rows = await tx.$queryRaw<Array<{ id: string }>>`
    SELECT "id" FROM "workspaces" WHERE "id" = ${workspaceId} FOR UPDATE
  `;
  if (!rows.length) throw new PaidDraftNotFoundError();
}

async function lockDraft(
  tx: Prisma.TransactionClient,
  workspaceId: string,
  draftId: string,
): Promise<void> {
  const rows = await tx.$queryRaw<Array<{ id: string }>>`
    SELECT "id"
    FROM "paid_campaign_drafts"
    WHERE "id" = ${draftId} AND "workspace_id" = ${workspaceId}
    FOR UPDATE
  `;
  if (!rows.length) throw new PaidDraftNotFoundError();
}

async function findDraft(
  db: Pick<Prisma.TransactionClient, "paidCampaignDraft">,
  workspaceId: string,
  draftId: string,
): Promise<PaidDraftRow> {
  const row = await db.paidCampaignDraft.findFirst({
    where: { id: draftId, workspaceId },
    include: draftInclude,
  });
  if (!row) throw new PaidDraftNotFoundError();
  return row;
}

async function findConnection(
  db: Pick<Prisma.TransactionClient, "connection">,
  workspaceId: string,
  connectionId: string,
): Promise<PaidConnectionRow> {
  const row = await db.connection.findFirst({
    where: { id: connectionId, workspaceId },
    select: draftInclude.connection.select,
  });
  if (!row) throw new PaidDraftNotFoundError();
  paidPlatform(row.platform);
  return row;
}

async function currentConnection(
  db: Pick<Prisma.TransactionClient, "connection">,
  row: PaidDraftRow,
): Promise<PaidConnectionRow> {
  if (!row.connectionId) {
    throw new PaidDraftConflictError(
      "connection_unavailable",
      "The paid account used by this draft is no longer connected",
      row.version,
    );
  }
  const connection = await findConnection(db, row.workspaceId, row.connectionId);
  if (
    connection.platform !== row.platform ||
    connection.externalAccountId !== row.accountId
  ) {
    throw new PaidDraftConflictError(
      "account_mismatch",
      "The paid account no longer matches this draft",
      row.version,
    );
  }
  return connection;
}

function serverSnapshot(
  value: unknown,
  connection: PaidConnectionRow,
  source: PaidDraftSource,
): PaidCampaignSnapshotV1 {
  const clientSnapshot = parsePaidCampaignSnapshotV1(value);
  const platform = paidPlatform(connection.platform);
  if (
    clientSnapshot.platform !== platform ||
    clientSnapshot.connection.platform !== platform ||
    clientSnapshot.connection.connectionId !== connection.id ||
    clientSnapshot.connection.accountId !== connection.externalAccountId
  ) {
    throw new PaidDraftValidationError(
      "account_mismatch",
      "The snapshot does not match the selected workspace connection",
      "connection",
    );
  }
  return parsePaidCampaignSnapshotV1(
    {
      ...clientSnapshot,
      source,
      connection: {
        platform,
        connectionId: connection.id,
        accountId: connection.externalAccountId,
        accountName: connection.displayName?.trim() || connection.externalAccountId,
      },
    },
    {
      expectedPlatform: platform,
      expectedConnectionId: connection.id,
      expectedAccountId: connection.externalAccountId,
    },
  );
}

function storedDraftSource(value: string): PaidDraftSource {
  if (value === "manual" || value === "ai") return value;
  throw new PaidDraftUnavailableError(
    "invalid_persisted_source",
    "The paid campaign draft has invalid provenance",
  );
}

function snapshotWithSource(
  value: unknown,
  source: PaidDraftSource,
): PaidCampaignSnapshotV1 {
  const snapshot = parsePaidCampaignSnapshotV1(value);
  return parsePaidCampaignSnapshotV1({ ...snapshot, source });
}

function requestSnapshot(snapshot: PaidCampaignSnapshotV1): unknown {
  return {
    ...snapshot,
    connection: {
      platform: snapshot.connection.platform,
      connectionId: snapshot.connection.connectionId,
      accountId: snapshot.connection.accountId,
    },
  };
}

async function verifySnapshotAssets(
  db: Pick<Prisma.TransactionClient, "asset">,
  workspaceId: string,
  snapshot: PaidCampaignSnapshotV1,
): Promise<void> {
  const assetIds = paidDraftAssetIds(snapshot);
  if (!assetIds.length) return;
  const assets = await db.asset.findMany({
    where: { workspaceId, id: { in: assetIds } },
    select: { id: true, kind: true, mimeType: true },
  });
  assertPaidDraftAssetSuitability(snapshot, assets);
}

function writeAccess(row: PaidDraftRow) {
  const snapshot = parsePaidCampaignSnapshotV1(row.snapshot);
  return serverOwnedPaidConnectionWriteAccess({
    platform: snapshot.platform,
    connectionId: snapshot.connection.connectionId,
    accountId: snapshot.connection.accountId,
    oauthConnected:
      row.connection?.status === "connected" &&
      row.connection.workspaceId === row.workspaceId &&
      row.connection.platform === snapshot.platform &&
      row.connection.externalAccountId === snapshot.connection.accountId,
  });
}

function dto(row: PaidDraftRow, actorRole: WorkspaceRole): PaidCampaignDraftDto {
  return toPaidCampaignDraftDto({
    row: row as unknown as PaidDraftRecord,
    actorRole,
    writeAccess: writeAccess(row),
  });
}

function assertVersion(
  row: PaidDraftRow,
  expectedVersion: number,
  snapshotHash: string,
): void {
  if (row.version !== expectedVersion) {
    throw new PaidDraftConflictError(
      "version_conflict",
      "The paid draft changed since it was loaded",
      row.version,
    );
  }
  if (row.snapshotHash !== snapshotHash) {
    throw new PaidDraftConflictError(
      "snapshot_conflict",
      "The paid draft snapshot no longer matches this request",
      row.version,
    );
  }
}

function requestConflict(): PaidDraftConflictError {
  return new PaidDraftConflictError(
    "request_conflict",
    "This requestId is already bound to a different paid draft mutation",
  );
}

function assertReplay(
  row: { draftId: string; requestHash: string; kind?: string },
  expected: { draftId: string; requestHash: string; kind?: string },
): void {
  if (
    row.draftId !== expected.draftId ||
    row.requestHash !== expected.requestHash ||
    (expected.kind !== undefined && row.kind !== expected.kind)
  ) {
    throw requestConflict();
  }
}

async function replayDraftMutation(input: {
  workspaceId: string;
  requestId: string;
  requestHash: string;
  kind: string;
  draftId?: string;
  actorRole: WorkspaceRole;
}): Promise<PaidDraftMutationResult | null> {
  const mutation = await prisma.paidCampaignDraftMutation.findUnique({
    where: {
      workspaceId_requestId: {
        workspaceId: input.workspaceId,
        requestId: input.requestId,
      },
    },
    include: { draft: { include: draftInclude } },
  });
  if (!mutation) return null;
  assertReplay(mutation, {
    draftId: input.draftId ?? mutation.draftId,
    requestHash: input.requestHash,
    kind: input.kind,
  });
  return { draft: dto(mutation.draft, input.actorRole), replayed: true };
}

async function replayApproval(input: {
  workspaceId: string;
  draftId: string;
  requestId: string;
  requestHash: string;
  kind: ApprovePaidDraftBody["kind"];
  actorRole: WorkspaceRole;
}): Promise<PaidDraftApprovalResult | null> {
  const approval = await prisma.paidCampaignApproval.findUnique({
    where: {
      workspaceId_requestId: {
        workspaceId: input.workspaceId,
        requestId: input.requestId,
      },
    },
    include: {
      attempt: { select: { id: true } },
      draft: { include: draftInclude },
    },
  });
  if (!approval) return null;
  assertReplay(approval, input);
  const draft = dto(approval.draft, input.actorRole);
  const result = draft.approvals.find((item) => item.id === approval.id);
  if (!result) throw new PaidDraftUnavailableError("approval_missing", "Approval could not be loaded");
  return { draft, approval: result, replayed: true };
}

async function replayOperation(input: {
  workspaceId: string;
  draftId: string;
  requestId: string;
  requestHash: string;
  operation: string;
  actorRole: WorkspaceRole;
}): Promise<PaidDraftOperationResult | null> {
  const attempt = await prisma.paidCampaignOperationAttempt.findUnique({
    where: {
      workspaceId_requestId: {
        workspaceId: input.workspaceId,
        requestId: input.requestId,
      },
    },
    include: { draft: { include: draftInclude } },
  });
  if (!attempt) return null;
  assertReplay(
    { draftId: attempt.draftId, requestHash: attempt.requestHash, kind: attempt.operation },
    { draftId: input.draftId, requestHash: input.requestHash, kind: input.operation },
  );
  const draft = dto(attempt.draft, input.actorRole);
  const result = draft.attempts.find((item) => item.id === attempt.id);
  if (!result) throw new PaidDraftUnavailableError("attempt_missing", "Operation attempt could not be loaded");
  return { draft, attempt: result, replayed: true };
}

async function replayProviderPausedConfirmation(input: {
  workspaceId: string;
  draftId: string;
  requestId: string;
  requestHash: string;
  actorRole: WorkspaceRole;
}): Promise<PaidDraftMutationResult | null> {
  const confirmation =
    await prisma.paidCampaignProviderPausedConfirmation.findUnique({
      where: {
        workspaceId_requestId: {
          workspaceId: input.workspaceId,
          requestId: input.requestId,
        },
      },
      include: { draft: { include: draftInclude } },
    });
  if (!confirmation) return null;
  assertReplay(confirmation, input);
  return {
    draft: dto(confirmation.draft, input.actorRole),
    replayed: true,
  };
}

export async function listPaidCampaignDrafts(input: {
  workspaceId: string;
  actorRole: WorkspaceRole;
  query: PaidDraftListQuery;
}): Promise<PaidCampaignDraftDto[]> {
  const rows = await prisma.paidCampaignDraft.findMany({
    where: {
      workspaceId: input.workspaceId,
      ...(input.query.platform ? { platform: input.query.platform } : {}),
      ...(input.query.state ? { state: input.query.state } : {}),
    },
    include: draftInclude,
    orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
    take: input.query.limit,
  });
  return rows.map((row) => dto(row, input.actorRole));
}

export async function getPaidCampaignDraft(input: {
  workspaceId: string;
  draftId: string;
  actorRole: WorkspaceRole;
}): Promise<PaidCampaignDraftDto> {
  return dto(await findDraft(prisma, input.workspaceId, input.draftId), input.actorRole);
}

export async function getPaidCampaignDraftCreatedByRequest(input: {
  workspaceId: string;
  requestId: string;
  actorRole: WorkspaceRole;
}): Promise<PaidDraftMutationResult | null> {
  const mutation = await prisma.paidCampaignDraftMutation.findUnique({
    where: {
      workspaceId_requestId: {
        workspaceId: input.workspaceId,
        requestId: input.requestId,
      },
    },
    include: { draft: { include: draftInclude } },
  });
  if (!mutation) return null;
  if (mutation.kind !== "create") throw requestConflict();
  return { draft: dto(mutation.draft, input.actorRole), replayed: true };
}

interface PaidDraftCreateInput {
  workspaceId: string;
  actorId: string;
  actorRole: WorkspaceRole;
  body: CreatePaidDraftBody;
}

async function createPaidCampaignDraftWithSource(input: PaidDraftCreateInput & {
  source: PaidDraftSource;
  settleUsage?: PaidDraftUsageSettlement;
}): Promise<PaidDraftMutationResult> {
  requireManager(input.actorRole);
  const clientSnapshot = snapshotWithSource(input.body.snapshot, input.source);
  const requestHash = hashPaidDraftRequest({
    kind: "create",
    connectionId: input.body.connectionId,
    snapshot: requestSnapshot(clientSnapshot),
  });
  const prior = await replayDraftMutation({
    workspaceId: input.workspaceId,
    requestId: input.body.requestId,
    requestHash,
    kind: "create",
    actorRole: input.actorRole,
  });
  if (prior) return prior;

  try {
    return await prisma.$transaction(async (tx) => {
      await lockWorkspace(tx, input.workspaceId);
      const replay = await tx.paidCampaignDraftMutation.findUnique({
        where: {
          workspaceId_requestId: {
            workspaceId: input.workspaceId,
            requestId: input.body.requestId,
          },
        },
        include: { draft: { include: draftInclude } },
      });
      if (replay) {
        assertReplay(replay, {
          draftId: replay.draftId,
          requestHash,
          kind: "create",
        });
        return { draft: dto(replay.draft, input.actorRole), replayed: true };
      }
      const lockedConnection = await findConnection(
        tx,
        input.workspaceId,
        input.body.connectionId,
      );
      if (lockedConnection.status !== "connected") {
        throw new PaidDraftConflictError(
          "connection_unavailable",
          "Connect this paid account before creating a campaign draft",
        );
      }
      const canonicalSnapshot = serverSnapshot(
        clientSnapshot,
        lockedConnection,
        input.source,
      );
      const snapshotHash = hashPaidCampaignSnapshotV1(canonicalSnapshot);
      await verifySnapshotAssets(tx, input.workspaceId, canonicalSnapshot);
      const row = await tx.paidCampaignDraft.create({
        data: {
          workspaceId: input.workspaceId,
          connectionId: lockedConnection.id,
          platform: canonicalSnapshot.platform,
          accountId: canonicalSnapshot.connection.accountId,
          accountName: canonicalSnapshot.connection.accountName,
          source: canonicalSnapshot.source,
          template: canonicalSnapshot.template,
          state: "draft",
          snapshot: canonicalSnapshot as unknown as Prisma.InputJsonValue,
          snapshotHash,
          createdBy: input.actorId,
          updatedBy: input.actorId,
        },
        include: draftInclude,
      });
      await tx.paidCampaignDraftMutation.create({
        data: {
          workspaceId: input.workspaceId,
          draftId: row.id,
          requestId: input.body.requestId,
          requestHash,
          kind: "create",
          resultVersion: row.version,
          resultState: row.state,
          actorId: input.actorId,
        },
      });
      if (input.settleUsage) {
        const committed = await commitUsageReservationWithDb(
          tx,
          input.workspaceId,
          input.settleUsage.idempotencyKey,
          input.settleUsage.committedAt ?? new Date(),
        );
        if (!committed) {
          throw new PaidDraftUnavailableError(
            "usage_settlement_failed",
            "The generated paid campaign draft could not be finalized. Retry safely.",
          );
        }
      }
      return { draft: dto(row, input.actorRole), replayed: false };
    });
  } catch (error) {
    if (!isUniqueConflict(error)) throw error;
    const replay = await replayDraftMutation({
      workspaceId: input.workspaceId,
      requestId: input.body.requestId,
      requestHash,
      kind: "create",
      actorRole: input.actorRole,
    });
    if (replay) return replay;
    throw requestConflict();
  }
}

/** Browser/manual creation always owns manual provenance. */
export async function createPaidCampaignDraft(
  input: PaidDraftCreateInput,
): Promise<PaidDraftMutationResult> {
  return createPaidCampaignDraftWithSource({ ...input, source: "manual" });
}

/** Trusted AI generation path; callers must settle the reserved AI usage. */
export async function createAiPaidCampaignDraft(
  input: PaidDraftCreateInput & { settleUsage: PaidDraftUsageSettlement },
): Promise<PaidDraftMutationResult> {
  return createPaidCampaignDraftWithSource({ ...input, source: "ai" });
}

export async function updatePaidCampaignDraft(input: {
  workspaceId: string;
  draftId: string;
  actorId: string;
  actorRole: WorkspaceRole;
  body: UpdatePaidDraftBody;
}): Promise<PaidDraftMutationResult> {
  requireManager(input.actorRole);
  const initiallyLoaded = await findDraft(
    prisma,
    input.workspaceId,
    input.draftId,
  );
  const persistedSource = storedDraftSource(initiallyLoaded.source);
  const clientSnapshot = snapshotWithSource(
    input.body.snapshot,
    persistedSource,
  );
  const requestHash = hashPaidDraftRequest({
    kind: "update",
    draftId: input.draftId,
    expectedVersion: input.body.expectedVersion,
    snapshot: requestSnapshot(clientSnapshot),
  });
  const prior = await replayDraftMutation({
    workspaceId: input.workspaceId,
    requestId: input.body.requestId,
    requestHash,
    kind: "update",
    draftId: input.draftId,
    actorRole: input.actorRole,
  });
  if (prior) return prior;
  try {
    return await prisma.$transaction(async (tx) => {
      await lockDraft(tx, input.workspaceId, input.draftId);
      const current = await findDraft(tx, input.workspaceId, input.draftId);
      const replay = await tx.paidCampaignDraftMutation.findUnique({
        where: {
          workspaceId_requestId: {
            workspaceId: input.workspaceId,
            requestId: input.body.requestId,
          },
        },
        include: { draft: { include: draftInclude } },
      });
      if (replay) {
        assertReplay(replay, {
          draftId: input.draftId,
          requestHash,
          kind: "update",
        });
        return { draft: dto(replay.draft, input.actorRole), replayed: true };
      }
      const connection = await currentConnection(tx, current);
      const currentSource = storedDraftSource(current.source);
      if (currentSource !== persistedSource) throw requestConflict();
      const snapshot = serverSnapshot(clientSnapshot, connection, currentSource);
      await verifySnapshotAssets(tx, input.workspaceId, snapshot);
      const snapshotHash = hashPaidCampaignSnapshotV1(snapshot);
      if (current.state !== "draft" && !(current.state === "ready" && current.attempts.length === 0)) {
        throw new PaidDraftConflictError(
          "invalid_state",
          "Only drafts and ready campaigns with no handoff or execution attempts can be edited",
          current.version,
        );
      }
      if (current.version !== input.body.expectedVersion) {
        throw new PaidDraftConflictError(
          "version_conflict",
          "The paid draft changed since it was loaded",
          current.version,
        );
      }
      const updated = await tx.paidCampaignDraft.update({
        where: { id: current.id },
        data: {
          platform: snapshot.platform,
          accountId: snapshot.connection.accountId,
          accountName: snapshot.connection.accountName,
          source: currentSource,
          template: snapshot.template,
          snapshot: snapshot as unknown as Prisma.InputJsonValue,
          snapshotHash,
          state: "draft",
          readyAt: null,
          version: { increment: 1 },
          updatedBy: input.actorId,
        },
        include: draftInclude,
      });
      await tx.paidCampaignDraftMutation.create({
        data: {
          workspaceId: input.workspaceId,
          draftId: current.id,
          requestId: input.body.requestId,
          requestHash,
          kind: "update",
          resultVersion: updated.version,
          resultState: updated.state,
          actorId: input.actorId,
        },
      });
      return { draft: dto(updated, input.actorRole), replayed: false };
    });
  } catch (error) {
    if (isUniqueConflict(error)) throw requestConflict();
    throw error;
  }
}

export async function markPaidCampaignDraftReady(input: {
  workspaceId: string;
  draftId: string;
  actorId: string;
  actorRole: WorkspaceRole;
  body: MarkPaidDraftReadyBody;
  now?: Date;
}): Promise<PaidDraftMutationResult> {
  requireManager(input.actorRole);
  const requestHash = hashPaidDraftRequest({
    kind: "mark_ready",
    draftId: input.draftId,
    expectedVersion: input.body.expectedVersion,
    snapshotHash: input.body.snapshotHash,
  });
  const prior = await replayDraftMutation({
    workspaceId: input.workspaceId,
    requestId: input.body.requestId,
    requestHash,
    kind: "mark_ready",
    draftId: input.draftId,
    actorRole: input.actorRole,
  });
  if (prior) return prior;
  try {
    return await prisma.$transaction(async (tx) => {
      await lockDraft(tx, input.workspaceId, input.draftId);
      const current = await findDraft(tx, input.workspaceId, input.draftId);
      const replay = await tx.paidCampaignDraftMutation.findUnique({
        where: {
          workspaceId_requestId: {
            workspaceId: input.workspaceId,
            requestId: input.body.requestId,
          },
        },
        include: { draft: { include: draftInclude } },
      });
      if (replay) {
        assertReplay(replay, {
          draftId: input.draftId,
          requestHash,
          kind: "mark_ready",
        });
        return { draft: dto(replay.draft, input.actorRole), replayed: true };
      }
      await currentConnection(tx, current);
      assertVersion(current, input.body.expectedVersion, input.body.snapshotHash);
      const snapshot = parsePaidCampaignSnapshotV1(current.snapshot);
      await verifySnapshotAssets(tx, input.workspaceId, snapshot);
      assertPaidScheduleCurrent(snapshot.schedule, input.now ?? new Date());
      const state = transitionPaidDraftState(current.state as PaidDraftState, "ready");
      const updated = await tx.paidCampaignDraft.update({
        where: { id: current.id },
        data: {
          state,
          readyAt: input.now ?? new Date(),
          version: { increment: 1 },
          updatedBy: input.actorId,
        },
        include: draftInclude,
      });
      await tx.paidCampaignDraftMutation.create({
        data: {
          workspaceId: input.workspaceId,
          draftId: current.id,
          requestId: input.body.requestId,
          requestHash,
          kind: "mark_ready",
          resultVersion: updated.version,
          resultState: updated.state,
          actorId: input.actorId,
        },
      });
      return { draft: dto(updated, input.actorRole), replayed: false };
    });
  } catch (error) {
    if (isUniqueConflict(error)) throw requestConflict();
    throw error;
  }
}

function hasExactAssistedCreatePausedHandoff(row: PaidDraftRow): boolean {
  return row.attempts.some((attempt) => {
    if (
      attempt.operation !== "create_paused" ||
      attempt.status !== "assisted_handoff" ||
      attempt.snapshotVersion !== row.version ||
      attempt.snapshotHash !== row.snapshotHash ||
      !attempt.providerOutcome ||
      typeof attempt.providerOutcome !== "object" ||
      Array.isArray(attempt.providerOutcome)
    ) {
      return false;
    }
    const outcome = attempt.providerOutcome as Record<string, unknown>;
    return (
      outcome.kind === "assisted_handoff" &&
      outcome.providerSideEffect === "none"
    );
  });
}

function isUnrecordedAssistedActivation(
  attempt: PaidDraftRow["attempts"][number],
  row: PaidDraftRow,
): boolean {
  if (
    attempt.operation !== "activate" ||
    attempt.status !== "assisted_handoff" ||
    attempt.snapshotVersion !== row.version ||
    attempt.snapshotHash !== row.snapshotHash ||
    !attempt.providerOutcome ||
    typeof attempt.providerOutcome !== "object" ||
    Array.isArray(attempt.providerOutcome)
  ) {
    return false;
  }
  const outcome = attempt.providerOutcome as Record<string, unknown>;
  return outcome.kind === "assisted_handoff" && outcome.providerSideEffect === "none";
}

async function throwProviderConfirmationConflict(input: {
  workspaceId: string;
  draftId: string;
  platform: string;
  accountId: string;
  providerCampaignId: string;
}): Promise<never> {
  const existingForDraft =
    await prisma.paidCampaignProviderPausedConfirmation.findFirst({
      where: { workspaceId: input.workspaceId, draftId: input.draftId },
      select: { id: true },
    });
  if (existingForDraft) {
    throw new PaidDraftConflictError(
      "already_confirmed",
      "This paid draft already has a provider-paused confirmation",
    );
  }
  const existingProviderCampaign =
    await prisma.paidCampaignProviderPausedConfirmation.findFirst({
      where: {
        workspaceId: input.workspaceId,
        platform: input.platform,
        accountId: input.accountId,
        providerCampaignId: input.providerCampaignId,
      },
      select: { id: true },
    });
  if (existingProviderCampaign) {
    throw new PaidDraftConflictError(
      "provider_campaign_conflict",
      "This provider campaign is already linked to another paid draft",
    );
  }
  throw requestConflict();
}

export async function confirmPaidCampaignDraftProviderPaused(input: {
  workspaceId: string;
  draftId: string;
  actorId: string;
  actorRole: WorkspaceRole;
  body: ConfirmProviderPausedBody;
  now?: Date;
}): Promise<PaidDraftMutationResult> {
  requireManager(input.actorRole);
  const requestHash = hashPaidDraftRequest({
    kind: "confirm_provider_paused",
    draftId: input.draftId,
    expectedVersion: input.body.expectedVersion,
    snapshotHash: input.body.snapshotHash,
    providerCampaignId: input.body.providerCampaignId,
    confirmation: input.body.confirmation,
  });
  const prior = await replayProviderPausedConfirmation({
    workspaceId: input.workspaceId,
    draftId: input.draftId,
    requestId: input.body.requestId,
    requestHash,
    actorRole: input.actorRole,
  });
  if (prior) return prior;

  try {
    return await prisma.$transaction(async (tx) => {
      await lockDraft(tx, input.workspaceId, input.draftId);
      const current = await findDraft(tx, input.workspaceId, input.draftId);
      const replay =
        await tx.paidCampaignProviderPausedConfirmation.findUnique({
          where: {
            workspaceId_requestId: {
              workspaceId: input.workspaceId,
              requestId: input.body.requestId,
            },
          },
        });
      if (replay) {
        assertReplay(replay, {
          draftId: input.draftId,
          requestHash,
        });
        return { draft: dto(current, input.actorRole), replayed: true };
      }
      const connection = await currentConnection(tx, current);
      assertVersion(current, input.body.expectedVersion, input.body.snapshotHash);
      if (current.providerPausedConfirmation) {
        throw new PaidDraftConflictError(
          "already_confirmed",
          "This paid draft already has a provider-paused confirmation",
          current.version,
        );
      }
      if (current.state !== "ready") {
        throw new PaidDraftConflictError(
          "invalid_state",
          "Only a ready campaign with an assisted paused-creation handoff can be confirmed",
          current.version,
        );
      }
      if (!hasExactAssistedCreatePausedHandoff(current)) {
        throw new PaidDraftConflictError(
          "assisted_handoff_required",
          "Complete the exact approved assisted paused-creation handoff first",
          current.version,
        );
      }
      const state = transitionPaidDraftState(
        current.state as PaidDraftState,
        "provider_paused",
        { assistedConfirmation: true },
      );
      await tx.paidCampaignProviderPausedConfirmation.create({
        data: {
          workspaceId: input.workspaceId,
          draftId: current.id,
          requestId: input.body.requestId,
          requestHash,
          platform: current.platform,
          connectionId: connection.id,
          accountId: connection.externalAccountId,
          providerCampaignId: input.body.providerCampaignId,
          verificationStatus: "user_asserted_unverified",
          snapshotVersion: current.version,
          snapshotHash: current.snapshotHash,
          confirmedBy: input.actorId,
          confirmedAt: input.now ?? new Date(),
        },
      });
      const updated = await tx.paidCampaignDraft.update({
        where: { id: current.id },
        data: {
          state,
          version: { increment: 1 },
          updatedBy: input.actorId,
        },
        include: draftInclude,
      });
      return { draft: dto(updated, input.actorRole), replayed: false };
    });
  } catch (error) {
    if (!isUniqueConflict(error)) throw error;
    const replay = await replayProviderPausedConfirmation({
      workspaceId: input.workspaceId,
      draftId: input.draftId,
      requestId: input.body.requestId,
      requestHash,
      actorRole: input.actorRole,
    });
    if (replay) return replay;
    const current = await findDraft(prisma, input.workspaceId, input.draftId);
    return throwProviderConfirmationConflict({
      workspaceId: input.workspaceId,
      draftId: input.draftId,
      platform: current.platform,
      accountId: current.accountId,
      providerCampaignId: input.body.providerCampaignId,
    });
  }
}

export async function recordPaidCampaignDraftExternalActivationOutcome(input: {
  workspaceId: string;
  draftId: string;
  actorId: string;
  actorRole: WorkspaceRole;
  body: RecordExternalActivationOutcomeBody;
}): Promise<PaidDraftMutationResult> {
  requireManager(input.actorRole);
  const kind = "record_external_activation_outcome";
  const requestHash = hashPaidDraftRequest({
    kind,
    draftId: input.draftId,
    expectedVersion: input.body.expectedVersion,
    snapshotHash: input.body.snapshotHash,
    attemptId: input.body.attemptId,
    outcome: input.body.outcome,
  });
  const prior = await replayDraftMutation({
    workspaceId: input.workspaceId,
    draftId: input.draftId,
    requestId: input.body.requestId,
    requestHash,
    kind,
    actorRole: input.actorRole,
  });
  if (prior) return prior;

  try {
    return await prisma.$transaction(async (tx) => {
      await lockDraft(tx, input.workspaceId, input.draftId);
      const current = await findDraft(tx, input.workspaceId, input.draftId);
      const replay = await tx.paidCampaignDraftMutation.findUnique({
        where: {
          workspaceId_requestId: {
            workspaceId: input.workspaceId,
            requestId: input.body.requestId,
          },
        },
      });
      if (replay) {
        assertReplay(replay, { draftId: input.draftId, requestHash, kind });
        return { draft: dto(current, input.actorRole), replayed: true };
      }
      assertVersion(current, input.body.expectedVersion, input.body.snapshotHash);
      if (current.state !== "provider_paused") {
        throw new PaidDraftConflictError(
          "invalid_state",
          "An external activation outcome can only be recorded while the campaign is provider-paused",
          current.version,
        );
      }
      const attempt = current.attempts.find((item) => item.id === input.body.attemptId);
      if (!attempt || !isUnrecordedAssistedActivation(attempt, current)) {
        throw new PaidDraftConflictError(
          "activation_handoff_required",
          "Record an outcome only for the exact pending assisted activation handoff",
          current.version,
        );
      }

      const providerOutcome = {
        kind: "external_activation_outcome",
        providerSideEffect: "user_asserted_unverified",
        outcome: input.body.outcome,
        message: input.body.outcome === "activated"
          ? "A workspace manager recorded that the campaign was activated externally. Marpin did not verify this with the provider."
          : "A workspace manager recorded that the campaign was not activated externally. A new exact activation approval can be requested.",
      } as const;
      await tx.paidCampaignOperationAttempt.update({
        where: { id: attempt.id },
        data: {
          status: input.body.outcome === "activated" ? "succeeded" : "failed",
          providerOutcome: providerOutcome as unknown as Prisma.InputJsonValue,
        },
      });

      const updated = input.body.outcome === "activated"
        ? await tx.paidCampaignDraft.update({
            where: { id: current.id },
            data: {
              state: transitionPaidDraftState(
                current.state as PaidDraftState,
                "active",
                { assistedActivationOutcome: true },
              ),
              version: { increment: 1 },
              updatedBy: input.actorId,
            },
            include: draftInclude,
          })
        : await findDraft(tx, input.workspaceId, current.id);
      await tx.paidCampaignDraftMutation.create({
        data: {
          workspaceId: input.workspaceId,
          draftId: current.id,
          requestId: input.body.requestId,
          requestHash,
          kind,
          resultVersion: updated.version,
          resultState: updated.state,
          actorId: input.actorId,
        },
      });
      return { draft: dto(updated, input.actorRole), replayed: false };
    });
  } catch (error) {
    if (!isUniqueConflict(error)) throw error;
    const replay = await replayDraftMutation({
      workspaceId: input.workspaceId,
      draftId: input.draftId,
      requestId: input.body.requestId,
      requestHash,
      kind,
      actorRole: input.actorRole,
    });
    if (replay) return replay;
    throw requestConflict();
  }
}

export async function approvePaidCampaignDraftOperation(input: {
  workspaceId: string;
  draftId: string;
  actorId: string;
  actorRole: WorkspaceRole;
  body: ApprovePaidDraftBody;
  now?: Date;
}): Promise<PaidDraftApprovalResult> {
  requireManager(input.actorRole);
  const requestHash = hashPaidDraftRequest({
    kind: input.body.kind,
    draftId: input.draftId,
    expectedVersion: input.body.expectedVersion,
    snapshotHash: input.body.snapshotHash,
  });
  const prior = await replayApproval({
    workspaceId: input.workspaceId,
    draftId: input.draftId,
    requestId: input.body.requestId,
    requestHash,
    kind: input.body.kind,
    actorRole: input.actorRole,
  });
  if (prior) return prior;

  try {
    return await prisma.$transaction(async (tx) => {
      await lockDraft(tx, input.workspaceId, input.draftId);
      const current = await findDraft(tx, input.workspaceId, input.draftId);
      const connection = await currentConnection(tx, current);
      assertVersion(current, input.body.expectedVersion, input.body.snapshotHash);
      const requiredState = input.body.kind === "create_paused" ? "ready" : "provider_paused";
      if (current.state !== requiredState) {
        throw new PaidDraftConflictError(
          "invalid_state",
          input.body.kind === "create_paused"
            ? "Paused creation can only be approved from a ready draft"
            : "Activation needs a separately approved provider-paused campaign",
          current.version,
        );
      }
      const replay = await tx.paidCampaignApproval.findUnique({
        where: {
          workspaceId_requestId: {
            workspaceId: input.workspaceId,
            requestId: input.body.requestId,
          },
        },
        include: { attempt: { select: { id: true } } },
      });
      if (replay) {
        assertReplay(replay, {
          draftId: input.draftId,
          requestHash,
          kind: input.body.kind,
        });
        const draft = dto(current, input.actorRole);
        const approval = draft.approvals.find((item) => item.id === replay.id);
        if (!approval) throw new PaidDraftUnavailableError("approval_missing", "Approval could not be loaded");
        return { draft, approval, replayed: true };
      }
      assertPaidScheduleCurrent(
        parsePaidCampaignSnapshotV1(current.snapshot).schedule,
        input.now ?? new Date(),
        input.body.kind === "create_paused",
      );
      const approval = await tx.paidCampaignApproval.create({
        data: {
          workspaceId: input.workspaceId,
          draftId: current.id,
          requestId: input.body.requestId,
          requestHash,
          kind: input.body.kind,
          platform: current.platform,
          connectionId: connection.id,
          accountId: connection.externalAccountId,
          snapshotVersion: current.version,
          snapshotHash: current.snapshotHash,
          approvedBy: input.actorId,
          approvedAt: input.now ?? new Date(),
        },
      });
      const refreshed = await findDraft(tx, input.workspaceId, current.id);
      const draft = dto(refreshed, input.actorRole);
      const result = draft.approvals.find((item) => item.id === approval.id);
      if (!result) throw new PaidDraftUnavailableError("approval_missing", "Approval could not be loaded");
      return { draft, approval: result, replayed: false };
    });
  } catch (error) {
    if (!isUniqueConflict(error)) throw error;
    const replay = await replayApproval({
      workspaceId: input.workspaceId,
      draftId: input.draftId,
      requestId: input.body.requestId,
      requestHash,
      kind: input.body.kind,
      actorRole: input.actorRole,
    });
    if (replay) return replay;
    throw requestConflict();
  }
}

function denialConflict(reason: PaidOperationDenialReason, version: number): PaidDraftConflictError {
  const messages: Record<PaidOperationDenialReason, string> = {
    invalid_operation: "This paid operation is not supported",
    provider_write_unavailable: "Provider execution is unavailable",
    account_mismatch: "The approval account does not match this draft",
    invalid_state: "The draft is not in the required state for this operation",
    approval_not_approved: "The operation has not been approved",
    approval_consumed: "This approval has already been consumed",
    approval_kind_mismatch: "A separate approval is required for this operation",
    stale_approval: "The approval is stale because the draft snapshot changed",
    invalid_snapshot_binding: "The approval snapshot binding is invalid",
  };
  return new PaidDraftConflictError(reason, messages[reason], version);
}

export async function executePaidCampaignDraftOperation(input: {
  workspaceId: string;
  draftId: string;
  actorId: string;
  actorRole: WorkspaceRole;
  body: ExecutePaidDraftBody;
  now?: Date;
}): Promise<PaidDraftOperationResult> {
  requireManager(input.actorRole);
  const requestHash = hashPaidDraftRequest({
    operation: input.body.operation,
    draftId: input.draftId,
    approvalId: input.body.approvalId,
    expectedVersion: input.body.expectedVersion,
    snapshotHash: input.body.snapshotHash,
  });
  const prior = await replayOperation({
    workspaceId: input.workspaceId,
    draftId: input.draftId,
    requestId: input.body.requestId,
    requestHash,
    operation: input.body.operation,
    actorRole: input.actorRole,
  });
  if (prior) return prior;

  try {
    return await prisma.$transaction(async (tx) => {
      await lockDraft(tx, input.workspaceId, input.draftId);
      const current = await findDraft(tx, input.workspaceId, input.draftId);
      const replay = await tx.paidCampaignOperationAttempt.findUnique({
        where: {
          workspaceId_requestId: {
            workspaceId: input.workspaceId,
            requestId: input.body.requestId,
          },
        },
      });
      if (replay) {
        assertReplay(
          {
            draftId: replay.draftId,
            requestHash: replay.requestHash,
            kind: replay.operation,
          },
          {
            draftId: input.draftId,
            requestHash,
            kind: input.body.operation,
          },
        );
        const draft = dto(current, input.actorRole);
        const attempt = draft.attempts.find((item) => item.id === replay.id);
        if (!attempt) {
          throw new PaidDraftUnavailableError(
            "attempt_missing",
            "Operation attempt could not be loaded",
          );
        }
        return { draft, attempt, replayed: true };
      }
      const connection = await currentConnection(tx, current);
      assertVersion(current, input.body.expectedVersion, input.body.snapshotHash);

      const approval = await tx.paidCampaignApproval.findFirst({
        where: {
          id: input.body.approvalId,
          workspaceId: input.workspaceId,
          draftId: current.id,
        },
        include: { attempt: { select: { id: true } } },
      });
      if (!approval) throw new PaidDraftNotFoundError();
      const binding: PaidOperationApproval = {
        approvalId: approval.id,
        status: approval.attempt ? "consumed" : "approved",
        kind: approval.kind as PaidOperationApproval["kind"],
        platform: paidPlatform(approval.platform),
        connectionId: approval.connectionId,
        accountId: approval.accountId,
        snapshotVersion: approval.snapshotVersion,
        snapshotHash: approval.snapshotHash,
      };
      const decision = evaluatePaidApprovalBinding(
        {
          operation: input.body.operation,
          state: current.state as PaidDraftState,
          platform: paidPlatform(current.platform),
          connectionId: connection.id,
          accountId: connection.externalAccountId,
          snapshotVersion: current.version,
          snapshotHash: current.snapshotHash,
        },
        binding,
      );
      if (!decision.allowed) throw denialConflict(decision.reason, current.version);

      assertPaidScheduleCurrent(
        parsePaidCampaignSnapshotV1(current.snapshot).schedule,
        input.now ?? new Date(),
        input.body.operation === "create_paused",
      );

      const access = serverOwnedPaidConnectionWriteAccess({
        platform: paidPlatform(connection.platform),
        connectionId: connection.id,
        accountId: connection.externalAccountId,
        oauthConnected: connection.status === "connected",
      });
      const capability = paidOperationCapability(access, input.body.operation);
      if (capability.canExecuteProvider) {
        throw new PaidDraftUnavailableError(
          "provider_writer_unavailable",
          "No reviewed paid provider writer is installed",
        );
      }

      const outcome = {
        kind: "assisted_handoff",
        providerSideEffect: "none",
        message:
          input.body.operation === "create_paused"
            ? "Marpin prepared and approved this exact campaign, but did not create it in the ad platform."
            : "Marpin approved this exact activation, but did not activate the campaign in the ad platform.",
        nextSteps:
          input.body.operation === "create_paused"
            ? [
                "Open the connected ad platform account.",
                "Create the campaign from this reviewed snapshot and keep it paused.",
                "Return to Marpin before requesting a separate activation approval.",
              ]
            : [
                "Open the connected ad platform account.",
                "Confirm the campaign still matches this reviewed snapshot.",
                "Activate it manually and record the result in your operating log.",
              ],
      } as const;
      const attempt = await tx.paidCampaignOperationAttempt.create({
        data: {
          workspaceId: input.workspaceId,
          draftId: current.id,
          approvalId: approval.id,
          requestId: input.body.requestId,
          requestHash,
          operation: input.body.operation,
          snapshotVersion: current.version,
          snapshotHash: current.snapshotHash,
          status: "assisted_handoff",
          capabilityReason: capability.reason,
          providerOutcome: outcome as unknown as Prisma.InputJsonValue,
          actorId: input.actorId,
          attemptedAt: input.now ?? new Date(),
        },
      });
      const refreshed = await findDraft(tx, input.workspaceId, current.id);
      const draft = dto(refreshed, input.actorRole);
      const result = draft.attempts.find((item) => item.id === attempt.id);
      if (!result) throw new PaidDraftUnavailableError("attempt_missing", "Operation attempt could not be loaded");
      return { draft, attempt: result, replayed: false };
    });
  } catch (error) {
    if (!isUniqueConflict(error)) throw error;
    const replay = await replayOperation({
      workspaceId: input.workspaceId,
      draftId: input.draftId,
      requestId: input.body.requestId,
      requestHash,
      operation: input.body.operation,
      actorRole: input.actorRole,
    });
    if (replay) return replay;
    const approvalAttempt = await prisma.paidCampaignOperationAttempt.findUnique({
      where: { approvalId: input.body.approvalId },
      select: { id: true },
    });
    if (approvalAttempt) {
      throw new PaidDraftConflictError(
        "approval_consumed",
        "This approval has already been consumed",
      );
    }
    throw requestConflict();
  }
}
