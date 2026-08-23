import assert from "node:assert/strict";
import test from "node:test";

import { WorkspaceAuthorizationError } from "../../auth";
import { createCalendarPublication, moveCalendarPublication } from "../../billing/calendar";
import { EntitlementDeniedError } from "../../billing/errors";
import {
  DELETING_ASSET_STORAGE_PREFIX,
  PENDING_ASSET_STORAGE_PREFIX,
} from "../../billing/storage";
import { attachContentAsset, detachContentAsset } from "../../content/assets";
import {
  getAssistedHandoff,
  recordAssistedHandoff,
} from "../../content/assisted-handoff";
import {
  ContentIdempotencyConflictError,
  ContentNotFoundError,
  ContentStateConflictError,
  ContentValidationError,
  ContentVersionConflictError,
} from "../../content/errors";
import {
  buildFallbackWeeklyIdeas,
  generateWeeklyContentPlan,
} from "../../content/generation";
import {
  commitGeneratedContentAsset,
  findCommittedGeneratedContentAsset,
} from "../../content/generated-assets";
import { createContentPost, deleteContentPost, patchContentPost } from "../../content/posts";
import {
  createContentItem,
  createContentPlan,
  deleteContentPlan,
  getContentCalendar,
  getContentItem,
  listContentStudioItems,
  listContentPlans,
  patchContentItem,
  patchContentPlan,
} from "../../content/service";
import {
  createContentVariant,
  deleteContentVariant,
  patchContentVariant,
} from "../../content/variants";
import { prisma } from "../../db";
import {
  AssetInUseError,
  markAssetForDeletion,
} from "../../storage/asset-deletion";

function disposableTestDatabaseEnabled(): boolean {
  if (process.env.MARPIN_INTEGRATION_DATABASE !== "1") return false;
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) return false;
  if (
    process.env.TEST_DATABASE_URL &&
    process.env.TEST_DATABASE_URL !== databaseUrl
  ) return false;
  try {
    const url = new URL(databaseUrl);
    return (
      (url.hostname === "127.0.0.1" || url.hostname === "localhost") &&
      /(?:_test|_ci)$/.test(url.pathname.slice(1))
    );
  } catch {
    return false;
  }
}

const integrationTest = disposableTestDatabaseEnabled() ? test : test.skip;

integrationTest("assisted organic handoff is tenant-safe, snapshot-bound, and append-only", async () => {
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const workspace = await prisma.workspace.create({
    data: { name: "Handoff tenant", slug: `handoff-${suffix}`, timezone: "Europe/Madrid" },
  });
  const otherWorkspace = await prisma.workspace.create({
    data: { name: "Other handoff tenant", slug: `other-handoff-${suffix}` },
  });

  try {
    const brand = await prisma.brand.create({
      data: { workspaceId: workspace.id, name: "Marpin", isPrimary: true },
    });
    const item = await prisma.contentItem.create({
      data: {
        workspaceId: workspace.id,
        brandId: brand.id,
        status: "approved",
        title: "Founder launch",
        coreCopy: "Master copy remains distinct.",
        version: 3,
        approvedBy: "owner-1",
        approvedAt: new Date("2026-07-21T08:00:00.000Z"),
      },
    });
    const publication = await prisma.publication.create({
      data: {
        workspaceId: workspace.id,
        contentItemId: item.id,
        platform: "instagram",
        format: "reel",
        status: "ready",
        title: "Launch reel",
        body: "The exact Instagram caption.",
        firstComment: "First comment",
        linkUrl: "https://www.marpin.ai/launch",
        externalId: "preserve-existing-id",
      },
    });
    const [secondAsset, firstAsset] = await Promise.all([
      prisma.asset.create({
        data: {
          workspaceId: workspace.id,
          kind: "video",
          mimeType: "video/mp4",
          bytes: 20,
          storageKey: `tests/${suffix}/second.mp4`,
          filename: "second.mp4",
        },
      }),
      prisma.asset.create({
        data: {
          workspaceId: workspace.id,
          kind: "image",
          mimeType: "image/png",
          bytes: 10,
          storageKey: `tests/${suffix}/first.png`,
          filename: "../first \"draft\".png",
        },
      }),
    ]);
    await prisma.contentItemAsset.createMany({
      data: [
        { contentItemId: item.id, assetId: secondAsset.id, position: 2, role: "media" },
        { contentItemId: item.id, assetId: firstAsset.id, position: 0, role: "cover", altText: "Launch cover" },
      ],
    });

    const memberView = await getAssistedHandoff({
      workspaceId: workspace.id,
      publicationId: publication.id,
      actorRole: "member",
    });
    assert.equal(memberView.publication.contentItemId, item.id);
    assert.equal(memberView.capability.level, "assisted");
    assert.equal(memberView.capability.canPrepare, false);
    assert.equal(memberView.capability.canRecord, false);
    assert.equal(memberView.capability.reasonCode, "role_required");
    assert.match(memberView.capability.reason ?? "", /Owner or admin/);
    assert.deepEqual(memberView.copy, { title: null, body: "", firstComment: null, linkUrl: null });
    assert.deepEqual(memberView.assets, []);
    assert.equal(memberView.capability.openPlatformUrl, null);
    await assert.rejects(
      () => getAssistedHandoff({
        workspaceId: otherWorkspace.id,
        publicationId: publication.id,
        actorRole: "member",
      }),
      ContentNotFoundError,
    );
    await assert.rejects(
      () => recordAssistedHandoff({
        workspaceId: workspace.id,
        publicationId: publication.id,
        actorId: "member-1",
        actorRole: "member",
        requestId: `member-${suffix}`,
        expectedContentVersion: item.version,
        outcome: "failed",
      }),
      WorkspaceAuthorizationError,
    );
    await assert.rejects(
      () => recordAssistedHandoff({
        workspaceId: workspace.id,
        publicationId: publication.id,
        actorId: "owner-1",
        actorRole: "owner",
        requestId: `missing-link-${suffix}`,
        expectedContentVersion: item.version,
        outcome: "completed",
      }),
      (error: unknown) =>
        error instanceof ContentValidationError && error.code === "invalid_permalink",
    );
    await assert.rejects(
      () => recordAssistedHandoff({
        workspaceId: workspace.id,
        publicationId: publication.id,
        actorId: "owner-1",
        actorRole: "owner",
        requestId: `stale-${suffix}`,
        expectedContentVersion: item.version - 1,
        outcome: "failed",
      }),
      (error: unknown) =>
        error instanceof ContentVersionConflictError && error.currentVersion === item.version,
    );

    const unapprovedItem = await prisma.contentItem.create({
      data: {
        workspaceId: workspace.id,
        brandId: brand.id,
        status: "approved",
        title: "Missing attestation",
      },
    });
    const unapprovedPublication = await prisma.publication.create({
      data: {
        workspaceId: workspace.id,
        contentItemId: unapprovedItem.id,
        platform: "reddit",
        format: "post",
        status: "ready",
        body: "Not actually approved.",
      },
    });
    const unapprovedView = await getAssistedHandoff({
      workspaceId: workspace.id,
      publicationId: unapprovedPublication.id,
      actorRole: "owner",
    });
    assert.equal(unapprovedView.capability.canPrepare, false);
    assert.equal(unapprovedView.capability.canRecord, false);
    assert.equal(unapprovedView.publication.contentItemId, unapprovedItem.id);
    assert.equal(unapprovedView.capability.reasonCode, "content_version_not_approved");
    assert.equal(unapprovedView.capability.openPlatformUrl, null);
    assert.equal(unapprovedView.copy.body, "");
    assert.deepEqual(unapprovedView.assets, []);
    await assert.rejects(
      () => recordAssistedHandoff({
        workspaceId: workspace.id,
        publicationId: unapprovedPublication.id,
        actorId: "admin-1",
        actorRole: "admin",
        requestId: `unapproved-${suffix}`,
        expectedContentVersion: unapprovedItem.version,
        outcome: "failed",
      }),
      (error: unknown) =>
        error instanceof ContentStateConflictError && error.code === "content_not_approved",
    );

    const unsupportedPublication = await prisma.publication.create({
      data: {
        workspaceId: workspace.id,
        contentItemId: item.id,
        platform: "reddit",
        format: "story",
        status: "ready",
        body: "Malformed legacy destination.",
      },
    });
    await assert.rejects(
      () => recordAssistedHandoff({
        workspaceId: workspace.id,
        publicationId: unsupportedPublication.id,
        actorId: "owner-1",
        actorRole: "owner",
        requestId: `unsupported-${suffix}`,
        expectedContentVersion: item.version,
        outcome: "failed",
      }),
      (error: unknown) =>
        error instanceof ContentStateConflictError && error.code === "unsupported_destination",
    );

    const failedAt = new Date("2026-07-21T09:00:00.000Z");
    assert.equal(await prisma.subscription.count({ where: { workspaceId: workspace.id } }), 0);
    const failedInput = {
      workspaceId: workspace.id,
      publicationId: publication.id,
      actorId: "admin-1",
      actorRole: "admin" as const,
      requestId: `failed-${suffix}`,
      expectedContentVersion: item.version,
      outcome: "failed" as const,
      failureReason: "Upload was rejected in Instagram",
      now: failedAt,
    };
    const failed = await recordAssistedHandoff(failedInput);
    assert.equal(failed.reused, false);
    assert.equal(failed.handoff.capability.canPrepare, true);
    assert.equal(failed.handoff.copy.body, "The exact Instagram caption.");
    assert.deepEqual(failed.handoff.assets.map((asset) => asset.id), [firstAsset.id, secondAsset.id]);
    assert.equal(failed.handoff.assets[0]?.filename, "first draft.png");
    assert.match(failed.handoff.assets[0]?.downloadUrl ?? "", /disposition=attachment$/);
    assert.equal(failed.handoff.publication.status, "failed");
    assert.equal(failed.handoff.publication.publishAttempts, 1);
    assert.equal(failed.handoff.publication.lastError, failedInput.failureReason);
    assert.equal(failed.handoff.attempts[0]?.outcome, "failed");
    assert.equal(failed.handoff.attempts[0]?.contentVersion, item.version);

    const replay = await recordAssistedHandoff(failedInput);
    assert.equal(replay.reused, true);
    assert.equal(await prisma.publicationAttempt.count({
      where: { workspaceId: workspace.id, idempotencyKey: failedInput.requestId },
    }), 1);
    await assert.rejects(
      () => recordAssistedHandoff({
        ...failedInput,
        failureReason: "A different failure",
      }),
      ContentIdempotencyConflictError,
    );

    const completedAt = new Date("2026-07-21T09:05:00.000Z");
    const completedInput = {
      workspaceId: workspace.id,
      publicationId: publication.id,
      actorId: "owner-1",
      actorRole: "owner" as const,
      requestId: `completed-${suffix}`,
      expectedContentVersion: item.version,
      outcome: "completed" as const,
      permalink: "https://instagram.com/reel/Launch_123/",
      now: completedAt,
    };
    const completed = await recordAssistedHandoff(completedInput);
    assert.equal(completed.reused, false);
    assert.equal(completed.handoff.publication.status, "published");
    assert.equal(completed.handoff.publication.publishedAt, completedAt.toISOString());
    assert.equal(completed.handoff.publication.permalink, "https://www.instagram.com/reel/Launch_123");
    assert.equal(completed.handoff.publication.publishAttempts, 2);
    assert.equal(completed.handoff.publication.lastError, null);
    assert.deepEqual(completed.handoff.attempts.map((attempt) => attempt.outcome), ["completed", "failed"]);
    const storedCompleted = await prisma.publication.findUniqueOrThrow({
      where: { id: publication.id },
    });
    assert.equal(storedCompleted.externalId, "preserve-existing-id");
    await assert.rejects(
      () => recordAssistedHandoff({
        ...completedInput,
        requestId: `terminal-${suffix}`,
      }),
      (error: unknown) =>
        error instanceof ContentStateConflictError && error.code === "publication_not_ready",
    );
    assert.equal((await recordAssistedHandoff(completedInput)).reused, true);

    const concurrentItem = await prisma.contentItem.create({
      data: {
        workspaceId: workspace.id,
        brandId: brand.id,
        status: "approved",
        title: "Concurrent Pinterest handoff",
        version: 2,
        approvedBy: "owner-1",
        approvedAt: completedAt,
      },
    });
    const concurrentPublication = await prisma.publication.create({
      data: {
        workspaceId: workspace.id,
        contentItemId: concurrentItem.id,
        platform: "pinterest",
        format: "pin",
        status: "ready",
        body: "One immutable attempt.",
      },
    });
    const concurrentInput = {
      workspaceId: workspace.id,
      publicationId: concurrentPublication.id,
      actorId: "owner-1",
      actorRole: "owner" as const,
      requestId: `concurrent-${suffix}`,
      expectedContentVersion: concurrentItem.version,
      outcome: "completed" as const,
      permalink: "https://pinterest.com/pin/123456789",
    };
    const concurrent = await Promise.all([
      recordAssistedHandoff(concurrentInput),
      recordAssistedHandoff(concurrentInput),
    ]);
    assert.equal(concurrent.filter((result) => !result.reused).length, 1);
    assert.equal(concurrent.filter((result) => result.reused).length, 1);
    assert.equal(await prisma.publicationAttempt.count({
      where: { publicationId: concurrentPublication.id },
    }), 1);

    const raceItem = await prisma.contentItem.create({
      data: {
        workspaceId: workspace.id,
        brandId: brand.id,
        status: "approved",
        title: "Snapshot race",
        version: 5,
        approvedBy: "owner-1",
        approvedAt: completedAt,
      },
    });
    const racePublication = await prisma.publication.create({
      data: {
        workspaceId: workspace.id,
        contentItemId: raceItem.id,
        platform: "youtube",
        format: "video",
        status: "ready",
        body: "Do not record stale approval.",
      },
    });
    let releaseEditor!: () => void;
    let editorLocked!: () => void;
    const editorReady = new Promise<void>((resolve) => { editorLocked = resolve; });
    const editorRelease = new Promise<void>((resolve) => { releaseEditor = resolve; });
    const editor = prisma.$transaction(async (tx) => {
      await tx.$queryRaw`
        SELECT "id" FROM "content_items" WHERE "id" = ${raceItem.id} FOR UPDATE
      `;
      editorLocked();
      await editorRelease;
      await tx.contentItem.update({
        where: { id: raceItem.id },
        data: {
          status: "review",
          approvedBy: null,
          approvedAt: null,
          version: { increment: 1 },
        },
      });
    });
    await editorReady;
    const racedHandoff = recordAssistedHandoff({
      workspaceId: workspace.id,
      publicationId: racePublication.id,
      actorId: "owner-1",
      actorRole: "owner",
      requestId: `snapshot-${suffix}`,
      expectedContentVersion: raceItem.version,
      outcome: "failed",
    });
    const earlyResult = await Promise.race([
      racedHandoff.then(() => "settled", () => "settled"),
      new Promise<"waiting">((resolve) => setTimeout(() => resolve("waiting"), 100)),
    ]);
    assert.equal(earlyResult, "waiting");
    releaseEditor();
    await editor;
    await assert.rejects(
      () => racedHandoff,
      (error: unknown) =>
        error instanceof ContentStateConflictError && error.code === "content_not_approved",
    );
    assert.equal(await prisma.publicationAttempt.count({
      where: { publicationId: racePublication.id },
    }), 0);
  } finally {
    await prisma.workspace.deleteMany({
      where: { id: { in: [workspace.id, otherWorkspace.id] } },
    });
  }
});

