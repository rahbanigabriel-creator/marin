import type {
  Asset,
  ContentItem,
  ContentItemAsset,
  ContentPlan,
  Prisma,
  Publication,
} from "@prisma/client";

import { WorkspaceAuthorizationError } from "@/lib/auth";
import { isUnavailableAssetStorageKey } from "@/lib/billing/storage";
import {
  ContentNotFoundError,
  ContentValidationError,
  ContentVersionConflictError,
} from "@/lib/content/errors";
import {
  canMutateContentPlan,
  canMutateExistingContent,
  canSetContentStatus,
  contentMutationLifecycle,
} from "@/lib/content/permissions";
import { acceptContentProposal } from "@/lib/content/proposals";
import type {
  ContentCalendarDto,
  ContentAssetDto,
  ContentItemAssetDto,
  ContentItemDto,
  ContentPlanDto,
  ContentPlanPeriod,
  ContentPublicationDto,
  ContentStudioItemDto,
  CreateContentItemInput,
  CreateContentPlanInput,
  DeleteContentPlanInput,
  DeleteContentPlanResult,
  PatchContentItemInput,
  PatchContentPlanInput,
} from "@/lib/content/types";
import { prisma } from "@/lib/db";

function planPeriod(plan: ContentPlan): ContentPlanPeriod {
  const strategy = plan.strategy;
  if (
    strategy &&
    typeof strategy === "object" &&
    !Array.isArray(strategy) &&
    "period" in strategy &&
    (strategy.period === "week" || strategy.period === "month")
  ) {
    return strategy.period;
  }
  return plan.endDate.getTime() - plan.startDate.getTime() <= 8 * 24 * 60 * 60 * 1_000
    ? "week"
    : "month";
}

export function toContentPlanDto(plan: ContentPlan): ContentPlanDto {
  return {
    id: plan.id,
    brandId: plan.brandId,
    name: plan.name,
    objective: plan.objective,
    status: plan.status as ContentPlanDto["status"],
    version: plan.version,
    period: planPeriod(plan),
    startDate: plan.startDate.toISOString(),
    endDate: plan.endDate.toISOString(),
    timezone: plan.timezone,
    strategy: plan.strategy,
    createdAt: plan.createdAt.toISOString(),
    updatedAt: plan.updatedAt.toISOString(),
  };
}

export function toContentItemDto(item: ContentItem): ContentItemDto {
  return {
    id: item.id,
    brandId: item.brandId,
    planId: item.planId,
    status: item.status as ContentItemDto["status"],
    source: item.source,
    title: item.title,
    brief: item.brief,
    coreCopy: item.coreCopy,
    objective: item.objective,
    metadata: item.metadata,
    version: item.version,
    approvedBy: item.approvedBy,
    approvedAt: item.approvedAt?.toISOString() ?? null,
    createdAt: item.createdAt.toISOString(),
    updatedAt: item.updatedAt.toISOString(),
  };
}

export function toPublicationDto(publication: Publication): ContentPublicationDto {
  return {
    id: publication.id,
    contentItemId: publication.contentItemId,
    channelAccountId: publication.channelAccountId,
    platform: publication.platform,
    format: publication.format,
    status: publication.status,
    title: publication.title,
    body: publication.body,
    firstComment: publication.firstComment,
    linkUrl: publication.linkUrl,
    scheduledAt: publication.scheduledAt?.toISOString() ?? null,
    publishedAt: publication.publishedAt?.toISOString() ?? null,
    permalink: publication.permalink,
    publishAttempts: publication.publishAttempts,
    lastError: publication.lastError,
    createdAt: publication.createdAt.toISOString(),
    updatedAt: publication.updatedAt.toISOString(),
  };
}

export function toContentAssetDto(asset: Asset): ContentAssetDto {
  return {
    id: asset.id,
    kind: asset.kind === "video" ? "video" : "image",
    mimeType: asset.mimeType,
    bytes: asset.bytes,
    filename: asset.filename,
    width: asset.width,
    height: asset.height,
    durationMs: asset.durationMs,
    source: asset.source,
    contentUrl: `/api/assets/${encodeURIComponent(asset.id)}/content`,
    createdAt: asset.createdAt.toISOString(),
  };
}

export function toContentItemAssetDto(
  link: ContentItemAsset & { asset: Asset },
): ContentItemAssetDto {
  return {
    id: link.id,
    position: link.position,
    role:
      link.role === "thumbnail" || link.role === "cover"
        ? link.role
        : "media",
    altText: link.altText,
    asset: toContentAssetDto(link.asset),
  };
}

