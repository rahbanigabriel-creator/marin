import type { Prisma } from "@prisma/client";

import {
  enforceScheduledPostCapacity,
  lockCalendarWorkspace,
} from "@/lib/billing/calendar";
import { WorkspaceAuthorizationError } from "@/lib/auth";
import { isOrganicDestination, isOrganicPlatform } from "@/lib/content/destinations";
import {
  ContentNotFoundError,
  ContentValidationError,
  ContentVersionConflictError,
} from "@/lib/content/errors";
import {
  resolveContentItemContext,
  toContentItemDto,
  toPublicationDto,
} from "@/lib/content/service";
import {
  canMutateExistingContent,
  canSetContentStatus,
  contentMutationLifecycle,
} from "@/lib/content/permissions";
import type {
  ContentPostDto,
  CreateContentPostInput,
  DeleteContentPostInput,
  DeleteContentPostResult,
  PatchContentPostInput,
} from "@/lib/content/types";
import { prisma } from "@/lib/db";

function requireOrganicPlatform(platform: string): void {
  if (!isOrganicPlatform(platform)) {
    throw new ContentValidationError(
      "invalid_platform",
      "Choose a supported organic platform",
    );
  }
}

function requireOrganicDestination(platform: string, format: string): void {
  if (!isOrganicDestination(platform, format)) {
    throw new ContentValidationError(
      "invalid_destination",
      "Choose a format supported by that organic platform",
    );
  }
}

function itemStatus(status: "draft" | "ready"): "draft" | "review" {
  return status === "ready" ? "review" : "draft";
}

function requireEditablePublication(status: string): void {
  if (status !== "draft" && status !== "ready") {
    throw new ContentValidationError(
      "publication_not_editable",
      "Publishing history cannot be edited or removed",
    );
  }
}

/** Create the reusable copy and its first channel placement as one durable unit. */
export async function createContentPost(
  input: CreateContentPostInput,
  transaction?: Prisma.TransactionClient,
): Promise<ContentPostDto> {
  requireOrganicDestination(input.platform, input.format);
  if (!canSetContentStatus(input.actorRole, input.status)) {
    throw new WorkspaceAuthorizationError();
  }
  const now = input.now ?? new Date();

  const create = async (tx: Prisma.TransactionClient): Promise<ContentPostDto> => {
    await lockCalendarWorkspace(tx, input.workspaceId);
    const context = await resolveContentItemContext(tx, {
      workspaceId: input.workspaceId,
      brandId: input.brandId,
      planId: input.planId,
    });
    await enforceScheduledPostCapacity(tx, {
      workspaceId: input.workspaceId,
      scheduledAt: input.scheduledAt,
      status: input.status,
      now,
    });

    const source = input.sourceContentItemId
      ? await tx.contentItem.findFirst({
          where: { id: input.sourceContentItemId, workspaceId: input.workspaceId },
          select: {
            assets: {
              select: { assetId: true, role: true, position: true, altText: true },
              orderBy: { position: "asc" },
            },
          },
        })
      : null;
    if (input.sourceContentItemId && !source) throw new ContentNotFoundError("content_item");

    const contentItem = await tx.contentItem.create({
      data: {
        workspaceId: input.workspaceId,
        brandId: context.brandId,
        planId: context.planId,
        status: itemStatus(input.status),
        source: "manual",
        title: input.title,
        coreCopy: input.coreCopy,
        createdBy: input.actorId,
      },
    });
    if (source?.assets.length) {
      await tx.contentItemAsset.createMany({
        data: source.assets.map((asset) => ({
          contentItemId: contentItem.id,
          assetId: asset.assetId,
          role: asset.role,
          position: asset.position,
          altText: asset.altText,
        })),
      });
    }
    const publication = await tx.publication.create({
      data: {
        workspaceId: input.workspaceId,
        contentItemId: contentItem.id,
        platform: input.platform,
        format: input.format,
        status: input.status,
        title: input.title,
        body: input.coreCopy,
        scheduledAt: input.scheduledAt,
      },
    });

    return {
      contentItem: toContentItemDto(contentItem),
      publication: toPublicationDto({ ...publication, scheduledAt: input.scheduledAt }),
    };
  };

  return transaction ? create(transaction) : prisma.$transaction(create);
}