integrationTest("content calendar is tenant-safe, half-open, and item updates use atomic versions", async () => {
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const workspace = await prisma.workspace.create({
    data: { name: "Content tenant", slug: `content-${suffix}`, timezone: "Europe/Madrid" },
  });
  const otherWorkspace = await prisma.workspace.create({
    data: { name: "Other tenant", slug: `other-content-${suffix}`, timezone: "America/New_York" },
  });

  try {
    const [brand, otherBrand] = await Promise.all([
      prisma.brand.create({
        data: { workspaceId: workspace.id, name: "Marpin", isPrimary: true, timezone: "Europe/Madrid" },
      }),
      prisma.brand.create({
        data: { workspaceId: otherWorkspace.id, name: "Other", isPrimary: true },
      }),
    ]);

    const plan = await createContentPlan({
      workspaceId: workspace.id,
      createdBy: "user-1",
      brandId: brand.id,
      name: "Launch week",
      objective: "Build awareness",
      period: "week",
      startDate: new Date("2026-07-19T22:00:00.000Z"),
      endDate: new Date("2026-07-26T22:00:00.000Z"),
      timezone: "Europe/Madrid",
    });
    const otherPlan = await createContentPlan({
      workspaceId: otherWorkspace.id,
      createdBy: "other-user",
      brandId: otherBrand.id,
      name: "Other launch",
      period: "week",
      startDate: new Date("2026-07-20T04:00:00.000Z"),
      endDate: new Date("2026-07-27T04:00:00.000Z"),
      timezone: "America/New_York",
    });

    const item = await createContentItem({
      workspaceId: workspace.id,
      createdBy: "user-1",
      actorRole: "owner",
      planId: plan.id,
      status: "draft",
      title: "A manual founder post",
      coreCopy: "Distribution is part of the product.",
    });
    assert.equal(item.source, "manual");
    assert.equal(item.version, 1);
    assert.equal(item.brandId, brand.id);
    assert.equal(await prisma.publication.count({ where: { contentItemId: item.id } }), 0);

    await prisma.publication.createMany({
      data: [
        {
          workspaceId: workspace.id,
          contentItemId: item.id,
          platform: "linkedin",
          format: "post",
          status: "draft",
          body: "Inside",
          scheduledAt: new Date("2026-07-21T08:00:00.000Z"),
        },
        {
          workspaceId: workspace.id,
          contentItemId: item.id,
          platform: "linkedin",
          format: "post",
          status: "draft",
          body: "Exactly at the exclusive end",
          scheduledAt: new Date("2026-07-27T00:00:00.000Z"),
        },
      ],
    });

    const calendar = await getContentCalendar({
      workspaceId: workspace.id,
      start: new Date("2026-07-20T00:00:00.000Z"),
      end: new Date("2026-07-27T00:00:00.000Z"),
    });
    assert.equal(calendar.timezone, "Europe/Madrid");
    assert.deepEqual(calendar.plans.map((entry) => entry.id), [plan.id]);
    assert.equal(calendar.plans[0]?.version, 1);
    assert.deepEqual(calendar.contentItems.map((entry) => entry.id), [item.id]);
    assert.equal(calendar.publications.length, 1);
    assert.equal(calendar.publications[0]?.body, "Inside");
    assert.match(calendar.publications[0]?.scheduledAt ?? "", /Z$/);
    assert.equal((await listContentPlans(workspace.id)).length, 1);

    await assert.rejects(
      () => getContentItem(otherWorkspace.id, item.id),
      (error: unknown) => error instanceof ContentNotFoundError,
    );
    await assert.rejects(
      () =>
        patchContentPlan({
          workspaceId: workspace.id,
          planId: otherPlan.id,
          actorRole: "owner",
          expectedVersion: 1,
          status: "active",
        }),
      (error: unknown) => error instanceof ContentNotFoundError,
    );

    const attempts = await Promise.allSettled([
      patchContentItem({
        workspaceId: workspace.id,
        contentItemId: item.id,
        actorId: "user-1",
        actorRole: "owner",
        expectedVersion: 1,
        title: "Winning revision A",
      }),
      patchContentItem({
        workspaceId: workspace.id,
        contentItemId: item.id,
        actorId: "user-1",
        actorRole: "owner",
        expectedVersion: 1,
        title: "Winning revision B",
      }),
    ]);
    assert.equal(attempts.filter((attempt) => attempt.status === "fulfilled").length, 1);
    const rejected = attempts.find((attempt) => attempt.status === "rejected");
    assert.ok(rejected && rejected.status === "rejected");
    assert.ok(rejected.reason instanceof ContentVersionConflictError);
    assert.equal(rejected.reason.currentVersion, 2);

    const updated = await getContentItem(workspace.id, item.id);
    assert.equal(updated.version, 2);

    await assert.rejects(
      () => createContentItem({
        workspaceId: workspace.id,
        createdBy: "user-1",
        actorRole: "owner",
        brandId: brand.id,
        status: "approved",
        title: "Bundled approval must fail",
      }),
      (error: unknown) =>
        error instanceof ContentValidationError && error.code === "approval_must_be_separate",
    );
    const approvalDraft = await createContentItem({
      workspaceId: workspace.id,
      createdBy: "user-1",
      actorRole: "owner",
      brandId: brand.id,
      status: "review",
      title: "Approved founder proof",
    });
    const approvedItem = await patchContentItem({
      workspaceId: workspace.id,
      contentItemId: approvalDraft.id,
      actorId: "user-1",
      actorRole: "owner",
      expectedVersion: approvalDraft.version,
      status: "approved",
      approvalIntent: true,
    });
    await assert.rejects(
      () =>
        patchContentItem({
          workspaceId: workspace.id,
          contentItemId: approvedItem.id,
          actorId: "member-1",
          actorRole: "member",
          expectedVersion: approvedItem.version,
          title: "Member rewrite that must not retain approval",
        }),
      (error: unknown) => error instanceof WorkspaceAuthorizationError,
    );
    assert.equal((await getContentItem(workspace.id, approvedItem.id)).title, "Approved founder proof");
    const revisedApprovedItem = await patchContentItem({
      workspaceId: workspace.id,
      contentItemId: approvedItem.id,
      actorId: "user-1",
      actorRole: "owner",
      expectedVersion: approvedItem.version,
      title: "Approved founder proof, revised",
    });
    assert.equal(revisedApprovedItem.status, "review");
    assert.equal(revisedApprovedItem.approvedBy, null);
    assert.equal(revisedApprovedItem.approvedAt, null);
    await assert.rejects(
      () => patchContentItem({
        workspaceId: workspace.id,
        contentItemId: approvedItem.id,
        actorId: "user-1",
        actorRole: "owner",
        expectedVersion: revisedApprovedItem.version,
        status: "approved",
      }),
      (error: unknown) =>
        error instanceof ContentValidationError && error.code === "approval_intent_required",
    );
    await assert.rejects(
      () => patchContentItem({
        workspaceId: workspace.id,
        contentItemId: approvedItem.id,
        actorId: "user-1",
        actorRole: "owner",
        expectedVersion: revisedApprovedItem.version,
        status: "approved",
        approvalIntent: true,
        title: "Approval cannot smuggle in an edit",
      }),
      (error: unknown) =>
        error instanceof ContentValidationError && error.code === "approval_must_be_separate",
    );
    const explicitlyReapproved = await patchContentItem({
      workspaceId: workspace.id,
      contentItemId: approvedItem.id,
      actorId: "user-1",
      actorRole: "owner",
      expectedVersion: revisedApprovedItem.version,
      status: "approved",
      approvalIntent: true,
    });
    assert.equal(explicitlyReapproved.status, "approved");
    assert.equal(explicitlyReapproved.approvedBy, "user-1");
    assert.ok(explicitlyReapproved.approvedAt);

    await assert.rejects(
      () =>
        createContentPost({
          workspaceId: workspace.id,
          actorId: "user-1",
          actorRole: "owner",
          brandId: brand.id,
          planId: plan.id,
          title: "Impossible destination",
          coreCopy: "TikTok does not support Pinterest pins.",
          platform: "tiktok",
          format: "pin",
          status: "draft",
          scheduledAt: new Date("2026-08-03T08:00:00.000Z"),
          now: new Date("2026-07-20T00:00:00.000Z"),
        }),
      (error: unknown) =>
        error instanceof ContentValidationError && error.code === "invalid_destination",
    );

    const post = await createContentPost({
      workspaceId: workspace.id,
      actorId: "user-1",
      actorRole: "owner",
      brandId: brand.id,
      planId: plan.id,
      title: "One atomic post",
      coreCopy: "Master and variant copy stay together.",
      platform: "instagram",
      format: "reel",
      status: "draft",
      scheduledAt: new Date("2026-08-04T08:00:00.000Z"),
      now: new Date("2026-07-20T00:00:00.000Z"),
    });
    assert.equal(post.contentItem.version, 1);
    assert.equal(post.publication.contentItemId, post.contentItem.id);
    assert.equal(post.publication.body, post.contentItem.coreCopy);

    const revised = await patchContentPost({
      workspaceId: workspace.id,
      actorId: "user-1",
      actorRole: "owner",
      publicationId: post.publication.id,
      expectedVersion: 1,
      title: "One revised post",
      coreCopy: "Both records change in one transaction.",
      status: "ready",
      scheduledAt: new Date("2026-08-05T08:00:00.000Z"),
      now: new Date("2026-07-20T00:00:00.000Z"),
    });
    assert.equal(revised.contentItem.version, 2);
    assert.equal(revised.contentItem.status, "review");
    assert.equal(revised.publication.status, "ready");
    assert.equal(revised.publication.title, revised.contentItem.title);
    assert.equal(revised.publication.body, revised.contentItem.coreCopy);

    await assert.rejects(
      () =>
        patchContentPost({
          workspaceId: workspace.id,
          actorId: "member-1",
          actorRole: "member",
          publicationId: post.publication.id,
          expectedVersion: 2,
          title: "Member rewrite that must not stay ready",
        }),
      (error: unknown) => error instanceof WorkspaceAuthorizationError,
    );
    await assert.rejects(
      () =>
        moveCalendarPublication({
          workspaceId: workspace.id,
          publicationId: post.publication.id,
          actorRole: "member",
          expectedVersion: 2,
          scheduledAt: new Date("2026-08-06T08:00:00.000Z"),
          now: new Date("2026-07-20T00:00:00.000Z"),
        }),
      (error: unknown) => error instanceof WorkspaceAuthorizationError,
    );

    const approved = await patchContentItem({
      workspaceId: workspace.id,
      contentItemId: post.contentItem.id,
      actorId: "user-1",
      actorRole: "owner",
      expectedVersion: 2,
      status: "approved",
      approvalIntent: true,
    });
    assert.equal(approved.version, 3);
    assert.equal(approved.status, "approved");

    const moved = await moveCalendarPublication({
      workspaceId: workspace.id,
      publicationId: post.publication.id,
      actorRole: "owner",
      expectedVersion: 3,
      scheduledAt: new Date("2026-08-06T08:00:00.000Z"),
      now: new Date("2026-07-20T00:00:00.000Z"),
    });
    assert.equal(moved.contentItem.version, 4);
    assert.equal(moved.contentItem.status, "review");
    assert.equal(moved.contentItem.approvedBy, null);
    assert.equal(moved.contentItem.approvedAt, null);
    await assert.rejects(
      () =>
        patchContentPost({
          workspaceId: workspace.id,
          actorId: "user-1",
          actorRole: "owner",
          publicationId: post.publication.id,
          expectedVersion: 3,
          title: "Stale after legacy move",
        }),
      (error: unknown) =>
        error instanceof ContentVersionConflictError && error.currentVersion === 4,
    );

    const legacyMaster = await createContentItem({
      workspaceId: workspace.id,
      createdBy: "user-1",
      actorRole: "owner",
      brandId: brand.id,
      status: "draft",
      title: "Legacy calendar lifecycle",
    });
    const legacyReady = await createCalendarPublication({
      workspaceId: workspace.id,
      contentItemId: legacyMaster.id,
      actorRole: "owner",
      expectedVersion: legacyMaster.version,
      platform: "instagram",
      format: "post",
      body: "The master must enter review with its ready publication.",
      status: "ready",
      scheduledAt: new Date("2026-08-07T08:00:00.000Z"),
      now: new Date("2026-07-20T00:00:00.000Z"),
    });
    assert.equal(legacyReady.contentItem.status, "review");
    assert.equal(legacyReady.contentItem.version, legacyMaster.version + 1);
    const legacyDraft = await moveCalendarPublication({
      workspaceId: workspace.id,
      publicationId: legacyReady.publication.id,
      actorRole: "owner",
      expectedVersion: legacyReady.contentItem.version,
      scheduledAt: new Date("2026-08-08T08:00:00.000Z"),
      status: "draft",
      now: new Date("2026-07-20T00:00:00.000Z"),
    });
    assert.equal(legacyDraft.contentItem.status, "draft");
    assert.equal(legacyDraft.contentItem.version, legacyReady.contentItem.version + 1);
    await assert.rejects(
      () =>
        patchContentPost({
          workspaceId: otherWorkspace.id,
          actorId: "other-user",
          actorRole: "owner",
          publicationId: post.publication.id,
          expectedVersion: 2,
          title: "Cross-tenant edit",
        }),
      (error: unknown) => error instanceof ContentNotFoundError,
    );
  } finally {
    await prisma.workspace.delete({ where: { id: workspace.id } }).catch(() => undefined);
    await prisma.workspace.delete({ where: { id: otherWorkspace.id } }).catch(() => undefined);
    await prisma.$disconnect();
  }
});

