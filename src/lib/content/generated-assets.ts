import type { Prisma } from "@prisma/client";

import { WorkspaceAuthorizationError, type WorkspaceRole } from "@/lib/auth";
import {
  commitAssetStorageReservationWithDb,
  isUnavailableAssetStorageKey,
  type AssetStorageReservation,
} from "@/lib/billing/storage";
import { commitUsageReservationWithDb } from "@/lib/billing/usage";
import {
  ContentNotFoundError,
  ContentVersionConflictError,
} from "@/lib/content/errors";
import {
  canMutateExistingContent,
  contentMutationLifecycle,
} from "@/lib/content/permissions";
import { toContentItemAssetDto, toContentItemDto } from "@/lib/content/service";
import type { ContentItemAssetDto, ContentItemDto } from "@/lib/content/types";
import { prisma } from "@/lib/db";

export async function findCommittedGeneratedContentAsset(input: {
  workspaceId: string;
  contentItemId: string;
  usageKey: string;
  requestHash: string;
}): Promise<{ contentItem: ContentItemDto; link: ContentItemAssetDto } | null> {
  const usage = await prisma.usageEvent.findUnique({
    where: {
      workspaceId_idempotencyKey: {
        workspaceId: input.workspaceId,
        idempotencyKey: input.usageKey,
      },
    },
    select: { status: true, requestHash: true },
  });
  if (usage?.status !== "committed" || usage.requestHash !== input.requestHash) return null;

  const [contentItem, link] = await prisma.$transaction([
    prisma.contentItem.findFirst({
      where: { id: input.contentItemId, workspaceId: input.workspaceId },
    }),
    prisma.contentItemAsset.findFirst({
      where: {
        contentItemId: input.contentItemId,
        asset: {
          workspaceId: input.workspaceId,
          source: "generated",
          metadata: { path: ["requestHash"], equals: input.requestHash },
        },
      },
      include: { asset: true },
      orderBy: { createdAt: "asc" },
    }),
  ]);
  if (!contentItem || !link || isUnavailableAssetStorageKey(link.asset.storageKey)) return null;
  return {
    contentItem: toContentItemDto(contentItem),
    link: toContentItemAssetDto(link),
  };
}

export async function commitGeneratedContentAsset(input: {
  workspaceId: string;
  contentItemId: string;
  actorRole: WorkspaceRole;
  expectedVersion: number;
  reservation: AssetStorageReservation;
  storageKey: string;
  usageKey: string;
  altText?: string | null;
}): Promise<{ contentItem: ContentItemDto; link: ContentItemAssetDto }> {
  return prisma.$transaction(async (tx) => {
    const locked = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT "id" FROM "workspaces" WHERE "id" = ${input.workspaceId} FOR UPDATE
    `;
    if (!locked.length) throw new ContentNotFoundError("content_item");

    const item = await tx.contentItem.findFirst({
      where: { id: input.contentItemId, workspaceId: input.workspaceId },
    });
    if (!item) throw new ContentNotFoundError("content_item");
    if (!canMutateExistingContent(input.actorRole, [item.status])) {
      throw new WorkspaceAuthorizationError();
    }
    if (item.version !== input.expectedVersion) {
      throw new ContentVersionConflictError(item.version);
    }
    const lifecycle = contentMutationLifecycle(item.status);
    const claimed = await tx.contentItem.updateMany({
      where: {
        id: item.id,
        workspaceId: input.workspaceId,
        version: input.expectedVersion,
      },
      data: { version: { increment: 1 }, ...lifecycle },
    });
    if (!claimed.count) {
      const current = await tx.contentItem.findFirst({
        where: { id: item.id, workspaceId: input.workspaceId },
        select: { version: true },
      });
      if (!current) throw new ContentNotFoundError("content_item");
      throw new ContentVersionConflictError(current.version);
    }

    const assetCommitted = await commitAssetStorageReservationWithDb(
      tx,
      input.reservation,
      input.storageKey,
    );
    if (!assetCommitted) throw new ContentNotFoundError("asset");
    const usageCommitted = await commitUsageReservationWithDb(
      tx,
      input.workspaceId,
      input.usageKey,
    );
    if (!usageCommitted) throw new Error("Generated asset usage settlement failed");

    const position = Math.min(
      await tx.contentItemAsset.count({ where: { contentItemId: item.id } }),
      50,
    );
    const link = await tx.contentItemAsset.create({
      data: {
        contentItemId: item.id,
        assetId: input.reservation.id,
        position,
        role: position === 0 ? "cover" : "media",
        altText: input.altText ?? null,
      },
      include: { asset: true },
    });
    const contentItem = await tx.contentItem.findFirstOrThrow({
      where: { id: item.id, workspaceId: input.workspaceId },
    });
    return {
      contentItem: toContentItemDto(contentItem),
      link: toContentItemAssetDto(link),
    };
  }, { isolationLevel: "ReadCommitted" as Prisma.TransactionIsolationLevel });
}
