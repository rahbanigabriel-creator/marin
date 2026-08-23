import type { ContentItem, Prisma, Publication } from "@prisma/client";

import { WorkspaceAuthorizationError, type WorkspaceRole } from "@/lib/auth";
import { EntitlementDeniedError } from "@/lib/billing/errors";
import { resolveWorkspaceBillingPolicy } from "@/lib/billing/entitlements";
import {
  isOrganicDestination,
  isOrganicPlatform,
  type OrganicPlatformId as DestinationPlatformId,
} from "@/lib/content/destinations";
import {
  ContentNotFoundError,
  ContentValidationError,
  ContentVersionConflictError,
} from "@/lib/content/errors";
import {
  canMutateExistingContent,
  canSetContentStatus,
  contentMutationLifecycle,
} from "@/lib/content/permissions";
import { prisma } from "@/lib/db";

export const ACTIVE_CALENDAR_STATUSES = [
  "draft",
  "ready",
  "scheduled",
  "publishing",
] as const;

export type CalendarPublicationStatus = "draft" | "ready";
export type OrganicPlatformId = DestinationPlatformId;

function contentItemStatus(status: CalendarPublicationStatus): "draft" | "review" {
  return status === "ready" ? "review" : "draft";
}

function requestedContentItemStatus(
  existingStatus: string,
  publicationStatus: CalendarPublicationStatus,
): "draft" | "review" | undefined {
  // Any mutation of approved content returns it to review. Lowering it straight
  // to draft would erase the explicit review boundary instead of invalidating it.
  return existingStatus === "approved" ? undefined : contentItemStatus(publicationStatus);
}

export interface CreateCalendarPublicationInput {
  workspaceId: string;
  contentItemId: string;
  actorRole: WorkspaceRole;
  expectedVersion: number;
  platform: OrganicPlatformId;
  format: string;
  title?: string | null;
  body: string;
  status?: CalendarPublicationStatus;
  scheduledAt?: Date | null;
  now?: Date;
}

export interface CreateCalendarPublicationResult {
  contentItem: ContentItem;
  publication: Publication;
}

export interface MoveCalendarPublicationInput {
  workspaceId: string;
  publicationId: string;
  actorRole: WorkspaceRole;
  expectedVersion: number;
  scheduledAt: Date | null;
  status?: CalendarPublicationStatus;
  now?: Date;
}

export interface MoveCalendarPublicationResult {
  contentItem: ContentItem;
  publication: Publication;
}

export function consumesScheduledPostSlot(
  scheduledAt: Date | null,
  status: string,
  now = new Date(),
): boolean {
  return Boolean(
    scheduledAt &&
      Number.isFinite(scheduledAt.getTime()) &&
      scheduledAt >= now &&
      (ACTIVE_CALENDAR_STATUSES as readonly string[]).includes(status),
  );
}

function requireOrganicPlatform(platform: string): asserts platform is OrganicPlatformId {
  if (!isOrganicPlatform(platform)) {
    throw new ContentValidationError(
      "invalid_platform",
      "Choose a supported organic platform",
    );
  }
}

function requireValidDate(value: Date | null): void {
  if (value && !Number.isFinite(value.getTime())) throw new Error("A valid calendar date is required");
}

export async function lockCalendarWorkspace(
  tx: Prisma.TransactionClient,
  workspaceId: string,
): Promise<void> {
  const locked = await tx.$queryRaw<Array<{ id: string }>>`
    SELECT "id" FROM "workspaces" WHERE "id" = ${workspaceId} FOR UPDATE
  `;
  if (!locked.length) throw new Error("Workspace not found");
}

export async function enforceScheduledPostCapacity(
  tx: Prisma.TransactionClient,
  input: {
    workspaceId: string;
    scheduledAt: Date | null;
    status: string;
    now: Date;
    excludePublicationId?: string;
  },
): Promise<void> {
  if (!consumesScheduledPostSlot(input.scheduledAt, input.status, input.now)) return;

  const policy = await resolveWorkspaceBillingPolicy(input.workspaceId, tx, input.now);
  const current = await tx.publication.count({
    where: {
      workspaceId: input.workspaceId,
      ...(input.excludePublicationId ? { id: { not: input.excludePublicationId } } : {}),
      scheduledAt: { gte: input.now },
      status: { in: [...ACTIVE_CALENDAR_STATUSES] },
    },
  });
  if (current >= policy.entitlements.maxScheduledPosts) {
    throw new EntitlementDeniedError(
      "scheduled_post_limit",
      "scheduledPosts",
      `${policy.planId === "free" ? "Free" : "Solo Founder"} includes ${policy.entitlements.maxScheduledPosts} future calendar posts.`,
    );
  }
}

/**
 * Advisory batch admission before expensive generation. The final writes still
 * call enforceScheduledPostCapacity under the workspace lock, so a concurrent
 * calendar mutation cannot use this preflight to exceed the durable limit.
 */
export async function preflightScheduledPostCapacity(input: {
  workspaceId: string;
  additionalPosts: number;
  now: Date;
}): Promise<void> {
  if (!Number.isSafeInteger(input.additionalPosts) || input.additionalPosts < 1) {
    throw new ContentValidationError(
      "invalid_post_count",
      "A positive number of planned posts is required",
    );
  }
  const policy = await resolveWorkspaceBillingPolicy(input.workspaceId, prisma, input.now);
  const current = await prisma.publication.count({
    where: {
      workspaceId: input.workspaceId,
      scheduledAt: { gte: input.now },
      status: { in: [...ACTIVE_CALENDAR_STATUSES] },
    },
  });
  if (current + input.additionalPosts > policy.entitlements.maxScheduledPosts) {
    throw new EntitlementDeniedError(
      "scheduled_post_limit",
      "scheduledPosts",
      `${policy.planId === "free" ? "Free" : "Solo Founder"} includes ${policy.entitlements.maxScheduledPosts} future calendar posts.`,
    );
  }
}