integrationTest("content plan mutations are versioned, role-aware, and preserve detached content", async () => {
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const workspace = await prisma.workspace.create({
    data: { name: "Plan tenant", slug: `plan-${suffix}`, timezone: "Europe/Madrid" },
  });
  const otherWorkspace = await prisma.workspace.create({
    data: { name: "Other plan tenant", slug: `other-plan-${suffix}` },
  });

  try {
    const [brand, otherBrand] = await Promise.all([
      prisma.brand.create({
        data: { workspaceId: workspace.id, name: "Plan brand", isPrimary: true },
      }),
      prisma.brand.create({
        data: { workspaceId: otherWorkspace.id, name: "Other plan brand", isPrimary: true },
      }),
    ]);
    const plan = await createContentPlan({
      workspaceId: workspace.id,
      createdBy: "owner-1",
      brandId: brand.id,
      name: "Versioned week",
      period: "week",
      startDate: new Date("2026-08-02T22:00:00.000Z"),
      endDate: new Date("2026-08-09T22:00:00.000Z"),
      timezone: "Europe/Madrid",
    });
    assert.equal(plan.version, 1);

    const concurrent = await Promise.allSettled([
      patchContentPlan({
        workspaceId: workspace.id,
        planId: plan.id,
        actorRole: "owner",
        expectedVersion: 1,
        name: "Winning plan A",
      }),
      patchContentPlan({
        workspaceId: workspace.id,
        planId: plan.id,
        actorRole: "owner",
        expectedVersion: 1,
        name: "Winning plan B",
      }),
    ]);
    assert.equal(concurrent.filter((attempt) => attempt.status === "fulfilled").length, 1);
    const stalePatch = concurrent.find((attempt) => attempt.status === "rejected");
    assert.ok(stalePatch && stalePatch.status === "rejected");
    assert.ok(stalePatch.reason instanceof ContentVersionConflictError);
    assert.equal(stalePatch.reason.currentVersion, 2);

    await assert.rejects(
      () =>
        patchContentPlan({
          workspaceId: workspace.id,
          planId: plan.id,
          actorRole: "member",
          expectedVersion: 2,
          objective: "Members cannot refine draft strategy",
        }),
      (error: unknown) => error instanceof WorkspaceAuthorizationError,
    );
    const active = await patchContentPlan({
      workspaceId: workspace.id,
      planId: plan.id,
      actorRole: "admin",
      expectedVersion: 2,
      status: "active",
    });
    assert.equal(active.version, 3);
    await assert.rejects(
      () =>
        patchContentPlan({
          workspaceId: workspace.id,
          planId: plan.id,
          actorRole: "member",
          expectedVersion: 3,
          name: "Members cannot rewrite an active plan",
        }),
      (error: unknown) => error instanceof WorkspaceAuthorizationError,
    );

    const deletable = await createContentPlan({
      workspaceId: workspace.id,
      createdBy: "owner-1",
      brandId: brand.id,
      name: "Plan to delete",
      period: "week",
      startDate: new Date("2026-08-09T22:00:00.000Z"),
      endDate: new Date("2026-08-16T22:00:00.000Z"),
      timezone: "Europe/Madrid",
    });
    const preservedItem = await createContentItem({
      workspaceId: workspace.id,
      createdBy: "owner-1",
      actorRole: "owner",
      planId: deletable.id,
      status: "draft",
      title: "Preserve me",
    });
    const preservedApprovalDraft = await createContentItem({
      workspaceId: workspace.id,
      createdBy: "owner-1",
      actorRole: "owner",
      planId: deletable.id,
      status: "review",
      title: "Approval must not survive plan detachment",
    });
    const preservedApprovedItem = await patchContentItem({
      workspaceId: workspace.id,
      contentItemId: preservedApprovalDraft.id,
      actorId: "owner-1",
      actorRole: "owner",
      expectedVersion: preservedApprovalDraft.version,
      status: "approved",
      approvalIntent: true,
    });
    await assert.rejects(
      () =>
        deleteContentPlan({
          workspaceId: workspace.id,
          planId: deletable.id,
          actorRole: "member",
          expectedVersion: 1,
        }),
      (error: unknown) => error instanceof WorkspaceAuthorizationError,
    );
    await assert.rejects(
      () =>
        deleteContentPlan({
          workspaceId: otherWorkspace.id,
          planId: deletable.id,
          actorRole: "owner",
          expectedVersion: 1,
        }),
      (error: unknown) => error instanceof ContentNotFoundError,
    );
    const revisedDeletable = await patchContentPlan({
      workspaceId: workspace.id,
      planId: deletable.id,
      actorRole: "owner",
      expectedVersion: 1,
      objective: "Create a stale delete attempt",
    });
    await assert.rejects(
      () =>
        deleteContentPlan({
          workspaceId: workspace.id,
          planId: deletable.id,
          actorRole: "owner",
          expectedVersion: 1,
        }),
      (error: unknown) =>
        error instanceof ContentVersionConflictError && error.currentVersion === 2,
    );
    const deleted = await deleteContentPlan({
      workspaceId: workspace.id,
      planId: deletable.id,
      actorRole: "admin",
      expectedVersion: revisedDeletable.version,
    });
    assert.equal(deleted.planId, deletable.id);
    assert.equal(deleted.deleted, true);
    assert.deepEqual(
      deleted.contentItems.map((contentItem) => ({
        id: contentItem.id,
        planId: contentItem.planId,
        status: contentItem.status,
        version: contentItem.version,
      })),
      [
        {
          id: preservedItem.id,
          planId: null,
          status: "draft",
          version: preservedItem.version + 1,
        },
        {
          id: preservedApprovedItem.id,
          planId: null,
          status: "review",
          version: preservedApprovedItem.version + 1,
        },
      ],
    );
    assert.equal(await prisma.contentPlan.count({ where: { id: deletable.id } }), 0);
    const detachedDraft = await prisma.contentItem.findUniqueOrThrow({
      where: { id: preservedItem.id },
    });
    assert.equal(detachedDraft.planId, null);
    assert.equal(detachedDraft.version, preservedItem.version + 1);
    const detachedApproved = await prisma.contentItem.findUniqueOrThrow({
      where: { id: preservedApprovedItem.id },
    });
    assert.equal(detachedApproved.planId, null);
    assert.equal(detachedApproved.version, preservedApprovedItem.version + 1);
    assert.equal(detachedApproved.status, "review");
    assert.equal(detachedApproved.approvedBy, null);
    assert.equal(detachedApproved.approvedAt, null);

    const racedPlan = await createContentPlan({
      workspaceId: workspace.id,
      createdBy: "owner-1",
      brandId: brand.id,
      name: "Concurrent attachment plan",
      period: "week",
      startDate: new Date("2026-09-06T22:00:00.000Z"),
      endDate: new Date("2026-09-13T22:00:00.000Z"),
      timezone: "Europe/Madrid",
    });
    let markAttachmentReady!: () => void;
    const attachmentReady = new Promise<void>((resolve) => {
      markAttachmentReady = resolve;
    });
    let releaseAttachment!: () => void;
    const holdAttachment = new Promise<void>((resolve) => {
      releaseAttachment = resolve;
    });
    const inFlightAttachment = prisma.$transaction(async (tx) => {
      await tx.$queryRaw`
        SELECT "id"
        FROM "content_plans"
        WHERE "id" = ${racedPlan.id}
        FOR KEY SHARE
      `;
      const item = await tx.contentItem.create({
        data: {
          workspaceId: workspace.id,
          brandId: brand.id,
          planId: racedPlan.id,
          status: "draft",
          source: "manual",
          title: "Attachment already in flight",
          createdBy: "owner-1",
        },
      });
      markAttachmentReady();
      await holdAttachment;
      return item;
    });
    await attachmentReady;
    const racedDeletion = deleteContentPlan({
      workspaceId: workspace.id,
      planId: racedPlan.id,
      actorRole: "owner",
      expectedVersion: racedPlan.version,
    });
    let deletionBlockedOnParent = false;
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const [state] = await prisma.$queryRaw<Array<{ blocked: boolean }>>`
        SELECT EXISTS (
          SELECT 1
          FROM pg_stat_activity
          WHERE pid <> pg_backend_pid()
            AND datname = current_database()
            AND wait_event_type = 'Lock'
            AND query ILIKE '%content_plans%'
        ) AS "blocked"
      `;
      if (state?.blocked) {
        deletionBlockedOnParent = true;
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    try {
      assert.equal(deletionBlockedOnParent, true);
    } finally {
      releaseAttachment();
    }
    const [racedItem, racedDeleteResult] = await Promise.all([
      inFlightAttachment,
      racedDeletion,
    ]);
    const racedDetached = racedDeleteResult.contentItems.find(
      (contentItem) => contentItem.id === racedItem.id,
    );
    assert.ok(racedDetached);
    assert.equal(racedDetached.planId, null);
    assert.equal(racedDetached.version, racedItem.version + 1);
    const racedStoredItem = await prisma.contentItem.findUniqueOrThrow({
      where: { id: racedItem.id },
    });
    assert.equal(racedStoredItem.planId, null);
    assert.equal(racedStoredItem.version, racedItem.version + 1);

    const otherPlan = await createContentPlan({
      workspaceId: otherWorkspace.id,
      createdBy: "other-owner",
      brandId: otherBrand.id,
      name: "Other tenant stays intact",
      period: "week",
      startDate: new Date("2026-08-02T00:00:00.000Z"),
      endDate: new Date("2026-08-09T00:00:00.000Z"),
      timezone: "UTC",
    });
    assert.equal((await listContentPlans(otherWorkspace.id))[0]?.id, otherPlan.id);
  } finally {
    await prisma.workspace.delete({ where: { id: workspace.id } }).catch(() => undefined);
    await prisma.workspace.delete({ where: { id: otherWorkspace.id } }).catch(() => undefined);
    await prisma.$disconnect();
  }
});

integrationTest("content post deletion advances the master version and preserves sibling variants", async () => {
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const workspace = await prisma.workspace.create({
    data: { name: "Delete post tenant", slug: `delete-post-${suffix}` },
  });

  try {
    const brand = await prisma.brand.create({
      data: { workspaceId: workspace.id, name: "Delete post brand", isPrimary: true },
    });
    const post = await createContentPost({
      workspaceId: workspace.id,
      actorId: "owner-1",
      actorRole: "owner",
      brandId: brand.id,
      title: "Shared master",
      coreCopy: "One master, two channel variants.",
      platform: "instagram",
      format: "post",
      status: "draft",
      scheduledAt: new Date("2026-08-05T09:00:00.000Z"),
      now: new Date("2026-07-20T00:00:00.000Z"),
    });
    const sibling = await prisma.publication.create({
      data: {
        workspaceId: workspace.id,
        contentItemId: post.contentItem.id,
        platform: "facebook",
        format: "post",
        status: "draft",
        body: "Sibling variant",
        scheduledAt: new Date("2026-08-06T09:00:00.000Z"),
      },
    });

    const deleted = await deleteContentPost({
      workspaceId: workspace.id,
      publicationId: post.publication.id,
      actorRole: "owner",
      expectedVersion: 1,
    });
    assert.equal(deleted.publicationId, post.publication.id);
    assert.equal(deleted.contentItemId, post.contentItem.id);
    assert.equal(deleted.contentItemVersion, 2);
    assert.equal(deleted.contentItem.version, 2);
    assert.equal(await prisma.publication.count({ where: { id: post.publication.id } }), 0);
    assert.equal(await prisma.publication.count({ where: { id: sibling.id } }), 1);
    assert.equal(
      (await prisma.contentItem.findUniqueOrThrow({ where: { id: post.contentItem.id } })).version,
      2,
    );

    await assert.rejects(
      () =>
        deleteContentPost({
          workspaceId: workspace.id,
          publicationId: sibling.id,
          actorRole: "owner",
          expectedVersion: 1,
        }),
      (error: unknown) =>
        error instanceof ContentVersionConflictError && error.currentVersion === 2,
    );

    const ready = await patchContentPost({
      workspaceId: workspace.id,
      actorId: "owner-1",
      actorRole: "owner",
      publicationId: sibling.id,
      expectedVersion: 2,
      status: "ready",
      now: new Date("2026-07-20T00:00:00.000Z"),
    });
    assert.equal(ready.contentItem.version, 3);
    await assert.rejects(
      () =>
        deleteContentPost({
          workspaceId: workspace.id,
          publicationId: sibling.id,
          actorRole: "member",
          expectedVersion: 3,
        }),
      (error: unknown) => error instanceof WorkspaceAuthorizationError,
    );
    await prisma.publication.update({
      where: { id: sibling.id },
      data: {
        status: "published",
        publishedAt: new Date("2026-08-06T09:05:00.000Z"),
        permalink: "https://www.facebook.com/marpin/posts/123",
      },
    });
    const terminalAttempt = await prisma.publicationAttempt.create({
      data: {
        workspaceId: workspace.id,
        publicationId: sibling.id,
        provider: "test_provider",
        idempotencyKey: `terminal-${suffix}`,
        requestHash: "f".repeat(64),
        contentVersion: ready.contentItem.version,
        status: "succeeded",
        response: { externalId: "123" },
      },
    });
    await assert.rejects(
      () =>
        moveCalendarPublication({
          workspaceId: workspace.id,
          publicationId: sibling.id,
          actorRole: "owner",
          expectedVersion: ready.contentItem.version,
          scheduledAt: new Date("2026-08-07T09:00:00.000Z"),
          status: "draft",
        }),
      (error: unknown) =>
        error instanceof ContentValidationError && error.code === "publication_not_editable",
    );
    const unchangedTerminal = await prisma.publication.findUniqueOrThrow({
      where: { id: sibling.id },
    });
    assert.equal(unchangedTerminal.status, "published");
    assert.equal(unchangedTerminal.permalink, "https://www.facebook.com/marpin/posts/123");
    await assert.rejects(
      () =>
        deleteContentPost({
          workspaceId: workspace.id,
          publicationId: sibling.id,
          actorRole: "owner",
          expectedVersion: ready.contentItem.version,
        }),
      (error: unknown) =>
        error instanceof ContentValidationError && error.code === "publication_not_editable",
    );
    assert.equal(await prisma.publication.count({ where: { id: sibling.id } }), 1);
    assert.equal(await prisma.publicationAttempt.count({ where: { id: terminalAttempt.id } }), 1);
    assert.equal(await prisma.contentItem.count({ where: { id: post.contentItem.id } }), 1);
  } finally {
    await prisma.workspace.delete({ where: { id: workspace.id } }).catch(() => undefined);
    await prisma.$disconnect();
  }
});

integrationTest("Content Studio pagination reaches items beyond the first 100 without duplicates", async () => {
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const workspace = await prisma.workspace.create({
    data: { name: "Paginated Studio", slug: `studio-page-${suffix}` },
  });
  const otherWorkspace = await prisma.workspace.create({
    data: { name: "Other paginated Studio", slug: `other-studio-page-${suffix}` },
  });

  try {
    const brand = await prisma.brand.create({
      data: { workspaceId: workspace.id, name: "Pagination brand", isPrimary: true },
    });
    await prisma.contentItem.createMany({
      data: Array.from({ length: 105 }, (_, index) => ({
        id: `studio-page-${String(index).padStart(3, "0")}-${suffix}`,
        workspaceId: workspace.id,
        brandId: brand.id,
        status: "draft",
        title: `Paginated idea ${index}`,
        updatedAt: new Date(Date.UTC(2026, 7, 21, 12, 0, 0) - index * 1_000),
      })),
    });
    await prisma.contentItem.create({
      data: {
        workspaceId: otherWorkspace.id,
        status: "draft",
        title: "A different tenant's private idea",
      },
    });

    const first = await listContentStudioItems({
      workspaceId: workspace.id,
      brandId: brand.id,
      take: 100,
    });
    assert.equal(first.items.length, 100);
    assert.ok(first.nextCursor);

    const second = await listContentStudioItems({
      workspaceId: workspace.id,
      brandId: brand.id,
      cursor: first.nextCursor ?? undefined,
      take: 100,
    });
    assert.equal(second.items.length, 5);
    assert.equal(second.nextCursor, null);

    const ids = [...first.items, ...second.items].map((item) => item.contentItem.id);
    assert.equal(ids.length, 105);
    assert.equal(new Set(ids).size, 105);
    assert.ok(ids.every((id) => id.endsWith(suffix)));
  } finally {
    await prisma.workspace.delete({ where: { id: workspace.id } }).catch(() => undefined);
    await prisma.workspace.delete({ where: { id: otherWorkspace.id } }).catch(() => undefined);
    await prisma.$disconnect();
  }
});

integrationTest("Content Studio variants and reusable assets remain versioned and tenant-safe", async () => {
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const workspace = await prisma.workspace.create({
    data: { name: "Studio tenant", slug: `studio-${suffix}` },
  });
  const otherWorkspace = await prisma.workspace.create({
    data: { name: "Other studio tenant", slug: `other-studio-${suffix}` },
  });

  try {
    const brand = await prisma.brand.create({
      data: { workspaceId: workspace.id, name: "Studio brand", isPrimary: true },
    });
    const master = await createContentItem({
      workspaceId: workspace.id,
      createdBy: "owner-1",
      actorRole: "owner",
      brandId: brand.id,
      status: "draft",
      title: "One idea, many channels",
      coreCopy: "A durable master idea.",
    });

    await assert.rejects(
      () =>
        createContentVariant({
          workspaceId: workspace.id,
          contentItemId: master.id,
          actorRole: "owner",
          expectedVersion: 1,
          platform: "tiktok",
          format: "pin",
          body: "Impossible variant",
          status: "draft",
        }),
      (error: unknown) =>
        error instanceof ContentValidationError && error.code === "invalid_destination",
    );

    const instagram = await createContentVariant({
      workspaceId: workspace.id,
      contentItemId: master.id,
      actorRole: "owner",
      expectedVersion: 1,
      platform: "instagram",
      format: "reel",
      title: "Instagram hook",
      body: "A concise Reel script.",
      status: "draft",
    });
    assert.equal(instagram.contentItem.version, 2);
    assert.equal(instagram.publication.scheduledAt, null);

    const facebook = await createContentVariant({
      workspaceId: workspace.id,
      contentItemId: master.id,
      actorRole: "owner",
      expectedVersion: 2,
      platform: "facebook",
      format: "post",
      body: "A fuller Facebook adaptation.",
      status: "draft",
    });
    assert.equal(facebook.contentItem.version, 3);

    const ready = await patchContentVariant({
      workspaceId: workspace.id,
      publicationId: instagram.publication.id,
      actorRole: "owner",
      expectedVersion: 3,
      status: "ready",
    });
    assert.equal(ready.contentItem.version, 4);
    assert.equal(ready.contentItem.status, "review");
    await assert.rejects(
      () =>
        patchContentVariant({
          workspaceId: workspace.id,
          publicationId: facebook.publication.id,
          actorRole: "owner",
          expectedVersion: 3,
          body: "Stale sibling edit",
        }),
      (error: unknown) =>
        error instanceof ContentVersionConflictError && error.currentVersion === 4,
    );
    await assert.rejects(
      () =>
        patchContentVariant({
          workspaceId: workspace.id,
          publicationId: facebook.publication.id,
          actorRole: "member",
          expectedVersion: 4,
          body: "Member edit after review",
        }),
      (error: unknown) => error instanceof WorkspaceAuthorizationError,
    );

    const asset = await prisma.asset.create({
      data: {
        workspaceId: workspace.id,
        kind: "image",
        mimeType: "image/png",
        bytes: 128,
        storageKey: `ws/${workspace.id}/studio.png`,
        filename: "studio.png",
      },
    });
    const otherAsset = await prisma.asset.create({
      data: {
        workspaceId: otherWorkspace.id,
        kind: "image",
        mimeType: "image/png",
        bytes: 128,
        storageKey: `ws/${otherWorkspace.id}/private.png`,
      },
    });
    const attached = await attachContentAsset({
      workspaceId: workspace.id,
      contentItemId: master.id,
      assetId: asset.id,
      actorRole: "owner",
      expectedVersion: 4,
      role: "cover",
      position: 0,
      altText: "Founder planning a distribution week",
    });
    assert.equal(attached.contentItem.version, 5);
    assert.match(attached.link.asset.contentUrl, new RegExp(`/api/assets/${asset.id}/content$`));
    assert.equal("storageKey" in attached.link.asset, false);

    await assert.rejects(
      () =>
        attachContentAsset({
          workspaceId: workspace.id,
          contentItemId: master.id,
          assetId: otherAsset.id,
          actorRole: "owner",
          expectedVersion: 5,
          role: "media",
          position: 1,
        }),
      (error: unknown) => error instanceof ContentNotFoundError,
    );

    const studio = await listContentStudioItems({
      workspaceId: workspace.id,
      brandId: brand.id,
    });
    assert.equal(studio.items.length, 1);
    assert.equal(studio.items[0]?.publications.length, 2);
    assert.equal(studio.items[0]?.assets.length, 1);
    assert.equal(studio.nextCursor, null);
    assert.equal(
      (await listContentStudioItems({ workspaceId: otherWorkspace.id })).items.length,
      0,
    );

    const detached = await detachContentAsset({
      workspaceId: workspace.id,
      contentItemId: master.id,
      linkId: attached.link.id,
      actorRole: "owner",
      expectedVersion: 5,
    });
    assert.equal(detached.contentItemVersion, 6);
    const deletedFacebook = await deleteContentVariant({
      workspaceId: workspace.id,
      publicationId: facebook.publication.id,
      actorRole: "owner",
      expectedVersion: 6,
    });
    assert.equal(deletedFacebook.contentItemVersion, 7);

    const approvedMasterDraft = await createContentItem({
      workspaceId: workspace.id,
      createdBy: "owner-1",
      actorRole: "owner",
      brandId: brand.id,
      status: "review",
      title: "Approval must follow the exact creative",
    });
    const approvedMaster = await patchContentItem({
      workspaceId: workspace.id,
      contentItemId: approvedMasterDraft.id,
      actorId: "owner-1",
      actorRole: "owner",
      expectedVersion: approvedMasterDraft.version,
      status: "approved",
      approvalIntent: true,
    });
    assert.equal(approvedMaster.approvedBy, "owner-1");
    assert.ok(approvedMaster.approvedAt);

    const approvedVariant = await createContentVariant({
      workspaceId: workspace.id,
      contentItemId: approvedMaster.id,
      actorRole: "owner",
      expectedVersion: approvedMaster.version,
      platform: "instagram",
      format: "post",
      body: "First approved adaptation.",
      status: "draft",
    });
    assert.equal(approvedVariant.contentItem.status, "review");
    assert.equal(approvedVariant.contentItem.approvedBy, null);
    assert.equal(approvedVariant.contentItem.approvedAt, null);

    const reapprovedVariantMaster = await patchContentItem({
      workspaceId: workspace.id,
      contentItemId: approvedMaster.id,
      actorId: "owner-1",
      actorRole: "owner",
      expectedVersion: approvedVariant.contentItem.version,
      status: "approved",
      approvalIntent: true,
    });
    const editedApprovedVariant = await patchContentVariant({
      workspaceId: workspace.id,
      publicationId: approvedVariant.publication.id,
      actorRole: "owner",
      expectedVersion: reapprovedVariantMaster.version,
      body: "A changed adaptation needs a fresh approval.",
    });
    assert.equal(editedApprovedVariant.contentItem.status, "review");
    assert.equal(editedApprovedVariant.contentItem.approvedBy, null);

    const reapprovedForAsset = await patchContentItem({
      workspaceId: workspace.id,
      contentItemId: approvedMaster.id,
      actorId: "owner-1",
      actorRole: "owner",
      expectedVersion: editedApprovedVariant.contentItem.version,
      status: "approved",
      approvalIntent: true,
    });
    const attachedToApproved = await attachContentAsset({
      workspaceId: workspace.id,
      contentItemId: approvedMaster.id,
      assetId: asset.id,
      actorRole: "owner",
      expectedVersion: reapprovedForAsset.version,
      role: "cover",
      position: 0,
      altText: "A revised approved visual",
    });
    assert.equal(attachedToApproved.contentItem.status, "review");
    assert.equal(attachedToApproved.contentItem.approvedAt, null);

    const reapprovedForDetach = await patchContentItem({
      workspaceId: workspace.id,
      contentItemId: approvedMaster.id,
      actorId: "owner-1",
      actorRole: "owner",
      expectedVersion: attachedToApproved.contentItem.version,
      status: "approved",
      approvalIntent: true,
    });
    const detachedFromApproved = await detachContentAsset({
      workspaceId: workspace.id,
      contentItemId: approvedMaster.id,
      linkId: attachedToApproved.link.id,
      actorRole: "owner",
      expectedVersion: reapprovedForDetach.version,
    });
    assert.equal(detachedFromApproved.contentItem.status, "review");
    assert.equal(detachedFromApproved.contentItem.approvedBy, null);

    const reapprovedForDelete = await patchContentItem({
      workspaceId: workspace.id,
      contentItemId: approvedMaster.id,
      actorId: "owner-1",
      actorRole: "owner",
      expectedVersion: detachedFromApproved.contentItem.version,
      status: "approved",
      approvalIntent: true,
    });
    const deletedApprovedVariant = await deleteContentVariant({
      workspaceId: workspace.id,
      publicationId: approvedVariant.publication.id,
      actorRole: "owner",
      expectedVersion: reapprovedForDelete.version,
    });
    assert.equal(deletedApprovedVariant.contentItem.status, "review");
    assert.equal(deletedApprovedVariant.contentItem.approvedBy, null);
    assert.equal(deletedApprovedVariant.contentItem.approvedAt, null);

    const reapprovedForLegacyRoute = await patchContentItem({
      workspaceId: workspace.id,
      contentItemId: approvedMaster.id,
      actorId: "owner-1",
      actorRole: "owner",
      expectedVersion: deletedApprovedVariant.contentItem.version,
      status: "approved",
      approvalIntent: true,
    });
    const legacyCreated = await createCalendarPublication({
      workspaceId: workspace.id,
      contentItemId: approvedMaster.id,
      actorRole: "owner",
      expectedVersion: reapprovedForLegacyRoute.version,
      platform: "pinterest",
      format: "pin",
      body: "A legacy route still needs the same approval boundary.",
      status: "draft",
    });
    const afterLegacyCreate = legacyCreated.contentItem;
    assert.equal(afterLegacyCreate.version, reapprovedForLegacyRoute.version + 1);
    assert.equal(afterLegacyCreate.status, "review");
    assert.equal(afterLegacyCreate.approvedBy, null);
    assert.equal(legacyCreated.publication.contentItemId, approvedMaster.id);

    const approvedForLegacyRace = await patchContentItem({
      workspaceId: workspace.id,
      contentItemId: approvedMaster.id,
      actorId: "owner-1",
      actorRole: "owner",
      expectedVersion: afterLegacyCreate.version,
      status: "approved",
      approvalIntent: true,
    });
    const legacyRace = await Promise.allSettled([
      createCalendarPublication({
        workspaceId: workspace.id,
        contentItemId: approvedMaster.id,
        actorRole: "owner",
        expectedVersion: approvedForLegacyRace.version,
        platform: "reddit",
        format: "post",
        body: "Concurrent legacy mutation",
        status: "draft",
      }),
      patchContentItem({
        workspaceId: workspace.id,
        contentItemId: approvedMaster.id,
        actorId: "owner-1",
        actorRole: "owner",
        expectedVersion: approvedForLegacyRace.version,
        status: "approved",
        approvalIntent: true,
      }),
    ]);
    assert.equal(legacyRace.filter((result) => result.status === "fulfilled").length, 1);
    const rejectedLegacyRace = legacyRace.find((result) => result.status === "rejected");
    assert.ok(rejectedLegacyRace && rejectedLegacyRace.status === "rejected");
    assert.ok(rejectedLegacyRace.reason instanceof ContentVersionConflictError);
    const racePublication = await prisma.publication.findFirst({
      where: { contentItemId: approvedMaster.id, body: "Concurrent legacy mutation" },
    });
    const afterLegacyRace = await getContentItem(workspace.id, approvedMaster.id);
    assert.equal(afterLegacyRace.status, racePublication ? "review" : "approved");
    assert.equal(racePublication ? afterLegacyRace.approvedBy : "owner-1", racePublication ? null : "owner-1");
  } finally {
    await prisma.workspace.delete({ where: { id: workspace.id } }).catch(() => undefined);
    await prisma.workspace.delete({ where: { id: otherWorkspace.id } }).catch(() => undefined);
    await prisma.$disconnect();
  }
});

integrationTest("asset attachment and deletion serialize without a false success", async () => {
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const workspace = await prisma.workspace.create({
    data: { name: "Asset race tenant", slug: `asset-race-${suffix}` },
  });

  try {
    const brand = await prisma.brand.create({
      data: { workspaceId: workspace.id, name: "Asset race brand", isPrimary: true },
    });
    const item = await createContentItem({
      workspaceId: workspace.id,
      createdBy: "owner-1",
      actorRole: "owner",
      brandId: brand.id,
      status: "draft",
      title: "One asset race",
    });
    const asset = await prisma.asset.create({
      data: {
        workspaceId: workspace.id,
        kind: "image",
        mimeType: "image/png",
        bytes: 68,
        filename: "race.png",
        storageKey: `ws/${workspace.id}/race.png`,
      },
    });

    const [attachment, deletion] = await Promise.allSettled([
      attachContentAsset({
        workspaceId: workspace.id,
        contentItemId: item.id,
        assetId: asset.id,
        actorRole: "owner",
        expectedVersion: item.version,
        role: "media",
        position: 0,
      }),
      markAssetForDeletion(workspace.id, asset.id),
    ]);
    assert.equal([attachment, deletion].filter((result) => result.status === "fulfilled").length, 1);

    const storedAsset = await prisma.asset.findUniqueOrThrow({ where: { id: asset.id } });
    const linkCount = await prisma.contentItemAsset.count({
      where: { contentItemId: item.id, assetId: asset.id },
    });
    const storedItem = await prisma.contentItem.findUniqueOrThrow({ where: { id: item.id } });
    if (attachment.status === "fulfilled") {
      assert.equal(deletion.status, "rejected");
      assert.ok(deletion.reason instanceof AssetInUseError);
      assert.equal(linkCount, 1);
      assert.equal(storedAsset.storageKey, asset.storageKey);
      assert.equal(storedItem.version, item.version + 1);
    } else {
      assert.ok(attachment.reason instanceof ContentNotFoundError);
      assert.equal(deletion.status, "fulfilled");
      assert.equal(linkCount, 0);
      assert.ok(storedAsset.storageKey.startsWith(DELETING_ASSET_STORAGE_PREFIX));
      assert.equal(storedItem.version, item.version);
    }
  } finally {
    await prisma.workspace.delete({ where: { id: workspace.id } }).catch(() => undefined);
    await prisma.$disconnect();
  }
});

integrationTest("generated media commits content, storage, and credits as one transaction", async () => {
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const workspace = await prisma.workspace.create({
    data: { name: "Generated media tenant", slug: `generated-media-${suffix}` },
  });

  try {
    const brand = await prisma.brand.create({
      data: { workspaceId: workspace.id, name: "Generated media brand", isPrimary: true },
    });
    const imageDraft = await createContentItem({
      workspaceId: workspace.id,
      createdBy: "owner-1",
      actorRole: "owner",
      brandId: brand.id,
      status: "review",
      title: "Generate a visual",
    });
    const item = await patchContentItem({
      workspaceId: workspace.id,
      contentItemId: imageDraft.id,
      actorId: "owner-1",
      actorRole: "owner",
      expectedVersion: imageDraft.version,
      status: "approved",
      approvalIntent: true,
    });
    const usageKey = `content-image:${suffix}`;
    await prisma.usageEvent.create({
      data: {
        workspaceId: workspace.id,
        idempotencyKey: usageKey,
        requestHash: "a".repeat(64),
        kind: "answer",
        credits: 4,
        model: "gemini-test-image",
        status: "reserved",
        periodStart: new Date("2026-07-01T00:00:00.000Z"),
        periodEnd: new Date("2026-08-01T00:00:00.000Z"),
      },
    });
    const reservation = await prisma.asset.create({
      data: {
        workspaceId: workspace.id,
        kind: "image",
        mimeType: "image/png",
        bytes: 68,
        filename: "generated.png",
        source: "generated",
        metadata: { requestHash: "a".repeat(64) },
        storageKey: `${PENDING_ASSET_STORAGE_PREFIX}${suffix}`,
      },
    });
    const committed = await commitGeneratedContentAsset({
      workspaceId: workspace.id,
      contentItemId: item.id,
      actorRole: "owner",
      expectedVersion: item.version,
      reservation: {
        id: reservation.id,
        workspaceId: workspace.id,
        pendingStorageKey: reservation.storageKey,
        planId: "free",
        currentBytes: 0,
        requestedBytes: 68,
        limitBytes: 1_000,
      },
      storageKey: `ws/${workspace.id}/generated.png`,
      usageKey,
      altText: "A generated product visual",
    });
    assert.equal(committed.contentItem.version, item.version + 1);
    assert.equal(committed.contentItem.status, "review");
    assert.equal(committed.contentItem.approvedBy, null);
    assert.equal(committed.contentItem.approvedAt, null);
    assert.equal(committed.link.asset.source, "generated");
    assert.equal(committed.link.altText, "A generated product visual");
    assert.equal(
      (await prisma.usageEvent.findUniqueOrThrow({
        where: {
          workspaceId_idempotencyKey: {
            workspaceId: workspace.id,
            idempotencyKey: usageKey,
          },
        },
      })).status,
      "committed",
    );
    assert.equal(
      (await prisma.asset.findUniqueOrThrow({ where: { id: reservation.id } })).storageKey,
      `ws/${workspace.id}/generated.png`,
    );
    const replay = await findCommittedGeneratedContentAsset({
      workspaceId: workspace.id,
      contentItemId: item.id,
      usageKey,
      requestHash: "a".repeat(64),
    });
    assert.equal(replay?.link.id, committed.link.id);
    assert.equal(replay?.contentItem.version, committed.contentItem.version);
    assert.equal(
      await findCommittedGeneratedContentAsset({
        workspaceId: workspace.id,
        contentItemId: item.id,
        usageKey,
        requestHash: "c".repeat(64),
      }),
      null,
    );

    const staleUsageKey = `content-image-stale:${suffix}`;
    await prisma.usageEvent.create({
      data: {
        workspaceId: workspace.id,
        idempotencyKey: staleUsageKey,
        requestHash: "b".repeat(64),
        kind: "answer",
        credits: 4,
        model: "gemini-test-image",
        status: "reserved",
        periodStart: new Date("2026-07-01T00:00:00.000Z"),
        periodEnd: new Date("2026-08-01T00:00:00.000Z"),
      },
    });
    const staleAsset = await prisma.asset.create({
      data: {
        workspaceId: workspace.id,
        kind: "image",
        mimeType: "image/png",
        bytes: 68,
        source: "generated",
        storageKey: `${PENDING_ASSET_STORAGE_PREFIX}stale-${suffix}`,
      },
    });
    await assert.rejects(
      () => commitGeneratedContentAsset({
        workspaceId: workspace.id,
        contentItemId: item.id,
        actorRole: "owner",
        expectedVersion: 1,
        reservation: {
          id: staleAsset.id,
          workspaceId: workspace.id,
          pendingStorageKey: staleAsset.storageKey,
          planId: "free",
          currentBytes: 68,
          requestedBytes: 68,
          limitBytes: 1_000,
        },
        storageKey: `ws/${workspace.id}/stale.png`,
        usageKey: staleUsageKey,
      }),
      (error: unknown) =>
        error instanceof ContentVersionConflictError &&
        error.currentVersion === committed.contentItem.version,
    );
    assert.equal(
      (await prisma.usageEvent.findUniqueOrThrow({
        where: {
          workspaceId_idempotencyKey: {
            workspaceId: workspace.id,
            idempotencyKey: staleUsageKey,
          },
        },
      })).status,
      "reserved",
    );
    assert.equal(
      (await prisma.asset.findUniqueOrThrow({ where: { id: staleAsset.id } })).storageKey,
      `${PENDING_ASSET_STORAGE_PREFIX}stale-${suffix}`,
    );
  } finally {
    await prisma.workspace.delete({ where: { id: workspace.id } }).catch(() => undefined);
    await prisma.$disconnect();
  }
});

integrationTest("weekly generation persists seven drafts atomically and reuses its request id", async () => {
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const workspace = await prisma.workspace.create({
    data: { name: "Generation tenant", slug: `generation-${suffix}`, timezone: "Europe/Madrid" },
  });
  const otherWorkspace = await prisma.workspace.create({
    data: { name: "Other generation tenant", slug: `other-generation-${suffix}` },
  });

  try {
    const brand = await prisma.brand.create({
      data: {
        workspaceId: workspace.id,
        name: "Generated brand",
        isPrimary: true,
        timezone: "Europe/Madrid",
        audience: ["Solo founders"],
        offers: ["A distribution workspace"],
      },
    });
    const requestId = `weekly_generation_${suffix}`;
    const generated = await generateWeeklyContentPlan(
      {
        workspaceId: workspace.id,
        actorId: "owner-1",
        brandId: brand.id,
        platforms: ["instagram", "reddit", "youtube"],
        requestId,
        now: new Date("2026-07-20T10:00:00.000Z"),
      },
      { ideaGenerator: buildFallbackWeeklyIdeas },
    );
    assert.equal(generated.reused, false);
    assert.equal(generated.fallback, true);
    assert.equal(generated.plan.version, 1);
    assert.equal(generated.plan.startDate, "2026-07-26T22:00:00.000Z");
    assert.equal(generated.plan.endDate, "2026-08-02T22:00:00.000Z");
    assert.equal(generated.posts.length, 7);
    assert.ok(generated.posts.every((post) => post.contentItem.source === "ai"));
    assert.ok(generated.posts.every((post) => post.publication.status === "draft"));
    assert.equal(await prisma.contentPlan.count({ where: { workspaceId: workspace.id } }), 1);
    assert.equal(await prisma.contentItem.count({ where: { planId: generated.plan.id } }), 7);
    assert.equal(
      await prisma.publication.count({ where: { contentItem: { planId: generated.plan.id } } }),
      7,
    );

    let retriedGenerator = false;
    const reused = await generateWeeklyContentPlan(
      {
        workspaceId: workspace.id,
        actorId: "owner-1",
        brandId: brand.id,
        platforms: ["instagram", "reddit", "youtube"],
        requestId,
        now: new Date("2026-07-20T10:00:00.000Z"),
      },
      {
        ideaGenerator: () => {
          retriedGenerator = true;
          throw new Error("The idempotent retry must not generate again");
        },
      },
    );
    assert.equal(retriedGenerator, false);
    assert.equal(reused.reused, true);
    assert.equal(reused.plan.id, generated.plan.id);
    assert.equal(reused.posts.length, 7);

    await assert.rejects(
      () =>
        generateWeeklyContentPlan(
          {
            workspaceId: workspace.id,
            actorId: "owner-1",
            brandId: brand.id,
            platforms: ["instagram"],
            requestId,
            now: new Date("2026-07-20T10:00:00.000Z"),
          },
          { ideaGenerator: buildFallbackWeeklyIdeas },
      ),
      (error: unknown) =>
        error instanceof ContentStateConflictError && error.code === "idempotency_conflict",
    );

    await assert.rejects(
      () =>
        generateWeeklyContentPlan(
          {
            workspaceId: otherWorkspace.id,
            actorId: "other-owner",
            brandId: brand.id,
            platforms: ["instagram"],
            requestId: `cross_tenant_${suffix}`,
            now: new Date("2026-07-20T10:00:00.000Z"),
          },
          { ideaGenerator: buildFallbackWeeklyIdeas },
        ),
      (error: unknown) => error instanceof ContentNotFoundError,
    );
  } finally {
    await prisma.workspace.delete({ where: { id: workspace.id } }).catch(() => undefined);
    await prisma.workspace.delete({ where: { id: otherWorkspace.id } }).catch(() => undefined);
    await prisma.$disconnect();
  }
});

integrationTest("weekly generation rolls back when credit settlement fails and succeeds on a safe retry", async () => {
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const workspace = await prisma.workspace.create({
    data: { name: "Generation settlement tenant", slug: `generation-settlement-${suffix}` },
  });

  try {
    const brand = await prisma.brand.create({
      data: { workspaceId: workspace.id, name: "Settlement brand", isPrimary: true },
    });
    const requestId = `settlement_generation_${suffix}`;
    const usageReservationKey = `content-plan-settlement:${suffix}`;
    const generationInput = {
      workspaceId: workspace.id,
      actorId: "owner-1",
      brandId: brand.id,
      platforms: ["instagram"],
      requestId,
      now: new Date("2026-07-20T10:00:00.000Z"),
    };

    await assert.rejects(
      () =>
        generateWeeklyContentPlan(generationInput, {
          ideaGenerator: buildFallbackWeeklyIdeas,
          usageReservationKey,
        }),
      (error: unknown) =>
        error instanceof ContentValidationError && error.code === "usage_settlement_failed",
    );
    assert.equal(await prisma.contentPlan.count({ where: { workspaceId: workspace.id } }), 0);
    assert.equal(await prisma.contentItem.count({ where: { workspaceId: workspace.id } }), 0);
    assert.equal(await prisma.publication.count({ where: { workspaceId: workspace.id } }), 0);

    await prisma.usageEvent.create({
      data: {
        workspaceId: workspace.id,
        idempotencyKey: usageReservationKey,
        requestHash: "a".repeat(64),
        kind: "answer",
        credits: 1,
        model: "integration-test",
        status: "reserved",
        periodStart: new Date("2026-07-01T00:00:00.000Z"),
        periodEnd: new Date("2026-08-01T00:00:00.000Z"),
        reservedAt: new Date("2026-07-20T10:00:00.000Z"),
      },
    });

    const retried = await generateWeeklyContentPlan(generationInput, {
      ideaGenerator: buildFallbackWeeklyIdeas,
      usageReservationKey,
    });
    assert.equal(retried.reused, false);
    assert.equal(retried.posts.length, 7);
    const usage = await prisma.usageEvent.findUniqueOrThrow({
      where: {
        workspaceId_idempotencyKey: {
          workspaceId: workspace.id,
          idempotencyKey: usageReservationKey,
        },
      },
    });
    assert.equal(usage.status, "committed");
    assert.equal(usage.releasedAt, null);
    assert.ok(usage.committedAt);
  } finally {
    await prisma.workspace.delete({ where: { id: workspace.id } }).catch(() => undefined);
    await prisma.$disconnect();
  }
});

integrationTest("weekly generation rolls back the entire plan when capacity is exhausted", async () => {
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const workspace = await prisma.workspace.create({
    data: { name: "Generation cap tenant", slug: `generation-cap-${suffix}` },
  });

  try {
    const brand = await prisma.brand.create({
      data: { workspaceId: workspace.id, name: "Capacity brand", isPrimary: true },
    });
    const existingItem = await prisma.contentItem.create({
      data: {
        workspaceId: workspace.id,
        brandId: brand.id,
        title: "Existing scheduled content",
        status: "draft",
        source: "manual",
      },
    });
    await prisma.publication.createMany({
      data: Array.from({ length: 4 }, (_, index) => ({
        workspaceId: workspace.id,
        contentItemId: existingItem.id,
        platform: "instagram",
        format: "post",
        status: "draft",
        body: `Existing post ${index + 1}`,
        scheduledAt: new Date(`2026-08-0${index + 4}T09:00:00.000Z`),
      })),
    });

    await assert.rejects(
      () =>
        generateWeeklyContentPlan(
          {
            workspaceId: workspace.id,
            actorId: "owner-1",
            brandId: brand.id,
            platforms: ["instagram"],
            requestId: `capacity_generation_${suffix}`,
            now: new Date("2026-07-20T10:00:00.000Z"),
          },
          { ideaGenerator: buildFallbackWeeklyIdeas },
        ),
      (error: unknown) =>
        error instanceof EntitlementDeniedError && error.code === "scheduled_post_limit",
    );
    assert.equal(await prisma.contentPlan.count({ where: { workspaceId: workspace.id } }), 0);
    assert.equal(await prisma.contentItem.count({ where: { workspaceId: workspace.id } }), 1);
    assert.equal(await prisma.publication.count({ where: { workspaceId: workspace.id } }), 4);
  } finally {
    await prisma.workspace.delete({ where: { id: workspace.id } }).catch(() => undefined);
    await prisma.$disconnect();
  }
});

integrationTest("AI copy proposals are preview artifacts accepted atomically through manual saves", async () => {
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const workspace = await prisma.workspace.create({
    data: { name: "Proposal tenant", slug: `proposal-${suffix}` },
  });

  try {
    const brand = await prisma.brand.create({
      data: { workspaceId: workspace.id, name: "Proposal brand", isPrimary: true },
    });
    const item = await createContentItem({
      workspaceId: workspace.id,
      createdBy: "owner-1",
      actorRole: "owner",
      brandId: brand.id,
      status: "draft",
      title: "Original master",
      coreCopy: "Original copy",
    });
    const masterProposal = await prisma.contentProposal.create({
      data: {
        workspaceId: workspace.id,
        brandId: brand.id,
        contentItemId: item.id,
        requestId: `master_${suffix}`,
        requestHash: "master-hash",
        kind: "master",
        fields: {
          title: "Generated master",
          objective: "Teach",
          brief: "Show the workflow",
          coreCopy: "Generated copy",
        },
        provider: "anthropic",
        model: "claude-sonnet-4-6",
        createdBy: "owner-1",
      },
    });

    const editedMaster = await patchContentItem({
      workspaceId: workspace.id,
      contentItemId: item.id,
      actorId: "owner-1",
      actorRole: "owner",
      expectedVersion: 1,
      title: "Founder-edited generated master",
      coreCopy: "Generated copy with a manual correction",
      proposalId: masterProposal.id,
    });
    assert.equal(editedMaster.title, "Founder-edited generated master");
    assert.equal(editedMaster.source, "manual");
    const acceptedMaster = await prisma.contentProposal.findUniqueOrThrow({
      where: { id: masterProposal.id },
    });
    assert.equal(acceptedMaster.status, "accepted");
    assert.equal(acceptedMaster.acceptedBy, "owner-1");
    assert.ok(acceptedMaster.acceptedAt);
    assert.equal(acceptedMaster.model, "claude-sonnet-4-6");

    const variantProposal = await prisma.contentProposal.create({
      data: {
        workspaceId: workspace.id,
        brandId: brand.id,
        contentItemId: item.id,
        requestId: `variant_${suffix}`,
        requestHash: "variant-hash",
        kind: "variant",
        platform: "tiktok",
        format: "video",
        fields: {
          title: "Generated TikTok hook",
          body: "Generated TikTok script",
          firstComment: "What would you ship?",
        },
        provider: "anthropic",
        model: "claude-sonnet-4-6",
        createdBy: "owner-1",
      },
    });
    const variant = await createContentVariant({
      workspaceId: workspace.id,
      contentItemId: item.id,
      actorId: "owner-1",
      actorRole: "owner",
      expectedVersion: 2,
      platform: "tiktok",
      format: "video",
      title: "Founder-edited TikTok hook",
      body: "Generated TikTok script",
      firstComment: "What would you ship?",
      status: "draft",
      proposalId: variantProposal.id,
    });
    assert.equal(variant.publication.title, "Founder-edited TikTok hook");
    const acceptedVariant = await prisma.contentProposal.findUniqueOrThrow({
      where: { id: variantProposal.id },
    });
    assert.equal(acceptedVariant.status, "accepted");
    assert.equal(acceptedVariant.publicationId, variant.publication.id);
  } finally {
    await prisma.workspace.delete({ where: { id: workspace.id } }).catch(() => undefined);
    await prisma.$disconnect();
  }
});