type StudioItemRecord = Prisma.ContentItemGetPayload<{
  include: { publications: true; assets: { include: { asset: true } } };
}>;

function toContentStudioItemDto(item: StudioItemRecord): ContentStudioItemDto {
  return {
    contentItem: toContentItemDto(item),
    publications: item.publications.map(toPublicationDto),
    assets: item.assets
      .filter((link) => !isUnavailableAssetStorageKey(link.asset.storageKey))
      .sort((left, right) => left.position - right.position)
      .map(toContentItemAssetDto),
  };
}

export async function getContentCalendar(input: {
  workspaceId: string;
  start: Date;
  end: Date;
}): Promise<ContentCalendarDto> {
  const [workspace, plans, publications] = await prisma.$transaction([
    prisma.workspace.findUnique({
      where: { id: input.workspaceId },
      select: { timezone: true },
    }),
    prisma.contentPlan.findMany({
      where: {
        workspaceId: input.workspaceId,
        startDate: { lt: input.end },
        endDate: { gt: input.start },
      },
      orderBy: [{ startDate: "asc" }, { createdAt: "asc" }],
    }),
    prisma.publication.findMany({
      where: {
        workspaceId: input.workspaceId,
        scheduledAt: { gte: input.start, lt: input.end },
      },
      orderBy: [{ scheduledAt: "asc" }, { createdAt: "asc" }],
    }),
  ]);
  if (!workspace) throw new ContentNotFoundError("plan");

  const planIds = plans.map((plan) => plan.id);
  const publicationItemIds = publications.map((publication) => publication.contentItemId);
  const contentItems =
    planIds.length || publicationItemIds.length
      ? await prisma.contentItem.findMany({
          where: {
            workspaceId: input.workspaceId,
            OR: [
              ...(planIds.length ? [{ planId: { in: planIds } }] : []),
              ...(publicationItemIds.length ? [{ id: { in: publicationItemIds } }] : []),
            ],
          },
          orderBy: [{ updatedAt: "desc" }, { id: "asc" }],
        })
      : [];

  return {
    start: input.start.toISOString(),
    end: input.end.toISOString(),
    timezone: workspace.timezone,
    plans: plans.map(toContentPlanDto),
    contentItems: contentItems.map(toContentItemDto),
    publications: publications
      .filter((publication): publication is Publication & { scheduledAt: Date } => Boolean(publication.scheduledAt))
      .map(toPublicationDto),
  };
}

type ContentPlanCreateDatabase = Pick<Prisma.TransactionClient, "brand" | "contentPlan">;

export async function createContentPlan(
  input: CreateContentPlanInput,
  db: ContentPlanCreateDatabase = prisma,
): Promise<ContentPlanDto> {
  const brand = await db.brand.findFirst({
    where: { id: input.brandId, workspaceId: input.workspaceId },
    select: { id: true },
  });
  if (!brand) throw new ContentNotFoundError("brand");
  const plan = await db.contentPlan.create({
    data: {
      workspaceId: input.workspaceId,
      brandId: brand.id,
      name: input.name,
      objective: input.objective ?? null,
      status: "draft",
      startDate: input.startDate,
      endDate: input.endDate,
      timezone: input.timezone,
      strategy: { period: input.period },
      createdBy: input.createdBy,
    },
  });
  return toContentPlanDto(plan);
}

export async function listContentPlans(workspaceId: string): Promise<ContentPlanDto[]> {
  const plans = await prisma.contentPlan.findMany({
    where: { workspaceId },
    orderBy: [{ startDate: "desc" }, { createdAt: "desc" }],
    take: 200,
  });
  return plans.map(toContentPlanDto);
}

export async function patchContentPlan(input: PatchContentPlanInput): Promise<ContentPlanDto> {
  return prisma.$transaction(async (tx) => {
    const existing = await tx.contentPlan.findFirst({
      where: { id: input.planId, workspaceId: input.workspaceId },
    });
    if (!existing) throw new ContentNotFoundError("plan");
    if (!canMutateContentPlan(input.actorRole, existing.status, input.status)) {
      throw new WorkspaceAuthorizationError();
    }
    if (existing.version !== input.expectedVersion) {
      throw new ContentVersionConflictError(existing.version);
    }

    const result = await tx.contentPlan.updateMany({
      where: {
        id: input.planId,
        workspaceId: input.workspaceId,
        version: input.expectedVersion,
      },
      data: {
        name: input.name,
        objective: input.objective,
        status: input.status,
        version: { increment: 1 },
      },
    });
    if (!result.count) {
      const current = await tx.contentPlan.findFirst({
        where: { id: input.planId, workspaceId: input.workspaceId },
        select: { version: true },
      });
      if (!current) throw new ContentNotFoundError("plan");
      throw new ContentVersionConflictError(current.version);
    }
    const plan = await tx.contentPlan.findFirstOrThrow({
      where: { id: input.planId, workspaceId: input.workspaceId },
    });
    return toContentPlanDto(plan);
  });
}

