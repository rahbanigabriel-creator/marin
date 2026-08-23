import type { Prisma } from "@prisma/client";

import { WorkspaceAuthorizationError, type WorkspaceRole } from "@/lib/auth";
import { isUnavailableAssetStorageKey } from "@/lib/billing/storage";
import {
  ContentNotFoundError,
  ContentValidationError,
  ContentVersionConflictError,
} from "@/lib/content/errors";
import {
  canMutateExistingContent,
  contentMutationLifecycle,
} from "@/lib/content/permissions";
import {
  toContentItemAssetDto,
  toContentItemDto,
} from "@/lib/content/service";
import type { ContentItemAssetDto, ContentItemDto } from "@/lib/content/types";
import { prisma } from "@/lib/db";

export type ContentAssetRole = "media" | "thumbnail" | "cover";

export interface AttachContentAssetInput {
  workspaceId: string;
  contentItemId: string;
  assetId: string;
  actorRole: WorkspaceRole;
  expectedVersion: number;
  role: ContentAssetRole;
  position: number;
  altText?: string | null;
}

export interface DetachContentAssetInput {
  workspaceId: string;
  contentItemId: string;
  linkId: string;
  actorRole: WorkspaceRole;
  expectedVersion: number;
}

async function claimVersion(
  tx: Prisma.TransactionClient,
  input: {
    workspaceId: string;
    contentItemId: string;
    expectedVersion: number;
    actorRole: WorkspaceRole;
  },
) {
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
  return tx.contentItem.findFirstOrThrow({
    where: { id: item.id, workspaceId: input.workspaceId },
  });
}

export async function attachContentAsset(
  input: AttachContentAssetInput,
): Promise<{ contentItem: ContentItemDto; link: ContentItemAssetDto }> {
  if (!Number.isSafeInteger(input.position) || input.position < 0 || input.position > 50) {
    throw new ContentValidationError("invalid_position", "Asset position must be between 0 and 50");
  }
  return prisma.$transaction(async (tx) => {
    const lockedAsset = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT "id"
      FROM "assets"
      WHERE "id" = ${input.assetId}
        AND "workspace_id" = ${input.workspaceId}
      FOR UPDATE
    `;
    if (!lockedAsset.length) throw new ContentNotFoundError("asset");
    const asset = await tx.asset.findFirst({
      where: { id: input.assetId, workspaceId: input.workspaceId },
    });
    if (!asset || isUnavailableAssetStorageKey(asset.storageKey)) {
      throw new ContentNotFoundError("asset");
    }
    const contentItem = await claimVersion(tx, input);
    const link = await tx.contentItemAsset.upsert({
      where: {
        contentItemId_assetId: {
          contentItemId: input.contentItemId,
          assetId: input.assetId,
        },
      },
      create: {
        contentItemId: input.contentItemId,
        assetId: input.assetId,
        role: input.role,
        position: input.position,
        altText: input.altText ?? null,
      },
      update: {
        role: input.role,
        position: input.position,
        altText: input.altText ?? null,
      },
      include: { asset: true },
    });
    return {
      contentItem: toContentItemDto(contentItem),
      link: toContentItemAssetDto(link),
    };
  });
}

export async function detachContentAsset(
  input: DetachContentAssetInput,
): Promise<{
  contentItemId: string;
  linkId: string;
  contentItemVersion: number;
  contentItem: ContentItemDto;
}> {
  return prisma.$transaction(async (tx) => {
    const link = await tx.contentItemAsset.findFirst({
      where: {
        id: input.linkId,
        contentItemId: input.contentItemId,
        contentItem: { workspaceId: input.workspaceId },
      },
    });
    if (!link) throw new ContentNotFoundError("content_item");
    const contentItem = await claimVersion(tx, input);
    await tx.contentItemAsset.delete({ where: { id: link.id } });
    return {
      contentItemId: input.contentItemId,
      linkId: link.id,
      contentItemVersion: contentItem.version,
      contentItem: toContentItemDto(contentItem),
    };
  });
}
