import assert from "node:assert/strict";
import test from "node:test";

import { createCalendarPublication } from "../../billing/calendar";
import { isEntitlementDeniedError } from "../../billing/errors";
import { createContentPost } from "../../content/posts";
import {
  createContentPlan,
  toContentItemDto,
  toPublicationDto,
} from "../../content/service";
import { createConversation } from "../../conversations/service";
import { prisma } from "../../db";
import {
  ManualCreationConflictError,
  runManualCreation,
} from "../../idempotency/manual-creation";

function disposableDatabaseEnabled(): boolean {
  if (process.env.MARPIN_INTEGRATION_DATABASE !== "1") return false;
  try {
    const url = new URL(process.env.DATABASE_URL ?? "");
    return (
      (url.hostname === "127.0.0.1" || url.hostname === "localhost") &&
      /(?:_test|_ci)$/.test(url.pathname.slice(1))
    );
  } catch {
    return false;
  }
}

const integrationTest = disposableDatabaseEnabled() ? test : test.skip;

async function createWorkspace(prefix: string) {
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
  const workspace = await prisma.workspace.create({
    data: { name: prefix, slug: `${prefix.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${suffix}` },
  });
  const brand = await prisma.brand.create({
    data: { workspaceId: workspace.id, name: `${prefix} brand`, isPrimary: true },
  });
  return { workspace, brand };
}

async function seedFuturePosts(input: {
  workspaceId: string;
  brandId: string;
  count: number;
  scheduledAt: Date;
}): Promise<void> {
  await prisma.$transaction(async (tx) => {
    for (let index = 0; index < input.count; index += 1) {
      const item = await tx.contentItem.create({
        data: {
          workspaceId: input.workspaceId,
          brandId: input.brandId,
          title: `Existing post ${index + 1}`,
          status: "draft",
        },
      });
      await tx.publication.create({
        data: {
          workspaceId: input.workspaceId,
          contentItemId: item.id,
          platform: "instagram",
          format: "post",
          body: `Existing copy ${index + 1}`,
          status: "draft",
          scheduledAt: input.scheduledAt,
        },
      });
    }
  });
}

integrationTest("manual creations replay exactly and isolate keys by operation", async () => {
  const { workspace, brand } = await createWorkspace("Manual replay");
  const requestId = `manual_replay_${Date.now()}`;
  const planInput = {
    brandId: brand.id,
    name: "Launch week",
    objective: "Ship once",
    period: "week" as const,
    startDate: new Date("2026-08-24T00:00:00.000Z"),
    endDate: new Date("2026-08-31T00:00:00.000Z"),
    timezone: "UTC",
  };

  try {
    const createPlan = () => runManualCreation({
      workspaceId: workspace.id,
      operation: "content_plan_create",
      requestId,
      request: planInput,
      create: async (tx) => {
        const plan = await createContentPlan({
          workspaceId: workspace.id,
          createdBy: "owner-test",
          ...planInput,
        }, tx);
        return { body: { plan }, status: 201 };
      },
    });

    const [first, retry] = await Promise.all([createPlan(), createPlan()]);
    assert.deepEqual(first.body, retry.body);
    assert.equal(first.status, 201);
    assert.deepEqual([first.replayed, retry.replayed].sort(), [false, true]);
    assert.equal(await prisma.contentPlan.count({ where: { workspaceId: workspace.id } }), 1);

    await assert.rejects(
      () => runManualCreation({
        workspaceId: workspace.id,
        operation: "content_plan_create",
        requestId,
        request: { ...planInput, name: "A different plan" },
        create: async () => {
          throw new Error("A conflicting retry must never execute");
        },
      }),
      ManualCreationConflictError,
    );

    const conversation = await runManualCreation({
      workspaceId: workspace.id,
      operation: "conversation_create",
      requestId,
      request: { title: "Same key, separate operation" },
      create: async (tx) => {
        const created = await createConversation({
          workspaceId: workspace.id,
          createdBy: "owner-test",
          title: "Same key, separate operation",
        }, tx);
        return { body: { conversation: created }, status: 201 };
      },
    });
    assert.equal(conversation.status, 201);
    assert.equal(await prisma.conversation.count({ where: { workspaceId: workspace.id } }), 1);

    const contentItem = await prisma.contentItem.create({
      data: {
        workspaceId: workspace.id,
        brandId: brand.id,
        title: "Reusable idea",
        coreCopy: "One source of truth",
        status: "draft",
      },
    });
    const publicationRequestId = `publication_${Date.now()}`;
    const publicationInput = {
      contentItemId: contentItem.id,
      expectedVersion: contentItem.version,
      platform: "facebook" as const,
      format: "post",
      title: "Facebook version",
      body: "Prepared post",
      status: "draft" as const,
      scheduledAt: null,
    };
    const createPublication = () => runManualCreation({
      workspaceId: workspace.id,
      operation: "publication_create",
      requestId: publicationRequestId,
      request: publicationInput,
      create: async (tx) => {
        const created = await createCalendarPublication({
          workspaceId: workspace.id,
          actorRole: "owner",
          ...publicationInput,
        }, tx);
        return {
          body: {
            contentItem: toContentItemDto(created.contentItem),
            publication: toPublicationDto(created.publication),
          },
          status: 201,
        };
      },
    });
    const [publication, publicationRetry] = await Promise.all([
      createPublication(),
      createPublication(),
    ]);
    assert.deepEqual(publication.body, publicationRetry.body);
    assert.equal(
      await prisma.publication.count({
        where: { workspaceId: workspace.id, contentItemId: contentItem.id },
      }),
      1,
    );
    assert.equal(
      (await prisma.contentItem.findUniqueOrThrow({ where: { id: contentItem.id } })).version,
      2,
    );
  } finally {
    await prisma.workspace.delete({ where: { id: workspace.id } }).catch(() => undefined);
  }
});

