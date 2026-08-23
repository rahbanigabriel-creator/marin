import type { ContentItem, Prisma } from "@prisma/client";

import { WorkspaceAuthorizationError } from "@/lib/auth";
import {
  enforceScheduledPostCapacity,
  lockCalendarWorkspace,
} from "@/lib/billing/calendar";
import { isOrganicDestination } from "@/lib/content/destinations";
import {
  ContentNotFoundError,
  ContentValidationError,
  ContentVersionConflictError,
} from "@/lib/content/errors";
import {
  canMutateExistingContent,
  contentMutationLifecycle,
} from "@/lib/content/permissions";
import { acceptContentProposal } from "@/lib/content/proposals";
import { toContentItemDto, toPublicationDto } from "@/lib/content/service";
import type {
  ContentPostDto,
  CreateContentVariantInput,
  DeleteContentPostResult,
  DeleteContentVariantInput,
  PatchContentVariantInput,
} from "@/lib/content/types";
import { prisma } from "@/lib/db";

function editableStatus(status: string): asserts status is "draft" | "ready" {
  if (status !== "draft" && status !== "ready") {
    throw new ContentValidationError(
      "publication_not_editable",
      "Only draft and review-ready variants can be edited",
    );
  }
}

async function claimContentItemVersion(
  tx: Prisma.TransactionClient,
  item: ContentItem,
  expectedVersion: number,
  nextStatus?: string,
): Promise<ContentItem> {
  if (item.version !== expectedVersion) {
    throw new ContentVersionConflictError(item.version);
  }
  const lifecycle = contentMutationLifecycle(item.status, nextStatus);
  const claimed = await tx.contentItem.updateMany({
    where: {
      id: item.id,
      workspaceId: item.workspaceId,
      version: expectedVersion,
    },
    data: { version: { increment: 1 }, ...lifecycle },
  });
  if (!claimed.count) {
    const current = await tx.contentItem.findFirst({
      where: { id: item.id, workspaceId: item.workspaceId },
      select: { version: true },
    });
    if (!current) throw new ContentNotFoundError("content_item");
    throw new ContentVersionConflictError(current.version);
  }
  return tx.contentItem.findFirstOrThrow({
    where: { id: item.id, workspaceId: item.workspaceId },
  });
}

export async function createContentVariant(
  input: CreateContentVariantInput,
  transaction?: Prisma.TransactionClient,
): Promise<ContentPostDto> {
  if (!isOrganicDestination(input.platform, input.format)) {
    throw new ContentValidationError(
      "invalid_destination",
      "Choose a format supported by that organic platform",
    );
  }
  const create = async (tx: Prisma.TransactionClient): Promise<ContentPostDto> => {
    await lockCalendarWorkspace(tx, input.workspaceId);
    const item = await tx.contentItem.findFirst({
      where: { id: input.contentItemId, workspaceId: input.workspaceId },
    });
    if (!item) throw new ContentNotFoundError("content_item");
    if (!canMutateExistingContent(input.actorRole, [item.status], input.status)) {
      throw new WorkspaceAuthorizationError();
    }
    await enforceScheduledPostCapacity(tx, {
      workspaceId: input.workspaceId,
      scheduledAt: input.scheduledAt ?? null,
      status: input.status,
      now: input.now ?? new Date(),
    });
    const contentItem = await claimContentItemVersion(
      tx,
      item,
      input.expectedVersion,
      input.status === "ready" && (item.status === "idea" || item.status === "draft")
        ? "review"
        : undefined,
    );
    const publication = await tx.publication.create({
      data: {
        workspaceId: input.workspaceId,
        contentItemId: item.id,
        platform: input.platform,
        format: input.format,
        title: input.title ?? null,
        body: input.body,
        firstComment: input.firstComment ?? null,
        linkUrl: input.linkUrl ?? null,
        status: input.status,
        scheduledAt: input.scheduledAt ?? null,
      },
    });
    if (input.proposalId) {
      await acceptContentProposal(tx, {
        workspaceId: input.workspaceId,
        proposalId: input.proposalId,
        contentItemId: item.id,
        publicationId: publication.id,
        kind: "variant",
        actorId: input.actorId ?? null,
        platform: publication.platform,
        format: publication.format,
      });
    }
    return {
      contentItem: toContentItemDto(contentItem),
      publication: toPublicationDto(publication),
    };
  };

  return transaction ? create(transaction) : prisma.$transaction(create);
}