/** Keep master copy, variant copy, lifecycle, and calendar movement atomic. */
export async function patchContentPost(
  input: PatchContentPostInput,
): Promise<ContentPostDto> {
  const now = input.now ?? new Date();

  return prisma.$transaction(async (tx) => {
    await lockCalendarWorkspace(tx, input.workspaceId);
    const publication = await tx.publication.findFirst({
      where: { id: input.publicationId, workspaceId: input.workspaceId },
      include: { contentItem: true },
    });
    if (!publication) throw new ContentNotFoundError("content_item");
    requireEditablePublication(publication.status);
    if (
      !canMutateExistingContent(
        input.actorRole,
        [publication.status, publication.contentItem.status],
        input.status,
      )
    ) {
      throw new WorkspaceAuthorizationError();
    }
    requireOrganicPlatform(publication.platform);
    if (publication.contentItem.version !== input.expectedVersion) {
      throw new ContentVersionConflictError(publication.contentItem.version);
    }

    const status = input.status ?? (publication.status as "draft" | "ready");
    const scheduledAt = input.scheduledAt ?? publication.scheduledAt;
    if (!scheduledAt) {
      throw new ContentValidationError(
        "scheduled_at_required",
        "A calendar date and time are required",
      );
    }
    await enforceScheduledPostCapacity(tx, {
      workspaceId: input.workspaceId,
      scheduledAt,
      status,
      now,
      excludePublicationId: publication.id,
    });

    const lifecycle = contentMutationLifecycle(
      publication.contentItem.status,
      input.status ? itemStatus(input.status) : undefined,
    );
    const update = await tx.contentItem.updateMany({
      where: {
        id: publication.contentItemId,
        workspaceId: input.workspaceId,
        version: input.expectedVersion,
      },
      data: {
        title: input.title,
        coreCopy: input.coreCopy,
        ...lifecycle,
        version: { increment: 1 },
      },
    });
    if (!update.count) {
      const current = await tx.contentItem.findFirst({
        where: { id: publication.contentItemId, workspaceId: input.workspaceId },
        select: { version: true },
      });
      if (!current) throw new ContentNotFoundError("content_item");
      throw new ContentVersionConflictError(current.version);
    }

    const [contentItem, updatedPublication] = await Promise.all([
      tx.contentItem.findFirstOrThrow({
        where: { id: publication.contentItemId, workspaceId: input.workspaceId },
      }),
      tx.publication.update({
        where: { id: publication.id },
        data: {
          title: input.title,
          body: input.coreCopy,
          status: input.status,
          scheduledAt: input.scheduledAt,
        },
      }),
    ]);

    return {
      contentItem: toContentItemDto(contentItem),
      publication: toPublicationDto({ ...updatedPublication, scheduledAt }),
    };
  });
}

/** Remove one calendar placement while preserving its shared master content. */
export async function deleteContentPost(
  input: DeleteContentPostInput,
): Promise<DeleteContentPostResult> {
  return prisma.$transaction(async (tx) => {
    await lockCalendarWorkspace(tx, input.workspaceId);
    const publication = await tx.publication.findFirst({
      where: { id: input.publicationId, workspaceId: input.workspaceId },
      include: { contentItem: { select: { version: true, status: true } } },
    });
    if (!publication) throw new ContentNotFoundError("content_item");
    requireEditablePublication(publication.status);
    if (
      !canMutateExistingContent(input.actorRole, [
        publication.status,
        publication.contentItem.status,
      ])
    ) {
      throw new WorkspaceAuthorizationError();
    }
    if (publication.contentItem.version !== input.expectedVersion) {
      throw new ContentVersionConflictError(publication.contentItem.version);
    }

    const lifecycle = contentMutationLifecycle(publication.contentItem.status);
    const versionUpdate = await tx.contentItem.updateMany({
      where: {
        id: publication.contentItemId,
        workspaceId: input.workspaceId,
        version: input.expectedVersion,
      },
      data: { version: { increment: 1 }, ...lifecycle },
    });
    if (!versionUpdate.count) {
      const current = await tx.contentItem.findFirst({
        where: { id: publication.contentItemId, workspaceId: input.workspaceId },
        select: { version: true },
      });
      if (!current) throw new ContentNotFoundError("content_item");
      throw new ContentVersionConflictError(current.version);
    }

    const [contentItem] = await Promise.all([
      tx.contentItem.findFirstOrThrow({
        where: { id: publication.contentItemId, workspaceId: input.workspaceId },
      }),
      tx.publication.delete({ where: { id: publication.id } }),
    ]);
    return {
      publicationId: publication.id,
      contentItemId: publication.contentItemId,
      contentItemVersion: input.expectedVersion + 1,
      contentItem: toContentItemDto(contentItem),
    };
  });
}