export async function deleteContentPlan(
  input: DeleteContentPlanInput,
): Promise<DeleteContentPlanResult> {
  if (input.actorRole === "member") throw new WorkspaceAuthorizationError();

  return prisma.$transaction(async (tx) => {
    // A strong parent lock serializes every in-flight or new foreign-key
    // attachment. Once held, the child snapshot below is authoritative: an
    // earlier attachment commits before the scan, while a later one fails
    // after the plan is deleted instead of bypassing lifecycle bookkeeping.
    const [lockedPlan] = await tx.$queryRaw<Array<{ id: string; version: number }>>`
      SELECT "id", "version"
      FROM "content_plans"
      WHERE "id" = ${input.planId}
        AND "workspace_id" = ${input.workspaceId}
      FOR UPDATE
    `;
    if (!lockedPlan) throw new ContentNotFoundError("plan");
    if (lockedPlan.version !== input.expectedVersion) {
      throw new ContentVersionConflictError(lockedPlan.version);
    }
    await tx.contentPlan.update({
      where: { id: lockedPlan.id },
      data: { version: { increment: 1 } },
    });

    // Lock every child before detaching it so a concurrent editor either lands
    // before this semantic mutation or receives an optimistic conflict after it.
    const attachedItems = await tx.$queryRaw<Array<{ id: string; status: string }>>`
      SELECT "id", "status"
      FROM "content_items"
      WHERE "workspace_id" = ${input.workspaceId}
        AND "plan_id" = ${input.planId}
      FOR UPDATE
    `;
    const approvedIds = attachedItems
      .filter((item) => item.status === "approved")
      .map((item) => item.id);
    const otherIds = attachedItems
      .filter((item) => item.status !== "approved")
      .map((item) => item.id);
    if (approvedIds.length) {
      await tx.contentItem.updateMany({
        where: { id: { in: approvedIds }, workspaceId: input.workspaceId },
        data: {
          planId: null,
          status: "review",
          approvedBy: null,
          approvedAt: null,
          version: { increment: 1 },
        },
      });
    }
    if (otherIds.length) {
      await tx.contentItem.updateMany({
        where: { id: { in: otherIds }, workspaceId: input.workspaceId },
        data: { planId: null, version: { increment: 1 } },
      });
    }
    const detachedContentItems = attachedItems.length
      ? await tx.contentItem.findMany({
          where: {
            id: { in: attachedItems.map((item) => item.id) },
            workspaceId: input.workspaceId,
          },
          orderBy: { createdAt: "asc" },
        })
      : [];
    const deleted = await tx.contentPlan.deleteMany({
      where: {
        id: input.planId,
        workspaceId: input.workspaceId,
        version: input.expectedVersion + 1,
      },
    });
    if (!deleted.count) {
      const current = await tx.contentPlan.findFirst({
        where: { id: input.planId, workspaceId: input.workspaceId },
        select: { version: true },
      });
      if (!current) throw new ContentNotFoundError("plan");
      throw new ContentVersionConflictError(current.version);
    }
    return {
      planId: input.planId,
      deleted: true,
      contentItems: detachedContentItems.map(toContentItemDto),
    };
  });
}

type Transaction = Prisma.TransactionClient;

export async function resolveContentItemContext(
  tx: Transaction,
  input: {
    workspaceId: string;
    brandId?: string | null;
    planId?: string | null;
    fallbackBrandId?: string | null;
    fallbackPlanId?: string | null;
  },
): Promise<{ brandId: string | null; planId: string | null }> {
  const planId = input.planId === undefined ? (input.fallbackPlanId ?? null) : input.planId;
  const requestedBrandId = input.brandId === undefined ? (input.fallbackBrandId ?? null) : input.brandId;
  let planBrandId: string | null = null;
  if (planId) {
    const plan = await tx.contentPlan.findFirst({
      where: { id: planId, workspaceId: input.workspaceId },
      select: { brandId: true },
    });
    if (!plan) throw new ContentNotFoundError("plan");
    planBrandId = plan.brandId;
  }
  const brandId = input.brandId === undefined && planId ? planBrandId : requestedBrandId;
  if (brandId) {
    const brand = await tx.brand.findFirst({
      where: { id: brandId, workspaceId: input.workspaceId },
      select: { id: true },
    });
    if (!brand) throw new ContentNotFoundError("content_item");
  }
  if (planId && planBrandId && brandId !== planBrandId) {
    throw new ContentValidationError(
      "brand_plan_mismatch",
      "The content item brand must match its plan brand",
    );
  }
  if (!brandId && !planId) {
    throw new ContentValidationError("brand_context_required", "brandId or planId is required");
  }
  return { brandId, planId };
}