export async function patchContentVariant(
  input: PatchContentVariantInput,
): Promise<ContentPostDto> {
  return prisma.$transaction(async (tx) => {
    await lockCalendarWorkspace(tx, input.workspaceId);
    const existing = await tx.publication.findFirst({
      where: { id: input.publicationId, workspaceId: input.workspaceId },
      include: { contentItem: true },
    });
    if (!existing) throw new ContentNotFoundError("content_item");
    editableStatus(existing.status);
    if (
      !canMutateExistingContent(
        input.actorRole,
        [existing.status, existing.contentItem.status],
        input.status,
      )
    ) {
      throw new WorkspaceAuthorizationError();
    }
    const platform = input.platform ?? existing.platform;
    const format = input.format ?? existing.format;
    if (!isOrganicDestination(platform, format)) {
      throw new ContentValidationError(
        "invalid_destination",
        "Choose a format supported by that organic platform",
      );
    }
    const status = input.status ?? existing.status;
    const scheduledAt = input.scheduledAt === undefined
      ? existing.scheduledAt
      : input.scheduledAt;
    await enforceScheduledPostCapacity(tx, {
      workspaceId: input.workspaceId,
      scheduledAt,
      status,
      now: input.now ?? new Date(),
      excludePublicationId: existing.id,
    });
    const contentItem = await claimContentItemVersion(
      tx,
      existing.contentItem,
      input.expectedVersion,
      status === "ready" &&
        (existing.contentItem.status === "idea" || existing.contentItem.status === "draft")
        ? "review"
        : undefined,
    );
    const publication = await tx.publication.update({
      where: { id: existing.id },
      data: {
        platform: input.platform,
        format: input.format,
        title: input.title,
        body: input.body,
        firstComment: input.firstComment,
        linkUrl: input.linkUrl,
        status: input.status,
        scheduledAt: input.scheduledAt,
      },
    });
    if (input.proposalId) {
      await acceptContentProposal(tx, {
        workspaceId: input.workspaceId,
        proposalId: input.proposalId,
        contentItemId: existing.contentItemId,
        publicationId: publication.id,
        kind: "variant",
        actorId: input.actorId ?? null,
        platform: publication.platform,
        format: publication.format,
      });
    }
    return {
      contentItem: toContentItemDto(contentItem),
      publication: toPublicationDto(publication),
    };
  });
}

export async function deleteContentVariant(
  input: DeleteContentVariantInput,
): Promise<DeleteContentPostResult> {
  return prisma.$transaction(async (tx) => {
    await lockCalendarWorkspace(tx, input.workspaceId);
    const existing = await tx.publication.findFirst({
      where: { id: input.publicationId, workspaceId: input.workspaceId },
      include: { contentItem: true },
    });
    if (!existing) throw new ContentNotFoundError("content_item");
    editableStatus(existing.status);
    if (
      !canMutateExistingContent(input.actorRole, [
        existing.status,
        existing.contentItem.status,
      ])
    ) {
      throw new WorkspaceAuthorizationError();
    }
    const contentItem = await claimContentItemVersion(
      tx,
      existing.contentItem,
      input.expectedVersion,
    );
    await tx.publication.delete({ where: { id: existing.id } });
    return {
      publicationId: existing.id,
      contentItemId: existing.contentItemId,
      contentItemVersion: contentItem.version,
      contentItem: toContentItemDto(contentItem),
    };
  });
}
