import assert from "node:assert/strict";
import test from "node:test";

import { WorkspaceAuthorizationError } from "../../auth";
import { prisma } from "../../db";
import { SEO_COMPLETION_MEANING } from "../../seo/evidence";
import {
  SeoConflictError,
  SeoNotFoundError,
  SeoUnavailableError,
} from "../../seo/errors";
import {
  acceptSeoProposal,
  generateSeoProposal,
} from "../../seo/proposals";
import {
  analyzeSeo,
  createSeoTask,
  getSeoWorkspace,
  patchSeoTask,
} from "../../seo/service";

function disposableTestDatabaseEnabled(): boolean {
  if (process.env.MARPIN_INTEGRATION_DATABASE !== "1") return false;
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) return false;
  if (process.env.TEST_DATABASE_URL && process.env.TEST_DATABASE_URL !== databaseUrl) {
    return false;
  }
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

function suffix(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

const AUDIT = {
  findings: [{
    code: "meta-description-missing",
    category: "content",
    severity: "warning",
    title: "Add a useful meta description",
    evidence: "The persisted crawl did not find a meta description.",
    recommendation: "Write a factual description that matches the visible page.",
    scoreImpact: 6,
  }],
};

integrationTest("SEO analysis and task tracking are sourced, tenant-safe, and version-safe", async () => {
  const id = suffix();
  const workspace = await prisma.workspace.create({
    data: { name: "SEO workspace", slug: `seo-${id}` },
  });
  const otherWorkspace = await prisma.workspace.create({
    data: { name: "Other SEO workspace", slug: `other-seo-${id}` },
  });

  try {
    const brand = await prisma.brand.create({
      data: {
        workspaceId: workspace.id,
        name: "Marpin",
        websiteUrl: "https://www.marpin.ai",
        isPrimary: true,
        auditSnapshot: AUDIT,
        auditedAt: new Date("2026-07-21T08:00:00.000Z"),
      },
    });
    const otherBrand = await prisma.brand.create({
      data: {
        workspaceId: otherWorkspace.id,
        name: "Other tenant",
        websiteUrl: "https://other.example",
        isPrimary: true,
      },
    });
    const searchConnection = await prisma.connection.create({
      data: {
        workspaceId: workspace.id,
        platform: "search_console",
        externalAccountId: "sc-domain:marpin.ai",
        encAccessToken: "encrypted-test-token",
        status: "connected",
      },
    });
    const unrelatedSearchConnection = await prisma.connection.create({
      data: {
        workspaceId: workspace.id,
        platform: "search_console",
        externalAccountId: "https://unrelated.example/",
        encAccessToken: "encrypted-test-token",
        status: "connected",
      },
    });
    const ga4Connection = await prisma.connection.create({
      data: {
        workspaceId: workspace.id,
        platform: "ga4",
        externalAccountId: "properties/123",
        displayName: "marpin.ai",
        encAccessToken: "encrypted-test-token",
        status: "connected",
      },
    });
    const otherTenantConnection = await prisma.connection.create({
      data: {
        workspaceId: otherWorkspace.id,
        platform: "search_console",
        externalAccountId: "sc-domain:other.example",
        encAccessToken: "encrypted-test-token",
        status: "connected",
      },
    });
    await prisma.metricFact.createMany({
      data: [
        {
          workspaceId: workspace.id,
          connectionId: searchConnection.id,
          platform: "search_console",
          date: new Date("2026-07-20T00:00:00.000Z"),
          campaign: "",
          campaignExternalId: "account",
          metric: "clicks",
          value: 12,
        },
        {
          workspaceId: workspace.id,
          connectionId: searchConnection.id,
          platform: "search_console",
          date: new Date("2026-07-20T00:00:00.000Z"),
          campaign: "",
          campaignExternalId: "account",
          metric: "impressions",
          value: 240,
        },
        {
          workspaceId: workspace.id,
          connectionId: ga4Connection.id,
          platform: "ga4",
          date: new Date("2026-07-20T00:00:00.000Z"),
          campaign: "",
          campaignExternalId: "account",
          metric: "sessions",
          value: 37,
        },
        {
          workspaceId: workspace.id,
          connectionId: ga4Connection.id,
          platform: "ga4",
          date: new Date("2026-07-20T00:00:00.000Z"),
          campaign: "",
          campaignExternalId: "account",
          metric: "conversions",
          value: 3,
        },
        {
          workspaceId: workspace.id,
          connectionId: unrelatedSearchConnection.id,
          platform: "search_console",
          date: new Date("2026-07-20T00:00:00.000Z"),
          campaign: "unrelated-account",
          campaignExternalId: "account",
          metric: "clicks",
          value: 777,
        },
        {
          workspaceId: workspace.id,
          connectionId: searchConnection.id,
          platform: "search_console",
          date: new Date("2026-07-20T00:00:00.000Z"),
          campaign: "stale-account",
          campaignExternalId: "stale-account",
          metric: "clicks",
          value: 888,
          staleAt: new Date("2026-07-21T09:00:00.000Z"),
        },
        {
          workspaceId: workspace.id,
          connectionId: null,
          platform: "search_console",
          date: new Date("2026-07-20T00:00:00.000Z"),
          campaign: "legacy-account",
          campaignExternalId: "legacy-account",
          metric: "clicks",
          value: 999,
        },
        {
          workspaceId: otherWorkspace.id,
          connectionId: otherTenantConnection.id,
          platform: "search_console",
          date: new Date("2026-07-20T00:00:00.000Z"),
          campaign: "",
          campaignExternalId: "account",
          metric: "clicks",
          value: 999,
        },
      ],
    });

    const analyzed = await analyzeSeo({
      workspaceId: workspace.id,
      brandId: brand.id,
      actorId: "owner-1",
      actorRole: "owner",
      now: new Date("2026-07-21T10:00:00.000Z"),
    });
    assert.deepEqual(analyzed.analysis, { created: 3, refreshed: 0 });
    assert.deepEqual(analyzed.sources.map((source) => source.state), [
      "available",
      "available",
      "available",
    ]);
    assert.deepEqual(new Set(analyzed.tasks.map((task) => task.source)), new Set([
      "crawl",
      "search_console",
      "ga4",
    ]));
    const searchTask = analyzed.tasks.find((task) => task.source === "search_console");
    assert.ok(searchTask);
    assert.equal(searchTask.evidence.find((item) => item.label.endsWith("· clicks"))?.value, "12");
    assert.deepEqual(Object.keys(searchTask).sort(), [
      "category",
      "completedAt",
      "completionNote",
      "description",
      "evidence",
      "id",
      "priority",
      "recommendedFix",
      "severity",
      "source",
      "status",
      "title",
      "updatedAt",
      "verificationStatus",
      "version",
    ]);

    const workflowOnly = await patchSeoTask({
      workspaceId: workspace.id,
      taskId: searchTask.id,
      actorId: "owner-1",
      actorRole: "owner",
      expectedVersion: searchTask.version,
      status: "in_progress",
    });
    assert.equal(workflowOnly.status, "in_progress");
    assert.equal(
      (await prisma.seoTask.findUniqueOrThrow({ where: { id: searchTask.id } })).userEdited,
      false,
    );

    await prisma.metricFact.updateMany({
      where: {
        workspaceId: workspace.id,
        connectionId: searchConnection.id,
        metric: "clicks",
        staleAt: null,
      },
      data: { value: 20 },
    });
    const generatedRefresh = await analyzeSeo({
      workspaceId: workspace.id,
      brandId: brand.id,
      actorId: "admin-1",
      actorRole: "admin",
      now: new Date("2026-07-21T10:30:00.000Z"),
    });
    assert.deepEqual(generatedRefresh.analysis, { created: 0, refreshed: 3 });
    const refreshedGeneratedTask = generatedRefresh.tasks.find((task) => task.id === searchTask.id);
    assert.ok(refreshedGeneratedTask);
    assert.notEqual(refreshedGeneratedTask.description, searchTask.description);
    assert.match(refreshedGeneratedTask.description, /clicks=20/);
    assert.equal(refreshedGeneratedTask.status, "in_progress");

    const memberView = await getSeoWorkspace({
      workspaceId: workspace.id,
      brandId: brand.id,
      actorRole: "member",
    });
    assert.equal(memberView.capability.canManage, false);
    await assert.rejects(
      () => createSeoTask({
        workspaceId: workspace.id,
        brandId: brand.id,
        actorId: "member-1",
        actorRole: "member",
        requestId: `seo-member-create-${id}`,
        title: "Member mutation",
      }),
      WorkspaceAuthorizationError,
    );
    await assert.rejects(
      () => getSeoWorkspace({
        workspaceId: workspace.id,
        brandId: otherBrand.id,
        actorRole: "owner",
      }),
      SeoNotFoundError,
    );

    const manuallyEdited = await patchSeoTask({
      workspaceId: workspace.id,
      taskId: searchTask.id,
      actorId: "owner-1",
      actorRole: "owner",
      expectedVersion: refreshedGeneratedTask.version,
      title: "Founder-prioritized search review",
      category: "founder-priority",
      severity: "critical",
      priority: 4,
      status: "in_progress",
    });
    assert.equal(manuallyEdited.version, refreshedGeneratedTask.version + 1);

    const refreshed = await analyzeSeo({
      workspaceId: workspace.id,
      brandId: brand.id,
      actorId: "admin-1",
      actorRole: "admin",
      now: new Date("2026-07-21T11:00:00.000Z"),
    });
    assert.deepEqual(refreshed.analysis, { created: 0, refreshed: 3 });
    const preserved = refreshed.tasks.find((task) => task.id === searchTask.id);
    assert.ok(preserved);
    assert.equal(preserved.title, "Founder-prioritized search review");
    assert.equal(preserved.category, "founder-priority");
    assert.equal(preserved.severity, "critical");
    assert.equal(preserved.priority, 4);
    assert.equal(preserved.status, "in_progress");
    assert.equal(preserved.version, manuallyEdited.version + 1);

    const completed = await patchSeoTask({
      workspaceId: workspace.id,
      taskId: preserved.id,
      actorId: "owner-1",
      actorRole: "owner",
      expectedVersion: preserved.version,
      status: "completed",
      completionNote: "Implemented manually in the CMS.",
    });
    assert.equal(completed.status, "completed");
    assert.equal(completed.verificationStatus, "unverified");
    assert.equal(completed.completionNote, "Implemented manually in the CMS.");
    assert.equal(SEO_COMPLETION_MEANING, "Tracked as complete in Marpin. Website change not verified.");
    const completionRecord = await prisma.seoTask.findUniqueOrThrow({
      where: { id: completed.id },
      select: { completedAt: true, completedBy: true },
    });
    const editedAfterCompletion = await patchSeoTask({
      workspaceId: workspace.id,
      taskId: completed.id,
      actorId: "admin-2",
      actorRole: "admin",
      expectedVersion: completed.version,
      title: "Founder-prioritized search review, documented",
      status: "completed",
      completionNote: completed.completionNote,
    });
    const completionRecordAfterEdit = await prisma.seoTask.findUniqueOrThrow({
      where: { id: completed.id },
      select: { completedAt: true, completedBy: true },
    });
    assert.equal(
      completionRecordAfterEdit.completedAt?.toISOString(),
      completionRecord.completedAt?.toISOString(),
    );
    assert.equal(completionRecordAfterEdit.completedBy, completionRecord.completedBy);
    await assert.rejects(
      () => patchSeoTask({
        workspaceId: workspace.id,
        taskId: preserved.id,
        actorId: "owner-1",
        actorRole: "owner",
        expectedVersion: preserved.version,
        title: "Stale overwrite",
      }),
      (error: unknown) =>
        error instanceof SeoConflictError && error.currentVersion === editedAfterCompletion.version,
    );

    const manualInput = {
      workspaceId: workspace.id,
      brandId: brand.id,
      actorId: "admin-1",
      actorRole: "admin" as const,
      requestId: `seo-manual-create-${id}`,
      title: "Review canonical tags",
      category: "technical",
      severity: "high" as const,
      priority: 7,
    };
    const [manual, concurrentReplay] = await Promise.all([
      createSeoTask(manualInput),
      createSeoTask(manualInput),
    ]);
    assert.equal(manual.source, "manual");
    assert.equal(manual.priority, 7);
    assert.equal(concurrentReplay.id, manual.id);
    const replay = await createSeoTask(manualInput);
    assert.equal(replay.id, manual.id);
    assert.equal(await prisma.seoTask.count({
      where: {
        workspaceId: workspace.id,
        brandId: brand.id,
        fingerprint: `manual:${manualInput.requestId}`,
      },
    }), 1);
    await assert.rejects(
      () => createSeoTask({ ...manualInput, title: "Different semantic payload" }),
      (error: unknown) =>
        error instanceof SeoConflictError && error.code === "idempotency_conflict",
    );
    assert.equal(
      (await prisma.seoTask.findUniqueOrThrow({ where: { id: manual.id } })).title,
      "Review canonical tags",
    );
  } finally {
    await prisma.workspace.deleteMany({
      where: { id: { in: [workspace.id, otherWorkspace.id] } },
    });
  }
});

integrationTest("SEO AI proposals reserve once, replay safely, and never mutate without acceptance", async () => {
  const id = suffix();
  const workspace = await prisma.workspace.create({
    data: { name: "SEO proposal workspace", slug: `seo-proposal-${id}` },
  });
  const otherWorkspace = await prisma.workspace.create({
    data: { name: "Other proposal workspace", slug: `other-proposal-${id}` },
  });
  const previousLiveOverride = process.env.USE_LIVE_AGENT;

  try {
    const brand = await prisma.brand.create({
      data: {
        workspaceId: workspace.id,
        name: "Marpin",
        websiteUrl: "https://www.marpin.ai",
        isPrimary: true,
      },
    });
    const task = await createSeoTask({
      workspaceId: workspace.id,
      brandId: brand.id,
      actorId: "owner-1",
      actorRole: "owner",
      requestId: `seo-proposal-task-${id}`,
      title: "Improve the pricing page title",
      description: "The persisted crawl found no title.",
      recommendedFix: "Draft a title manually.",
    });
    const requestId = `seo-proposal-${id}`;
    const generated = await generateSeoProposal({
      workspaceId: workspace.id,
      taskId: task.id,
      expectedVersion: task.version,
      requestId,
      instruction: "Keep it factual",
      actorId: "owner-1",
      actorRole: "owner",
    }, {
      generator: () => ({
        recommendedFix: "Draft one factual title, review it, then apply it manually in the CMS.",
      }),
    });
    assert.equal(generated.reused, false);
    assert.equal(generated.proposal.fields.recommendedFix, "Draft one factual title, review it, then apply it manually in the CMS.");
    assert.deepEqual(Object.keys(generated.proposal).sort(), [
      "createdAt",
      "fields",
      "id",
      "model",
      "provider",
      "status",
      "taskId",
    ]);
    assert.equal(
      (await prisma.usageEvent.findUniqueOrThrow({
        where: {
          workspaceId_idempotencyKey: {
            workspaceId: workspace.id,
            idempotencyKey: `seo-proposal:${requestId}`,
          },
        },
      })).status,
      "committed",
    );

    const replay = await generateSeoProposal({
      workspaceId: workspace.id,
      taskId: task.id,
      expectedVersion: task.version,
      requestId,
      instruction: "Keep it factual",
      actorId: "owner-1",
      actorRole: "owner",
    }, {
      generator: () => {
        throw new Error("A replay must not call the provider");
      },
    });
    assert.equal(replay.reused, true);
    assert.equal(replay.proposal.id, generated.proposal.id);
    assert.equal(await prisma.seoProposal.count({ where: { workspaceId: workspace.id } }), 1);
    await assert.rejects(
      () => generateSeoProposal({
        workspaceId: workspace.id,
        taskId: task.id,
        expectedVersion: task.version,
        requestId,
        instruction: "Different request",
        actorId: "owner-1",
        actorRole: "owner",
      }, { generator: () => ({ recommendedFix: "Different" }) }),
      (error: unknown) =>
        error instanceof SeoConflictError && error.code === "idempotency_conflict",
    );

    const accepted = await acceptSeoProposal({
      workspaceId: workspace.id,
      taskId: task.id,
      proposalId: generated.proposal.id,
      expectedVersion: task.version,
      actorId: "admin-1",
      actorRole: "admin",
    });
    assert.equal(accepted.reused, false);
    assert.equal(accepted.proposal.status, "accepted");
    assert.equal(accepted.task.version, task.version + 1);
    assert.equal(accepted.task.recommendedFix, generated.proposal.fields.recommendedFix);
    assert.equal(accepted.task.verificationStatus, "unverified");

    const acceptedReplay = await acceptSeoProposal({
      workspaceId: workspace.id,
      taskId: task.id,
      proposalId: generated.proposal.id,
      expectedVersion: task.version,
      actorId: "admin-1",
      actorRole: "admin",
    });
    assert.equal(acceptedReplay.reused, true);
    assert.equal(acceptedReplay.task.version, accepted.task.version);
    await assert.rejects(
      () => acceptSeoProposal({
        workspaceId: otherWorkspace.id,
        taskId: task.id,
        proposalId: generated.proposal.id,
        expectedVersion: task.version,
        actorId: "other-owner",
        actorRole: "owner",
      }),
      SeoNotFoundError,
    );

    const missingProviderTask = await createSeoTask({
      workspaceId: workspace.id,
      brandId: brand.id,
      actorId: "owner-1",
      actorRole: "owner",
      requestId: `seo-provider-task-${id}`,
      title: "Provider unavailable",
    });
    process.env.USE_LIVE_AGENT = "false";
    const unavailableRequestId = `seo-unavailable-${id}`;
    await assert.rejects(
      () => generateSeoProposal({
        workspaceId: workspace.id,
        taskId: missingProviderTask.id,
        expectedVersion: missingProviderTask.version,
        requestId: unavailableRequestId,
        actorId: "owner-1",
        actorRole: "owner",
      }),
      (error: unknown) =>
        error instanceof SeoUnavailableError && error.code === "ai_generation_unavailable",
    );
    assert.equal(
      await prisma.seoProposal.count({
        where: { workspaceId: workspace.id, requestId: unavailableRequestId },
      }),
      0,
    );
    assert.equal(
      await prisma.usageEvent.count({
        where: {
          workspaceId: workspace.id,
          idempotencyKey: `seo-proposal:${unavailableRequestId}`,
        },
      }),
      0,
    );

    const failedRequestId = `seo-failed-${id}`;
    await assert.rejects(
      () => generateSeoProposal({
        workspaceId: workspace.id,
        taskId: missingProviderTask.id,
        expectedVersion: missingProviderTask.version,
        requestId: failedRequestId,
        actorId: "owner-1",
        actorRole: "owner",
      }, {
        generator: () => {
          throw new Error("provider failed");
        },
      }),
      /provider failed/,
    );
    assert.equal(
      (await prisma.usageEvent.findUniqueOrThrow({
        where: {
          workspaceId_idempotencyKey: {
            workspaceId: workspace.id,
            idempotencyKey: `seo-proposal:${failedRequestId}`,
          },
        },
      })).status,
      "released",
    );
    assert.equal(
      await prisma.seoProposal.count({
        where: { workspaceId: workspace.id, requestId: failedRequestId },
      }),
      0,
    );
    await assert.rejects(
      () => generateSeoProposal({
        workspaceId: workspace.id,
        taskId: missingProviderTask.id,
        expectedVersion: missingProviderTask.version,
        requestId: `seo-member-${id}`,
        actorId: "member-1",
        actorRole: "member",
      }, { generator: () => ({ recommendedFix: "Never reached" }) }),
      WorkspaceAuthorizationError,
    );
  } finally {
    if (previousLiveOverride === undefined) delete process.env.USE_LIVE_AGENT;
    else process.env.USE_LIVE_AGENT = previousLiveOverride;
    await prisma.workspace.deleteMany({
      where: { id: { in: [workspace.id, otherWorkspace.id] } },
    });
  }
});
