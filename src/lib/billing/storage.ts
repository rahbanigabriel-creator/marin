import { randomUUID } from "node:crypto";

import type { Prisma } from "@prisma/client";

import { PLANS, type LaunchPlanId } from "@/lib/billing/plans";
import { resolveWorkspaceBillingPolicy } from "@/lib/billing/entitlements";
import { prisma } from "@/lib/db";

export const PENDING_ASSET_STORAGE_PREFIX = "marpin:storage-reservation:";
export const DELETING_ASSET_STORAGE_PREFIX = "marpin:storage-delete:";
export const STALE_ASSET_STORAGE_RESERVATION_MS = 15 * 60 * 1_000;
export const STORAGE_UPGRADE_URL = "/settings/billing";

export interface StorageLimitDecision {
  allowed: boolean;
  currentBytes: number;
  requestedBytes: number;
  limitBytes: number;
  remainingBytes: number;
}

export interface AssetStorageReservation {
  id: string;
  workspaceId: string;
  pendingStorageKey: string;
  planId: LaunchPlanId;
  currentBytes: number;
  requestedBytes: number;
  limitBytes: number;
}

export type AssetStorageReservationIdentity = Pick<
  AssetStorageReservation,
  "id" | "workspaceId" | "pendingStorageKey"
>;

export interface ReserveAssetStorageInput {
  workspaceId: string;
  kind: "image" | "video";
  mimeType: string;
  bytes: number;
  filename: string | null;
  source?: "upload" | "generated" | "imported";
  metadata?: Prisma.InputJsonValue;
  now?: Date;
}

export class StorageLimitExceededError extends Error {
  readonly code = "storage_limit";
  readonly actionUrl = STORAGE_UPGRADE_URL;

  constructor(
    readonly planId: LaunchPlanId,
    readonly currentBytes: number,
    readonly requestedBytes: number,
    readonly limitBytes: number,
  ) {
    super(`This upload would exceed the ${PLANS[planId].name} storage allowance.`);
    this.name = "StorageLimitExceededError";
  }
}

export function evaluateStorageLimit(
  currentBytes: number,
  requestedBytes: number,
  limitBytes: number,
): StorageLimitDecision {
  for (const [label, value] of Object.entries({ currentBytes, requestedBytes, limitBytes })) {
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new Error(`${label} must be a non-negative safe integer`);
    }
  }

  const remainingBytes = Math.max(0, limitBytes - currentBytes);
  return {
    allowed: requestedBytes <= remainingBytes,
    currentBytes,
    requestedBytes,
    limitBytes,
    remainingBytes,
  };
}

export function isPendingAssetStorageKey(storageKey: string): boolean {
  return storageKey.startsWith(PENDING_ASSET_STORAGE_PREFIX);
}

export function isUnavailableAssetStorageKey(storageKey: string): boolean {
  return isPendingAssetStorageKey(storageKey) || storageKey.startsWith(DELETING_ASSET_STORAGE_PREFIX);
}

export function deletingAssetStorageKey(storageKey: string): string {
  return `${DELETING_ASSET_STORAGE_PREFIX}${storageKey}`;
}

export function storageKeyFromDeletionMarker(storageKey: string): string | null {
  return storageKey.startsWith(DELETING_ASSET_STORAGE_PREFIX)
    ? storageKey.slice(DELETING_ASSET_STORAGE_PREFIX.length)
    : null;
}

/**
 * Reserve aggregate storage under the workspace row lock. The Asset row itself
 * is the reservation, so concurrent uploads count each other before either
 * object-storage request begins.
 */