integrationTest("content-post retries consume one slot and distinct requests cannot race past the limit", async () => {
  const duplicate = await createWorkspace("Manual duplicate limit");
  const contenders = await createWorkspace("Manual contender limit");
  const now = new Date();
  const scheduledAt = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1_000);

  try {
    await seedFuturePosts({
      workspaceId: duplicate.workspace.id,
      brandId: duplicate.brand.id,
      count: 9,
      scheduledAt,
    });
    const duplicateRequestId = `content_post_duplicate_${Date.now()}`;
    const duplicatePayload = {
      brandId: duplicate.brand.id,
      planId: null,
      title: "Final free slot",
      coreCopy: "Create this only once",
      platform: "instagram",
      format: "post",
      status: "draft" as const,
      scheduledAt,
    };
    const createDuplicate = () => runManualCreation({
      workspaceId: duplicate.workspace.id,
      operation: "content_post_create",
      requestId: duplicateRequestId,
      request: duplicatePayload,
      create: async (tx) => {
        const post = await createContentPost({
          workspaceId: duplicate.workspace.id,
          actorId: "owner-test",
          actorRole: "owner",
          now,
          ...duplicatePayload,
        }, tx);
        return { body: { post }, status: 201 };
      },
    });
    const [first, retry] = await Promise.all([createDuplicate(), createDuplicate()]);
    assert.deepEqual(first.body, retry.body);
    assert.equal(
      await prisma.publication.count({ where: { workspaceId: duplicate.workspace.id } }),
      10,
    );

    await seedFuturePosts({
      workspaceId: contenders.workspace.id,
      brandId: contenders.brand.id,
      count: 9,
      scheduledAt,
    });
    const createContender = (ordinal: number) => {
      const payload = {
        brandId: contenders.brand.id,
        planId: null,
        title: `Contender ${ordinal}`,
        coreCopy: `Only one contender may win ${ordinal}`,
        platform: "instagram",
        format: "post",
        status: "draft" as const,
        scheduledAt,
      };
      return runManualCreation({
        workspaceId: contenders.workspace.id,
        operation: "content_post_create",
        requestId: `content_post_contender_${ordinal}_${Date.now()}`,
        request: payload,
        create: async (tx) => {
          const post = await createContentPost({
            workspaceId: contenders.workspace.id,
            actorId: "owner-test",
            actorRole: "owner",
            now,
            ...payload,
          }, tx);
          return { body: { post }, status: 201 };
        },
      });
    };
    const outcomes = await Promise.allSettled([createContender(1), createContender(2)]);
    assert.equal(outcomes.filter((outcome) => outcome.status === "fulfilled").length, 1);
    const rejected = outcomes.find((outcome) => outcome.status === "rejected");
    assert.ok(rejected && rejected.status === "rejected");
    assert.equal(isEntitlementDeniedError(rejected.reason), true);
    assert.equal(
      await prisma.publication.count({ where: { workspaceId: contenders.workspace.id } }),
      10,
    );
    assert.equal(
      await prisma.manualCreationRequest.count({
        where: { workspaceId: contenders.workspace.id, operation: "content_post_create" },
      }),
      1,
    );
  } finally {
    await prisma.workspace.deleteMany({
      where: { id: { in: [duplicate.workspace.id, contenders.workspace.id] } },
    });
  }
});