export async function createContentItem(
  input: CreateContentItemInput,
  transaction?: Prisma.TransactionClient,
): Promise<ContentItemDto> {
  if (input.status === "approved") {
    throw new ContentValidationError(
      "approval_must_be_separate",
      "Create content first, then approve the saved version",
    );
  }
  if (!canSetContentStatus(input.actorRole, input.status)) {
    throw new WorkspaceAuthorizationError();
  }
  const create = async (tx: Prisma.TransactionClient): Promise<ContentItemDto> => {
    const context = await resolveContentItemContext(tx, input);
    const item = await tx.contentItem.create({
      data: {
        workspaceId: input.workspaceId,
        brandId: context.brandId,
        planId: context.planId,
        status: input.status,
        source: "manual",
        title: input.title,
        brief: input.brief ?? null,
        coreCopy: input.coreCopy ?? null,
        objective: input.objective ?? null,
        metadata: input.metadata,
        createdBy: input.createdBy,
      },
    });
    return toContentItemDto(item);
  };

  return transaction ? create(transaction) : prisma.$transaction(create);
}

export async function getContentItem(
  workspaceId: string,
  contentItemId: string,
): Promise<ContentItemDto> {
  const item = await prisma.contentItem.findFirst({
    where: { id: contentItemId, workspaceId },
  });
  if (!item) throw new ContentNotFoundError("content_item");
  return toContentItemDto(item);
}

export const CONTENT_STUDIO_DEFAULT_PAGE_SIZE = 50;
export const CONTENT_STUDIO_MAX_PAGE_SIZE = 100;

interface ContentStudioCursor {
  updatedAt: Date;
  id: string;
}

export interface ContentStudioItemsPage {
  items: ContentStudioItemDto[];
  nextCursor: string | null;
}

function invalidContentStudioCursor(): ContentValidationError {
  return new ContentValidationError(
    "invalid_cursor",
    "The content cursor is invalid or expired",
  );
}

export function encodeContentStudioCursor(updatedAt: Date, id: string): string {
  return Buffer.from(JSON.stringify([1, updatedAt.toISOString(), id]), "utf8").toString(
    "base64url",
  );
}

export function decodeContentStudioCursor(cursor: string): ContentStudioCursor {
  if (
    cursor.length < 1 ||
    cursor.length > 512 ||
    !/^[A-Za-z0-9_-]+$/.test(cursor)
  ) {
    throw invalidContentStudioCursor();
  }
  try {
    const value: unknown = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
    if (
      !Array.isArray(value) ||
      value.length !== 3 ||
      value[0] !== 1 ||
      typeof value[1] !== "string" ||
      typeof value[2] !== "string" ||
      value[2].length < 1 ||
      value[2].length > 191 ||
      !/^[A-Za-z0-9_-]+$/.test(value[2])
    ) {
      throw invalidContentStudioCursor();
    }
    const updatedAt = new Date(value[1]);
    if (
      !Number.isFinite(updatedAt.getTime()) ||
      updatedAt.toISOString() !== value[1]
    ) {
      throw invalidContentStudioCursor();
    }
    return { updatedAt, id: value[2] };
  } catch (error) {
    if (error instanceof ContentValidationError) throw error;
    throw invalidContentStudioCursor();
  }
}

export function contentStudioPageSize(take?: number): number {
  if (take === undefined) return CONTENT_STUDIO_DEFAULT_PAGE_SIZE;
  if (!Number.isInteger(take) || take < 1 || take > CONTENT_STUDIO_MAX_PAGE_SIZE) {
    throw new ContentValidationError(
      "invalid_page_size",
      `Content page size must be between 1 and ${CONTENT_STUDIO_MAX_PAGE_SIZE}`,
    );
  }
  return take;
}