/**
 * Create one calendar entry under the workspace lock. Drafts with a future
 * planned time consume the same finite allowance as provider-scheduled posts.
 */
export async function createCalendarPublication(
  input: CreateCalendarPublicationInput,
  transaction?: Prisma.TransactionClient,
): Promise<CreateCalendarPublicationResult> {
  const now = input.now ?? new Date();
  const status = input.status ?? "draft";
  const scheduledAt = input.scheduledAt ?? null;
  requireOrganicPlatform(input.platform);
  const format = input.format.trim() || "post";
  if (!isOrganicDestination(input.platform, format)) {
    throw new ContentValidationError(
      "invalid_destination",
      "Choose a format supported by that organic platform",
    );
  }
  requireValidDate(scheduledAt);
  if (!canSetContentStatus(input.actorRole, status)) {
    throw new WorkspaceAuthorizationError();
  }

  const create = async (tx: Prisma.TransactionClient): Promise<CreateCalendarPublicationResult> => {
    await lockCalendarWorkspace(tx, input.workspaceId);

    const contentItem = await tx.contentItem.findFirst({
      where: { id: input.contentItemId, workspaceId: input.workspaceId },
    });
    if (!contentItem) throw new ContentNotFoundError("content_item");
    if (contentItem.version !== input.expectedVersion) {
      throw new ContentVersionConflictError(contentItem.version);
    }
    if (!canMutateExistingContent(input.actorRole, [contentItem.status], status)) {
      throw new WorkspaceAuthorizationError();
    }

    await enforceScheduledPostCapacity(tx, {
      workspaceId: input.workspaceId,
      scheduledAt,
      status,
      now,
    });

    const claimed = await tx.contentItem.updateMany({
      where: {
        id: contentItem.id,
        workspaceId: input.workspaceId,
        version: input.expectedVersion,
      },
      data: {
        version: { increment: 1 },
        ...contentMutationLifecycle(
          contentItem.status,
          requestedContentItemStatus(contentItem.status, status),
        ),
      },
    });
    if (!claimed.count) {
      const current = await tx.contentItem.findFirst({
        where: { id: contentItem.id, workspaceId: input.workspaceId },
        select: { version: true },
      });
      if (!current) throw new ContentNotFoundError("content_item");
      throw new ContentVersionConflictError(current.version);
    }

    const [updatedContentItem, publication] = await Promise.all([
      tx.contentItem.findFirstOrThrow({
        where: { id: contentItem.id, workspaceId: input.workspaceId },
      }),
      tx.publication.create({
        data: {
          workspaceId: input.workspaceId,
          contentItemId: contentItem.id,
          platform: input.platform,
          format,
          title: input.title?.trim() || null,
          body: input.body,
          status,
          scheduledAt,
        },
      }),
    ]);
    return { contentItem: updatedContentItem, publication };
  };

  return transaction ? create(transaction) : prisma.$transaction(create);
}

/** Move or unschedule an existing entry without allowing concurrent cap bypass. */
export async function moveCalendarPublication(
  input: MoveCalendarPublicationInput,
): Promise<MoveCalendarPublicationResult> {
  const now = input.now ?? new Date();
  requireValidDate(input.scheduledAt);

  return prisma.$transaction(async (tx) => {
    await lockCalendarWorkspace(tx, input.workspaceId);

    const publication = await tx.publication.findFirst({
      where: { id: input.publicationId, workspaceId: input.workspaceId },
      include: { contentItem: { select: { version: true, status: true } } },
    });
    if (!publication) throw new ContentNotFoundError("content_item");
    if (publication.status !== "draft" && publication.status !== "ready") {
      throw new ContentValidationError(
        "publication_not_editable",
        "Publishing history cannot be edited or removed",
      );
    }
    if (
      !canMutateExistingContent(
        input.actorRole,
        [publication.status, publication.contentItem.status],
        input.status,
      )
    ) {
      throw new WorkspaceAuthorizationError();
    }
    if (publication.contentItem.version !== input.expectedVersion) {
      throw new ContentVersionConflictError(publication.contentItem.version);
    }
    const status = input.status ?? (publication.status as CalendarPublicationStatus);

    await enforceScheduledPostCapacity(tx, {
      workspaceId: input.workspaceId,
      scheduledAt: input.scheduledAt,
      status,
      now,
      excludePublicationId: publication.id,
    });

    const versionUpdate = await tx.contentItem.updateMany({
      where: {
        id: publication.contentItemId,
        workspaceId: input.workspaceId,
        version: input.expectedVersion,
      },
      data: {
        version: { increment: 1 },
        ...contentMutationLifecycle(
          publication.contentItem.status,
          input.status
            ? requestedContentItemStatus(publication.contentItem.status, input.status)
            : undefined,
        ),
      },
    });
    if (!versionUpdate.count) {
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
        data: { scheduledAt: input.scheduledAt, status },
      }),
    ]);
    return { contentItem, publication: updatedPublication };
  });
}