export async function reserveAssetStorage(
  input: ReserveAssetStorageInput,
): Promise<AssetStorageReservation> {
  if (!input.workspaceId) throw new Error("A workspace is required");
  if (!Number.isSafeInteger(input.bytes) || input.bytes < 0) {
    throw new Error("Asset bytes must be a non-negative safe integer");
  }

  const now = input.now ?? new Date();
  const assetId = randomUUID();
  const pendingStorageKey = `${PENDING_ASSET_STORAGE_PREFIX}${assetId}`;

  await cleanupStaleAssetStorageReservations({
    workspaceId: input.workspaceId,
    now,
    take: 20,
  }).catch(() => undefined);

  return prisma.$transaction(async (tx) => {
    const workspace = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT "id" FROM "workspaces" WHERE "id" = ${input.workspaceId} FOR UPDATE
    `;
    if (!workspace.length) throw new Error("Workspace not found");

    const policy = await resolveWorkspaceBillingPolicy(input.workspaceId, tx, now);
    const limitBytes = PLANS[policy.planId].entitlements.storageBytes;
    const aggregate = await tx.asset.aggregate({
      _sum: { bytes: true },
      where: { workspaceId: input.workspaceId },
    });
    const currentBytes = aggregate._sum.bytes ?? 0;
    const decision = evaluateStorageLimit(currentBytes, input.bytes, limitBytes);

    if (!decision.allowed) {
      throw new StorageLimitExceededError(
        policy.planId,
        currentBytes,
        input.bytes,
        limitBytes,
      );
    }

    const reservation = await tx.asset.create({
      data: {
        id: assetId,
        workspaceId: input.workspaceId,
        kind: input.kind,
        mimeType: input.mimeType,
        bytes: input.bytes,
        storageKey: pendingStorageKey,
        filename: input.filename,
        source: input.source ?? "upload",
        metadata: input.metadata,
      },
      select: { id: true },
    });

    return {
      id: reservation.id,
      workspaceId: input.workspaceId,
      pendingStorageKey,
      planId: policy.planId,
      currentBytes,
      requestedBytes: input.bytes,
      limitBytes,
    };
  });
}

/** Finalize only the exact pending row reserved by this request. */
export async function commitAssetStorageReservation(
  reservation: AssetStorageReservationIdentity,
  storageKey: string,
): Promise<void> {
  if (!storageKey || isPendingAssetStorageKey(storageKey)) {
    throw new Error("A finalized asset storage key is required");
  }

  const committed = await commitAssetStorageReservationWithDb(
    prisma,
    reservation,
    storageKey,
  );
  if (!committed) throw new Error("Asset storage reservation is no longer active");
}

type AssetStorageSettlementDatabase = Pick<Prisma.TransactionClient, "asset">;

export async function commitAssetStorageReservationWithDb(
  db: AssetStorageSettlementDatabase,
  reservation: AssetStorageReservationIdentity,
  storageKey: string,
): Promise<boolean> {
  if (!storageKey || isPendingAssetStorageKey(storageKey)) {
    throw new Error("A finalized asset storage key is required");
  }
  const result = await db.asset.updateMany({
    where: {
      id: reservation.id,
      workspaceId: reservation.workspaceId,
      storageKey: reservation.pendingStorageKey,
    },
    data: { storageKey },
  });
  return result.count === 1;
}

/** Idempotently release an unfinished reservation without touching finalized assets. */
export async function releaseAssetStorageReservation(
  reservation: AssetStorageReservationIdentity,
  options: {
    deleteReservationBlobs?: (workspaceId: string, assetId: string) => Promise<number>;
  } = {},
): Promise<void> {
  const cleanupKey = `${PENDING_ASSET_STORAGE_PREFIX}cleanup:${reservation.id}`;
  const claimed = await prisma.asset.updateMany({
    where: {
      id: reservation.id,
      workspaceId: reservation.workspaceId,
      storageKey: reservation.pendingStorageKey,
    },
    data: { storageKey: cleanupKey },
  });
  if (!claimed.count) return;
  const deleteReservationBlobs = options.deleteReservationBlobs ??
    (await import("@/lib/storage/blob")).deleteAssetReservationBlobs;
  await deleteReservationBlobs(reservation.workspaceId, reservation.id);
  await prisma.asset.deleteMany({
    where: {
      id: reservation.id,
      workspaceId: reservation.workspaceId,
      storageKey: cleanupKey,
    },
  });
}

export async function cleanupStaleAssetStorageReservations(input: {
  workspaceId?: string;
  now?: Date;
  take?: number;
  deleteReservationBlobs?: (workspaceId: string, assetId: string) => Promise<number>;
} = {}): Promise<{ claimed: number; deletedRows: number; deletedBlobs: number; failed: number }> {
  const now = input.now ?? new Date();
  const take = Math.min(Math.max(input.take ?? 100, 1), 500);
  const stale = await prisma.asset.findMany({
    where: {
      ...(input.workspaceId ? { workspaceId: input.workspaceId } : {}),
      storageKey: { startsWith: PENDING_ASSET_STORAGE_PREFIX },
      createdAt: { lt: new Date(now.getTime() - STALE_ASSET_STORAGE_RESERVATION_MS) },
    },
    select: { id: true, workspaceId: true, storageKey: true },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    take,
  });
  let claimed = 0;
  let deletedRows = 0;
  let deletedBlobs = 0;
  let failed = 0;
  const deleteReservationBlobs = input.deleteReservationBlobs ??
    (await import("@/lib/storage/blob")).deleteAssetReservationBlobs;
  for (const asset of stale) {
    const cleanupKey = `${PENDING_ASSET_STORAGE_PREFIX}cleanup:${asset.id}`;
    const claim = await prisma.asset.updateMany({
      where: {
        id: asset.id,
        workspaceId: asset.workspaceId,
        storageKey: asset.storageKey,
      },
      data: { storageKey: cleanupKey },
    });
    if (!claim.count) continue;
    claimed += 1;
    try {
      deletedBlobs += await deleteReservationBlobs(asset.workspaceId, asset.id);
      const deleted = await prisma.asset.deleteMany({
        where: {
          id: asset.id,
          workspaceId: asset.workspaceId,
          storageKey: cleanupKey,
        },
      });
      deletedRows += deleted.count;
    } catch {
      failed += 1;
    }
  }
  return { claimed, deletedRows, deletedBlobs, failed };
}

export async function cleanupDeletingAssets(input: {
  workspaceId?: string;
  take?: number;
  deleteBlob?: (storageKey: string) => Promise<void>;
} = {}): Promise<{ deletedRows: number; deletedBlobs: number; failed: number }> {
  const take = Math.min(Math.max(input.take ?? 100, 1), 500);
  const assets = await prisma.asset.findMany({
    where: {
      ...(input.workspaceId ? { workspaceId: input.workspaceId } : {}),
      storageKey: { startsWith: DELETING_ASSET_STORAGE_PREFIX },
    },
    select: {
      id: true,
      workspaceId: true,
      storageKey: true,
      _count: { select: { contentLinks: true } },
    },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    take,
  });
  let deletedRows = 0;
  let deletedBlobs = 0;
  let failed = 0;
  const deleteBlob = input.deleteBlob ?? (await import("@/lib/storage/blob")).deleteAssetBlob;
  for (const asset of assets) {
    const original = storageKeyFromDeletionMarker(asset.storageKey);
    if (!original) continue;
    if (asset._count.contentLinks > 0) {
      await prisma.asset.updateMany({
        where: {
          id: asset.id,
          workspaceId: asset.workspaceId,
          storageKey: asset.storageKey,
        },
        data: { storageKey: original },
      });
      continue;
    }
    try {
      await deleteBlob(original);
      deletedBlobs += 1;
      const deleted = await prisma.asset.deleteMany({
        where: {
          id: asset.id,
          workspaceId: asset.workspaceId,
          storageKey: asset.storageKey,
          contentLinks: { none: {} },
        },
      });
      deletedRows += deleted.count;
    } catch {
      failed += 1;
    }
  }
  return { deletedRows, deletedBlobs, failed };
}