export async function listContentStudioItems(input: {
  workspaceId: string;
  brandId?: string;
  planId?: string;
  cursor?: string;
  take?: number;
}): Promise<ContentStudioItemsPage> {
  const take = contentStudioPageSize(input.take);
  const cursor = input.cursor ? decodeContentStudioCursor(input.cursor) : null;
  const where: Prisma.ContentItemWhereInput = {
    workspaceId: input.workspaceId,
    ...(input.brandId ? { brandId: input.brandId } : {}),
    ...(input.planId ? { planId: input.planId } : {}),
    ...(cursor
      ? {
          AND: [
            {
              OR: [
                { updatedAt: { lt: cursor.updatedAt } },
                { updatedAt: cursor.updatedAt, id: { gt: cursor.id } },
              ],
            },
          ],
        }
      : {}),
  };
  const rows = await prisma.contentItem.findMany({
    where,
    include: {
      publications: { orderBy: [{ updatedAt: "desc" }, { id: "asc" }] },
      assets: { include: { asset: true } },
    },
    orderBy: [{ updatedAt: "desc" }, { id: "asc" }],
    take: take + 1,
  });
  const hasMore = rows.length > take;
  const page = rows.slice(0, take);
  const last = page.at(-1);
  return {
    items: page.map(toContentStudioItemDto),
    nextCursor: hasMore && last
      ? encodeContentStudioCursor(last.updatedAt, last.id)
      : null,
  };
}

export async function getContentStudioItem(
  workspaceId: string,
  contentItemId: string,
): Promise<ContentStudioItemDto> {
  const item = await prisma.contentItem.findFirst({
    where: { id: contentItemId, workspaceId },
    include: {
      publications: { orderBy: [{ updatedAt: "desc" }, { id: "asc" }] },
      assets: { include: { asset: true } },
    },
  });
  if (!item) throw new ContentNotFoundError("content_item");
  return toContentStudioItemDto(item);
}

export async function patchContentItem(input: PatchContentItemInput): Promise<ContentItemDto> {
  const semanticEdit = [
    input.brandId,
    input.planId,
    input.title,
    input.brief,
    input.coreCopy,
    input.objective,
    input.metadata,
    input.proposalId,
  ].some((value) => value !== undefined);
  if (input.status === "approved") {
    if (input.approvalIntent !== true) {
      throw new ContentValidationError(
        "approval_intent_required",
        "Approve content with the explicit approval action",
      );
    }
    if (semanticEdit) {
      throw new ContentValidationError(
        "approval_must_be_separate",
        "Save content changes before approving them",
      );
    }
  } else if (input.approvalIntent === true) {
    throw new ContentValidationError(
      "invalid_approval_intent",
      "Approval intent requires approved status",
    );
  }
  return prisma.$transaction(async (tx) => {
    const existing = await tx.contentItem.findFirst({
      where: { id: input.contentItemId, workspaceId: input.workspaceId },
    });
    if (!existing) throw new ContentNotFoundError("content_item");
    if (!canMutateExistingContent(input.actorRole, [existing.status], input.status)) {
      throw new WorkspaceAuthorizationError();
    }
    if (existing.version !== input.expectedVersion) {
      throw new ContentVersionConflictError(existing.version);
    }
    const context = await resolveContentItemContext(tx, {
      workspaceId: input.workspaceId,
      brandId: input.brandId,
      planId: input.planId,
      fallbackBrandId: existing.brandId,
      fallbackPlanId: existing.planId,
    });
    const approved = input.status === "approved" && input.approvalIntent === true;
    const lifecycle = contentMutationLifecycle(existing.status, input.status);
    const result = await tx.contentItem.updateMany({
      where: {
        id: input.contentItemId,
        workspaceId: input.workspaceId,
        version: input.expectedVersion,
      },
      data: {
        brandId: context.brandId,
        planId: context.planId,
        status: lifecycle.status,
        title: input.title,
        brief: input.brief,
        coreCopy: input.coreCopy,
        objective: input.objective,
        metadata: input.metadata,
        approvedBy: approved ? input.actorId : lifecycle.approvedBy,
        approvedAt: approved ? new Date() : lifecycle.approvedAt,
        version: { increment: 1 },
      },
    });
    if (!result.count) {
      const current = await tx.contentItem.findFirst({
        where: { id: input.contentItemId, workspaceId: input.workspaceId },
        select: { version: true },
      });
      if (!current) throw new ContentNotFoundError("content_item");
      throw new ContentVersionConflictError(current.version);
    }
    if (input.proposalId) {
      await acceptContentProposal(tx, {
        workspaceId: input.workspaceId,
        proposalId: input.proposalId,
        contentItemId: input.contentItemId,
        kind: "master",
        actorId: input.actorId,
      });
    }
    const updated = await tx.contentItem.findFirstOrThrow({
      where: { id: input.contentItemId, workspaceId: input.workspaceId },
    });
    return toContentItemDto(updated);
  });
}
