import assert from "node:assert/strict";
import test from "node:test";

import { WorkspaceAuthorizationError } from "@/lib/auth";
import { prisma } from "@/lib/db";
import {
  PaidDraftConflictError,
  PaidDraftNotFoundError,
} from "@/lib/paid-drafts/errors";
import {
  PROVIDER_PAUSED_CONFIRMATION,
  parseApprovePaidDraftBody,
  parseConfirmProviderPausedBody,
  parseCreatePaidDraftBody,
  parseExecutePaidDraftBody,
  parseMarkPaidDraftReadyBody,
  parseRecordExternalActivationOutcomeBody,
  parseUpdatePaidDraftBody,
} from "@/lib/paid-drafts/parsers";
import {
  approvePaidCampaignDraftOperation,
  confirmPaidCampaignDraftProviderPaused,
  createPaidCampaignDraft,
  executePaidCampaignDraftOperation,
  getPaidCampaignDraft,
  listPaidCampaignDrafts,
  markPaidCampaignDraftReady,
  recordPaidCampaignDraftExternalActivationOutcome,
  updatePaidCampaignDraft,
} from "@/lib/paid-drafts/service";
import { PaidDraftValidationError } from "@/lib/paid-drafts/validation";

function disposableDatabaseEnabled(): boolean {
  if (process.env.MARPIN_INTEGRATION_DATABASE !== "1") return false;
  const databaseUrl = process.env.DATABASE_URL;
  const allowedUrl = process.env.POSTGRES_TEST_URL ?? process.env.TEST_DATABASE_URL;
  if (!databaseUrl || !allowedUrl || databaseUrl !== allowedUrl) return false;
  try {
    const url = new URL(databaseUrl);
    return (
      (url.hostname === "localhost" || url.hostname === "127.0.0.1") &&
      /(?:_test|_ci)$/.test(url.pathname.slice(1))
    );
  } catch {
    return false;
  }
}

const integrationTest = disposableDatabaseEnabled() ? test : test.skip;

function suffix(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function googleSnapshot(input: {
  connectionId: string;
  accountId: string;
  source?: "manual" | "ai";
  campaignName?: string;
}) {
  return {
    schemaVersion: 1,
    source: input.source ?? "manual",
    platform: "google_ads",
    template: "google_search_rsa",
    connection: {
      platform: "google_ads",
      connectionId: input.connectionId,
      accountId: input.accountId,
      accountName: "Untrusted browser label",
    },
    campaign: {
      name: input.campaignName ?? "Marpin founder launch",
      objective: "traffic",
    },
    budget: { amountMinor: 5_000, currency: "EUR", cadence: "daily" },
    schedule: {
      startsAt: "2026-09-01T09:00:00+02:00",
      endsAt: "2026-09-30T18:00:00+02:00",
      timezone: "Europe/Madrid",
    },
    adGroups: [{
      localId: "group_1",
      name: "Solo founders",
      targeting: {
        kind: "search",
        locations: ["ES"],
        languages: ["en"],
        keywords: [
          { text: "marketing operating system", matchType: "phrase" },
          { text: "ai marketing platform", matchType: "exact" },
        ],
        negativeKeywords: ["agency"],
      },
      ads: [{
        localId: "ad_1",
        name: "Founder search ad",
        format: "responsive_search",
        assetIds: [],
        headlines: [
          "Plan Marketing Faster",
          "One Workspace For Growth",
          "Marpin For Solo Founders",
        ],
        descriptions: [
          "Plan organic and paid distribution in one focused marketing workspace.",
          "Turn your website into a clear weekly growth plan with Marpin.",
        ],
        destinationUrl: "https://www.marpin.ai/",
        path1: "marketing",
        path2: "planner",
      }],
    }],
    assumptions: ["The landing page remains available throughout the campaign."],
  };
}

function socialSnapshot(input: {
  connectionId: string;
  accountId: string;
  platform: "meta_ads" | "tiktok_ads";
  format: "image" | "video";
  assetId: string;
  source?: "manual" | "ai";
  campaignName?: string;
}) {
  return {
    schemaVersion: 1,
    source: input.source ?? "manual",
    platform: input.platform,
    template: input.platform === "meta_ads" ? "meta_traffic" : "tiktok_traffic",
    connection: {
      platform: input.platform,
      connectionId: input.connectionId,
      accountId: input.accountId,
      accountName: "Untrusted account label",
    },
    campaign: {
      name: input.campaignName ?? "Founder social launch",
      objective: "traffic",
    },
    budget: { amountMinor: 3_000, currency: "EUR", cadence: "daily" },
    schedule: {
      startsAt: "2026-09-01T09:00:00+02:00",
      endsAt: "2026-09-30T18:00:00+02:00",
      timezone: "Europe/Madrid",
    },
    adGroups: [{
      localId: "group_1",
      name: "Solo founders",
      targeting: {
        kind: "audience",
        locations: ["ES"],
        languages: ["en"],
        ageMin: 18,
        ageMax: 65,
        genders: ["all"],
        interests: ["software development"],
      },
      ads: [{
        localId: "ad_1",
        name: "Founder creative",
        format: input.format,
        assetIds: [input.assetId],
        primaryText: "Plan organic and paid distribution in one workspace.",
        headline: "Plan the next launch",
        ...(input.platform === "meta_ads" ? { description: null } : {}),
        callToAction: "learn_more",
        destinationUrl: "https://www.marpin.ai/",
      }],
    }],
    assumptions: [],
  };
}

integrationTest("ready drafts can be corrected before handoff and stale schedules cannot be approved", async () => {
  const id = suffix();
  const workspace = await prisma.workspace.create({ data: { name: "Schedule correction", slug: `schedule-${id}` } });
  try {
    const connection = await prisma.connection.create({ data: {
      workspaceId: workspace.id, platform: "google_ads", externalAccountId: `ads-${id}`,
      status: "connected", encAccessToken: "encrypted-test-token",
    } });
    const actor = { workspaceId: workspace.id, actorId: "owner-schedule", actorRole: "owner" as const };
    const created = await createPaidCampaignDraft({ ...actor, body: parseCreatePaidDraftBody({
      requestId: `create-${id}`, connectionId: connection.id,
      snapshot: googleSnapshot({ connectionId: connection.id, accountId: connection.externalAccountId }),
    }) });
    const readyBody = { expectedVersion: 1, snapshotHash: created.draft.snapshotHash };
    await assert.rejects(markPaidCampaignDraftReady({ ...actor, draftId: created.draft.id,
      now: new Date("2026-09-01T07:00:00Z"), body: { ...readyBody, requestId: `past-ready-${id}` },
    }), (error: unknown) => error instanceof PaidDraftValidationError && error.code === "schedule_in_past");
    const ready = await markPaidCampaignDraftReady({ ...actor, draftId: created.draft.id,
      now: new Date("2026-08-21T10:00:00Z"), body: { ...readyBody, requestId: `ready-${id}` },
    });
    assert.equal(ready.draft.capabilities.canEdit, true);
    const approvalBody = { expectedVersion: 2, snapshotHash: ready.draft.snapshotHash, kind: "create_paused" as const };
    await assert.rejects(approvePaidCampaignDraftOperation({ ...actor, draftId: created.draft.id,
      now: new Date("2026-09-02T10:00:00Z"), body: { ...approvalBody, requestId: `past-approve-${id}` },
    }), (error: unknown) => error instanceof PaidDraftValidationError && error.code === "schedule_in_past");
    const approved = await approvePaidCampaignDraftOperation({ ...actor, draftId: created.draft.id,
      now: new Date("2026-08-21T10:00:00Z"), body: { ...approvalBody, requestId: `approve-${id}` },
    });
    const execution = { operation: "create_paused" as const, approvalId: approved.approval.id,
      expectedVersion: 2, snapshotHash: ready.draft.snapshotHash };
    await assert.rejects(executePaidCampaignDraftOperation({ ...actor, draftId: created.draft.id,
      now: new Date("2026-09-02T10:00:00Z"), body: { ...execution, requestId: `past-execute-${id}` },
    }), (error: unknown) => error instanceof PaidDraftValidationError && error.code === "schedule_in_past");
    assert.equal(await prisma.paidCampaignOperationAttempt.count({ where: { draftId: created.draft.id } }), 0);
    const corrected = await updatePaidCampaignDraft({ ...actor, draftId: created.draft.id, body: {
      expectedVersion: 2, requestId: `correct-${id}`,
      snapshot: { ...ready.draft.snapshot, schedule: {
        startsAt: "2026-10-01T09:00:00+02:00", endsAt: "2026-10-08T09:00:00+02:00", timezone: "Europe/Madrid",
      } },
    } });
    assert.equal(corrected.draft.state, "draft");
    assert.equal(corrected.draft.readyAt, null);
    assert.equal(corrected.draft.version, 3);
    assert.notEqual(corrected.draft.snapshotHash, ready.draft.snapshotHash);
    assert.equal(corrected.draft.approvals.length, 1);
    await assert.rejects(executePaidCampaignDraftOperation({ ...actor, draftId: created.draft.id,
      now: new Date("2026-09-02T10:00:00Z"), body: { ...execution, requestId: `stale-execute-${id}` },
    }), (error: unknown) => error instanceof PaidDraftConflictError && error.code === "version_conflict");
    const readyAgain = await markPaidCampaignDraftReady({ ...actor, draftId: created.draft.id,
      now: new Date("2026-09-02T10:00:00Z"), body: {
        expectedVersion: 3, snapshotHash: corrected.draft.snapshotHash, requestId: `ready-again-${id}`,
      },
    });
    const approvedAgain = await approvePaidCampaignDraftOperation({ ...actor, draftId: created.draft.id,
      now: new Date("2026-09-02T10:00:00Z"), body: {
        expectedVersion: 4, snapshotHash: corrected.draft.snapshotHash, kind: "create_paused", requestId: `approve-again-${id}`,
      },
    });
    await assert.rejects(executePaidCampaignDraftOperation({ ...actor, draftId: created.draft.id,
      now: new Date("2026-09-02T10:00:00Z"), body: {
        ...execution, expectedVersion: 4, snapshotHash: readyAgain.draft.snapshotHash, requestId: `stale-approval-current-version-${id}`,
      },
    }), (error: unknown) => error instanceof PaidDraftConflictError && error.code === "stale_approval");
    const handoff = await executePaidCampaignDraftOperation({ ...actor, draftId: created.draft.id,
      now: new Date("2026-09-02T10:00:00Z"), body: {
        expectedVersion: 4, snapshotHash: readyAgain.draft.snapshotHash, operation: "create_paused",
        approvalId: approvedAgain.approval.id, requestId: `handoff-${id}`,
      },
    });
    assert.equal(handoff.draft.capabilities.canEdit, false);
    await assert.rejects(updatePaidCampaignDraft({ ...actor, draftId: created.draft.id, body: {
      expectedVersion: handoff.draft.version, requestId: `unsafe-edit-${id}`, snapshot: handoff.draft.snapshot,
    } }), (error: unknown) => error instanceof PaidDraftConflictError && error.code === "invalid_state");
  } finally {
    await prisma.workspace.delete({ where: { id: workspace.id } });
  }
});

integrationTest("paid drafts are tenant-safe, replay-safe, approval-bound, and fail closed", async () => {
  const id = suffix();
  const workspace = await prisma.workspace.create({
    data: { name: "Paid drafts", slug: `paid-drafts-${id}` },
  });
  const otherWorkspace = await prisma.workspace.create({
    data: { name: "Other paid drafts", slug: `paid-drafts-other-${id}` },
  });
  const connection = await prisma.connection.create({
    data: {
      workspaceId: workspace.id,
      platform: "google_ads",
      externalAccountId: `ads-${id}`,
      displayName: "Marpin Spain Ads",
      status: "connected",
      encAccessToken: "encrypted-test-token",
    },
  });
  const otherConnection = await prisma.connection.create({
    data: {
      workspaceId: otherWorkspace.id,
      platform: "google_ads",
      externalAccountId: `other-ads-${id}`,
      displayName: "Other Ads",
      status: "connected",
      encAccessToken: "encrypted-other-token",
    },
  });

  try {
    const createBody = parseCreatePaidDraftBody({
      requestId: `draft-create-${id}`,
      connectionId: connection.id,
      snapshot: googleSnapshot({
        connectionId: connection.id,
        accountId: connection.externalAccountId,
      }),
    });

    await assert.rejects(
      () => createPaidCampaignDraft({
        workspaceId: workspace.id,
        actorId: "member-1",
        actorRole: "member",
        body: createBody,
      }),
      WorkspaceAuthorizationError,
    );
    await assert.rejects(
      () => createPaidCampaignDraft({
        workspaceId: workspace.id,
        actorId: "owner-1",
        actorRole: "owner",
        body: parseCreatePaidDraftBody({
          requestId: `cross-connection-${id}`,
          connectionId: otherConnection.id,
          snapshot: googleSnapshot({
            connectionId: otherConnection.id,
            accountId: otherConnection.externalAccountId,
          }),
        }),
      }),
      PaidDraftNotFoundError,
    );
    const spoofed = googleSnapshot({
      connectionId: connection.id,
      accountId: "spoofed-account",
    });
    await assert.rejects(
      () => createPaidCampaignDraft({
        workspaceId: workspace.id,
        actorId: "owner-1",
        actorRole: "owner",
        body: parseCreatePaidDraftBody({
          requestId: `spoofed-account-${id}`,
          connectionId: connection.id,
          snapshot: spoofed,
        }),
      }),
      (error: unknown) =>
        error instanceof PaidDraftValidationError &&
        error.code === "account_mismatch",
    );

    const [created, replay] = await Promise.all([
      createPaidCampaignDraft({
        workspaceId: workspace.id,
        actorId: "owner-1",
        actorRole: "owner",
        body: createBody,
      }),
      createPaidCampaignDraft({
        workspaceId: workspace.id,
        actorId: "owner-1",
        actorRole: "owner",
        body: createBody,
      }),
    ]);
    assert.equal(created.draft.id, replay.draft.id);
    assert.deepEqual(new Set([created.replayed, replay.replayed]), new Set([false, true]));
    assert.equal(created.draft.connection.accountName, "Marpin Spain Ads");
    assert.equal(created.draft.state, "draft");
    assert.equal(created.draft.version, 1);
    assert.equal(created.draft.capabilities.execution.mode, "assisted");
    assert.equal(created.draft.capabilities.execution.createPaused.canExecuteProvider, false);
    assert.equal(await prisma.paidCampaignDraft.count({
      where: { workspaceId: workspace.id },
    }), 1);

    await assert.rejects(
      () => createPaidCampaignDraft({
        workspaceId: workspace.id,
        actorId: "owner-1",
        actorRole: "owner",
        body: parseCreatePaidDraftBody({
          ...createBody,
          snapshot: googleSnapshot({
            connectionId: connection.id,
            accountId: connection.externalAccountId,
            campaignName: "Different semantic campaign",
          }),
        }),
      }),
      (error: unknown) =>
        error instanceof PaidDraftConflictError &&
        error.code === "request_conflict",
    );

    const memberRead = await getPaidCampaignDraft({
      workspaceId: workspace.id,
      draftId: created.draft.id,
      actorRole: "member",
    });
    assert.equal(memberRead.capabilities.canManage, false);
    assert.equal(memberRead.capabilities.canEdit, false);
    assert.equal((await listPaidCampaignDrafts({
      workspaceId: workspace.id,
      actorRole: "member",
      query: { limit: 100 },
    })).length, 1);
    await assert.rejects(
      () => getPaidCampaignDraft({
        workspaceId: otherWorkspace.id,
        draftId: created.draft.id,
        actorRole: "owner",
      }),
      PaidDraftNotFoundError,
    );
    await assert.rejects(
      () => updatePaidCampaignDraft({
        workspaceId: workspace.id,
        draftId: created.draft.id,
        actorId: "member-1",
        actorRole: "member",
        body: parseUpdatePaidDraftBody({
          requestId: `member-update-${id}`,
          expectedVersion: 1,
          snapshot: created.draft.snapshot,
        }),
      }),
      WorkspaceAuthorizationError,
    );

    const updated = await updatePaidCampaignDraft({
      workspaceId: workspace.id,
      draftId: created.draft.id,
      actorId: "admin-1",
      actorRole: "admin",
      body: parseUpdatePaidDraftBody({
        requestId: `draft-update-${id}`,
        expectedVersion: 1,
        snapshot: googleSnapshot({
          connectionId: connection.id,
          accountId: connection.externalAccountId,
          campaignName: "Reviewed founder launch",
        }),
      }),
    });
    assert.equal(updated.draft.version, 2);
    assert.equal(updated.draft.snapshot.campaign.name, "Reviewed founder launch");
    await assert.rejects(
      () => updatePaidCampaignDraft({
        workspaceId: workspace.id,
        draftId: created.draft.id,
        actorId: "owner-1",
        actorRole: "owner",
        body: parseUpdatePaidDraftBody({
          requestId: `stale-update-${id}`,
          expectedVersion: 1,
          snapshot: updated.draft.snapshot,
        }),
      }),
      (error: unknown) =>
        error instanceof PaidDraftConflictError &&
        error.code === "version_conflict" &&
        error.currentVersion === 2,
    );

    const ready = await markPaidCampaignDraftReady({
      workspaceId: workspace.id,
      draftId: created.draft.id,
      actorId: "owner-1",
      actorRole: "owner",
      body: parseMarkPaidDraftReadyBody({
        requestId: `draft-ready-${id}`,
        expectedVersion: 2,
        snapshotHash: updated.draft.snapshotHash,
      }),
      now: new Date("2026-08-21T10:00:00.000Z"),
    });
    assert.equal(ready.draft.state, "ready");
    assert.equal(ready.draft.version, 3);
    assert.equal(ready.draft.readyAt, "2026-08-21T10:00:00.000Z");
    const readyReplay = await markPaidCampaignDraftReady({
      workspaceId: workspace.id,
      draftId: created.draft.id,
      actorId: "owner-1",
      actorRole: "owner",
      body: parseMarkPaidDraftReadyBody({
        requestId: `draft-ready-${id}`,
        expectedVersion: 2,
        snapshotHash: updated.draft.snapshotHash,
      }),
    });
    assert.equal(readyReplay.replayed, true);
    assert.equal(readyReplay.draft.version, 3);

    await assert.rejects(
      () => confirmPaidCampaignDraftProviderPaused({
        workspaceId: workspace.id,
        draftId: created.draft.id,
        actorId: "owner-1",
        actorRole: "owner",
        body: parseConfirmProviderPausedBody({
          requestId: `confirm-before-handoff-${id}`,
          expectedVersion: 3,
          snapshotHash: ready.draft.snapshotHash,
          providerCampaignId: "281498962108233",
          confirmation: PROVIDER_PAUSED_CONFIRMATION,
        }),
      }),
      (error: unknown) =>
        error instanceof PaidDraftConflictError &&
        error.code === "assisted_handoff_required",
    );

    await assert.rejects(
      () => approvePaidCampaignDraftOperation({
        workspaceId: workspace.id,
        draftId: created.draft.id,
        actorId: "owner-1",
        actorRole: "owner",
        body: parseApprovePaidDraftBody({
          requestId: `activation-too-soon-${id}`,
          kind: "activate",
          expectedVersion: 3,
          snapshotHash: ready.draft.snapshotHash,
        }),
      }),
      (error: unknown) =>
        error instanceof PaidDraftConflictError &&
        error.code === "invalid_state",
    );

    const approvedCreate = await approvePaidCampaignDraftOperation({
      workspaceId: workspace.id,
      draftId: created.draft.id,
      actorId: "owner-1",
      actorRole: "owner",
      body: parseApprovePaidDraftBody({
        requestId: `approve-create-${id}`,
        kind: "create_paused",
        expectedVersion: 3,
        snapshotHash: ready.draft.snapshotHash,
      }),
      now: new Date("2026-08-21T10:05:00.000Z"),
    });
    assert.equal(approvedCreate.approval.status, "approved");
    const approvalBefore = await prisma.paidCampaignApproval.findUniqueOrThrow({
      where: { id: approvedCreate.approval.id },
    });

    await prisma.paidCampaignDraft.update({
      where: { id: created.draft.id },
      data: { version: { increment: 1 } },
    });
    await assert.rejects(
      () => executePaidCampaignDraftOperation({
        workspaceId: workspace.id,
        draftId: created.draft.id,
        actorId: "owner-1",
        actorRole: "owner",
        body: parseExecutePaidDraftBody({
          requestId: `stale-create-execute-${id}`,
          approvalId: approvedCreate.approval.id,
          operation: "create_paused",
          expectedVersion: 4,
          snapshotHash: ready.draft.snapshotHash,
        }),
      }),
      (error: unknown) =>
        error instanceof PaidDraftConflictError &&
        error.code === "stale_approval",
    );
    await prisma.paidCampaignDraft.update({
      where: { id: created.draft.id },
      data: { version: 3 },
    });

    const campaignCountBefore = await prisma.campaign.count({
      where: { workspaceId: workspace.id },
    });
    const assistedCreate = await executePaidCampaignDraftOperation({
      workspaceId: workspace.id,
      draftId: created.draft.id,
      actorId: "owner-1",
      actorRole: "owner",
      body: parseExecutePaidDraftBody({
        requestId: `execute-create-${id}`,
        approvalId: approvedCreate.approval.id,
        operation: "create_paused",
        expectedVersion: 3,
        snapshotHash: ready.draft.snapshotHash,
      }),
      now: new Date("2026-08-21T10:10:00.000Z"),
    });
    assert.equal(assistedCreate.attempt.status, "assisted_handoff");
    assert.equal(assistedCreate.attempt.providerOutcome?.providerSideEffect, "none");
    assert.equal(assistedCreate.draft.state, "ready");
    assert.equal(await prisma.campaign.count({ where: { workspaceId: workspace.id } }), campaignCountBefore);
    const assistedReplay = await executePaidCampaignDraftOperation({
      workspaceId: workspace.id,
      draftId: created.draft.id,
      actorId: "owner-1",
      actorRole: "owner",
      body: parseExecutePaidDraftBody({
        requestId: `execute-create-${id}`,
        approvalId: approvedCreate.approval.id,
        operation: "create_paused",
        expectedVersion: 3,
        snapshotHash: ready.draft.snapshotHash,
      }),
    });
    assert.equal(assistedReplay.replayed, true);
    assert.equal(assistedReplay.attempt.id, assistedCreate.attempt.id);
    await assert.rejects(
      () => executePaidCampaignDraftOperation({
        workspaceId: workspace.id,
        draftId: created.draft.id,
        actorId: "owner-1",
        actorRole: "owner",
        body: parseExecutePaidDraftBody({
          requestId: `execute-create-again-${id}`,
          approvalId: approvedCreate.approval.id,
          operation: "create_paused",
          expectedVersion: 3,
          snapshotHash: ready.draft.snapshotHash,
        }),
      }),
      (error: unknown) =>
        error instanceof PaidDraftConflictError &&
        error.code === "approval_consumed",
    );
    const approvalAfter = await prisma.paidCampaignApproval.findUniqueOrThrow({
      where: { id: approvedCreate.approval.id },
    });
    assert.deepEqual(approvalAfter, approvalBefore);

    assert.equal(assistedCreate.draft.capabilities.canConfirmProviderPaused, true);
    const confirmationBody = parseConfirmProviderPausedBody({
      requestId: `confirm-provider-paused-${id}`,
      expectedVersion: 3,
      snapshotHash: ready.draft.snapshotHash,
      providerCampaignId: "281498962108233",
      confirmation: PROVIDER_PAUSED_CONFIRMATION,
    });
    await assert.rejects(
      () => confirmPaidCampaignDraftProviderPaused({
        workspaceId: workspace.id,
        draftId: created.draft.id,
        actorId: "member-1",
        actorRole: "member",
        body: confirmationBody,
      }),
      WorkspaceAuthorizationError,
    );
    await assert.rejects(
      () => confirmPaidCampaignDraftProviderPaused({
        workspaceId: otherWorkspace.id,
        draftId: created.draft.id,
        actorId: "other-owner",
        actorRole: "owner",
        body: confirmationBody,
      }),
      PaidDraftNotFoundError,
    );
    await assert.rejects(
      () => confirmPaidCampaignDraftProviderPaused({
        workspaceId: workspace.id,
        draftId: created.draft.id,
        actorId: "owner-1",
        actorRole: "owner",
        body: parseConfirmProviderPausedBody({
          ...confirmationBody,
          requestId: `confirm-stale-version-${id}`,
          expectedVersion: 2,
        }),
      }),
      (error: unknown) =>
        error instanceof PaidDraftConflictError &&
        error.code === "version_conflict" &&
        error.currentVersion === 3,
    );
    await assert.rejects(
      () => confirmPaidCampaignDraftProviderPaused({
        workspaceId: workspace.id,
        draftId: created.draft.id,
        actorId: "owner-1",
        actorRole: "owner",
        body: parseConfirmProviderPausedBody({
          ...confirmationBody,
          requestId: `confirm-stale-hash-${id}`,
          snapshotHash: "b".repeat(64),
        }),
      }),
      (error: unknown) =>
        error instanceof PaidDraftConflictError &&
        error.code === "snapshot_conflict" &&
        error.currentVersion === 3,
    );
    const confirmedPaused = await confirmPaidCampaignDraftProviderPaused({
      workspaceId: workspace.id,
      draftId: created.draft.id,
      actorId: "admin-1",
      actorRole: "admin",
      body: confirmationBody,
      now: new Date("2026-08-21T10:15:00.000Z"),
    });
    assert.equal(confirmedPaused.replayed, false);
    assert.equal(confirmedPaused.draft.state, "provider_paused");
    assert.equal(confirmedPaused.draft.version, 4);
    assert.deepEqual(confirmedPaused.draft.providerPausedConfirmation, {
      providerCampaignId: "281498962108233",
      verificationStatus: "user_asserted_unverified",
      snapshotVersion: 3,
      snapshotHash: ready.draft.snapshotHash,
      confirmedAt: "2026-08-21T10:15:00.000Z",
    });
    assert.equal(confirmedPaused.draft.capabilities.canApproveActivation, true);
    assert.equal(confirmedPaused.draft.approvals.length, 1);
    const confirmationReplay = await confirmPaidCampaignDraftProviderPaused({
      workspaceId: workspace.id,
      draftId: created.draft.id,
      actorId: "admin-1",
      actorRole: "admin",
      body: confirmationBody,
    });
    assert.equal(confirmationReplay.replayed, true);
    assert.equal(confirmationReplay.draft.version, 4);
    await assert.rejects(
      () => confirmPaidCampaignDraftProviderPaused({
        workspaceId: workspace.id,
        draftId: created.draft.id,
        actorId: "admin-1",
        actorRole: "admin",
        body: parseConfirmProviderPausedBody({
          ...confirmationBody,
          providerCampaignId: "281498962108234",
        }),
      }),
      (error: unknown) =>
        error instanceof PaidDraftConflictError &&
        error.code === "request_conflict",
    );
    const providerPaused = confirmedPaused.draft;
    assert.equal(providerPaused.capabilities.canApproveActivation, true);
    const approvedActivation = await approvePaidCampaignDraftOperation({
      now: new Date("2026-08-21T10:20:00Z"),
      workspaceId: workspace.id,
      draftId: created.draft.id,
      actorId: "owner-1",
      actorRole: "owner",
      body: parseApprovePaidDraftBody({
        requestId: `approve-activation-${id}`,
        kind: "activate",
        expectedVersion: 4,
        snapshotHash: providerPaused.snapshotHash,
      }),
    });
    assert.notEqual(approvedActivation.approval.id, approvedCreate.approval.id);
    assert.equal(approvedActivation.approval.kind, "activate");
    const assistedActivation = await executePaidCampaignDraftOperation({
      now: new Date("2026-08-21T10:21:00Z"),
      workspaceId: workspace.id,
      draftId: created.draft.id,
      actorId: "owner-1",
      actorRole: "owner",
      body: parseExecutePaidDraftBody({
        requestId: `execute-activation-${id}`,
        approvalId: approvedActivation.approval.id,
        operation: "activate",
        expectedVersion: 4,
        snapshotHash: providerPaused.snapshotHash,
      }),
    });
    assert.equal(assistedActivation.attempt.status, "assisted_handoff");
    assert.equal(assistedActivation.draft.state, "provider_paused");
    assert.equal(assistedActivation.draft.capabilities.canApproveActivation, false);
    assert.equal(assistedActivation.draft.capabilities.canRecordExternalActivationOutcome, true);
    const notActivatedBody = parseRecordExternalActivationOutcomeBody({
      requestId: `record-not-activated-${id}`,
      expectedVersion: 4,
      snapshotHash: providerPaused.snapshotHash,
      attemptId: assistedActivation.attempt.id,
      outcome: "not_activated",
    });
    const notActivated = await recordPaidCampaignDraftExternalActivationOutcome({
      workspaceId: workspace.id,
      draftId: created.draft.id,
      actorId: "owner-1",
      actorRole: "owner",
      body: notActivatedBody,
    });
    assert.equal(notActivated.draft.state, "provider_paused");
    assert.equal(notActivated.draft.version, 4);
    assert.equal(notActivated.draft.capabilities.canApproveActivation, true);
    assert.equal(notActivated.draft.capabilities.canRecordExternalActivationOutcome, false);
    assert.equal(notActivated.draft.attempts.find((attempt) => attempt.id === assistedActivation.attempt.id)?.status, "failed");
    assert.equal(notActivated.draft.attempts.find((attempt) => attempt.id === assistedActivation.attempt.id)?.providerOutcome?.kind, "external_activation_outcome");

    const retriedActivation = await approvePaidCampaignDraftOperation({
      now: new Date("2026-08-21T10:22:00Z"),
      workspaceId: workspace.id,
      draftId: created.draft.id,
      actorId: "owner-1",
      actorRole: "owner",
      body: parseApprovePaidDraftBody({
        requestId: `approve-activation-retry-${id}`,
        kind: "activate",
        expectedVersion: 4,
        snapshotHash: providerPaused.snapshotHash,
      }),
    });
    const retriedHandoff = await executePaidCampaignDraftOperation({
      now: new Date("2026-08-21T10:23:00Z"),
      workspaceId: workspace.id,
      draftId: created.draft.id,
      actorId: "owner-1",
      actorRole: "owner",
      body: parseExecutePaidDraftBody({
        requestId: `execute-activation-retry-${id}`,
        approvalId: retriedActivation.approval.id,
        operation: "activate",
        expectedVersion: 4,
        snapshotHash: providerPaused.snapshotHash,
      }),
    });
    const activated = await recordPaidCampaignDraftExternalActivationOutcome({
      workspaceId: workspace.id,
      draftId: created.draft.id,
      actorId: "owner-1",
      actorRole: "owner",
      body: parseRecordExternalActivationOutcomeBody({
        requestId: `record-activated-${id}`,
        expectedVersion: 4,
        snapshotHash: providerPaused.snapshotHash,
        attemptId: retriedHandoff.attempt.id,
        outcome: "activated",
      }),
    });
    assert.equal(activated.draft.state, "active");
    assert.equal(activated.draft.version, 5);
    assert.equal(activated.draft.attempts.find((attempt) => attempt.id === retriedHandoff.attempt.id)?.status, "succeeded");

    const sourceForgedDraft = await createPaidCampaignDraft({
      workspaceId: workspace.id,
      actorId: "owner-1",
      actorRole: "owner",
      body: parseCreatePaidDraftBody({
        requestId: `draft-ai-create-${id}`,
        connectionId: connection.id,
        snapshot: googleSnapshot({
          connectionId: connection.id,
          accountId: connection.externalAccountId,
          source: "ai",
          campaignName: "AI assisted draft",
        }),
      }),
    });
    assert.equal(sourceForgedDraft.draft.source, "manual");
    assert.equal(sourceForgedDraft.draft.snapshot.source, "manual");
    const canonicalSourceReplay = await createPaidCampaignDraft({
      workspaceId: workspace.id,
      actorId: "owner-1",
      actorRole: "owner",
      body: parseCreatePaidDraftBody({
        requestId: `draft-ai-create-${id}`,
        connectionId: connection.id,
        snapshot: googleSnapshot({
          connectionId: connection.id,
          accountId: connection.externalAccountId,
          source: "manual",
          campaignName: "AI assisted draft",
        }),
      }),
    });
    assert.equal(canonicalSourceReplay.replayed, true);
    assert.equal(canonicalSourceReplay.draft.id, sourceForgedDraft.draft.id);
    const sourcePreservingUpdate = await updatePaidCampaignDraft({
      workspaceId: workspace.id,
      draftId: sourceForgedDraft.draft.id,
      actorId: "owner-1",
      actorRole: "owner",
      body: parseUpdatePaidDraftBody({
        requestId: `source-preserving-update-${id}`,
        expectedVersion: 1,
        snapshot: googleSnapshot({
          connectionId: connection.id,
          accountId: connection.externalAccountId,
          source: "ai",
          campaignName: "Edited without provenance forgery",
        }),
      }),
    });
    assert.equal(sourcePreservingUpdate.draft.source, "manual");
    assert.equal(sourcePreservingUpdate.draft.snapshot.source, "manual");
    const canonicalUpdateReplay = await updatePaidCampaignDraft({
      workspaceId: workspace.id,
      draftId: sourceForgedDraft.draft.id,
      actorId: "owner-1",
      actorRole: "owner",
      body: parseUpdatePaidDraftBody({
        requestId: `source-preserving-update-${id}`,
        expectedVersion: 1,
        snapshot: googleSnapshot({
          connectionId: connection.id,
          accountId: connection.externalAccountId,
          source: "manual",
          campaignName: "Edited without provenance forgery",
        }),
      }),
    });
    assert.equal(canonicalUpdateReplay.replayed, true);
    assert.equal(canonicalUpdateReplay.draft.version, 2);
    assert.equal(await prisma.paidCampaignOperationAttempt.count({
      where: { workspaceId: workspace.id },
    }), 3);

    await prisma.connection.delete({ where: { id: connection.id } });
    const replayAfterDisconnect = await createPaidCampaignDraft({
      workspaceId: workspace.id,
      actorId: "owner-1",
      actorRole: "owner",
      body: createBody,
    });
    assert.equal(replayAfterDisconnect.replayed, true);
    assert.equal(replayAfterDisconnect.draft.id, created.draft.id);
    assert.equal(replayAfterDisconnect.draft.capabilities.execution.mode, "assisted");
    assert.equal(
      replayAfterDisconnect.draft.capabilities.execution.createPaused.reason,
      "oauth_disconnected",
    );
  } finally {
    await prisma.workspace.deleteMany({
      where: { id: { in: [workspace.id, otherWorkspace.id] } },
    });
  }
});

integrationTest("manual paid draft assets are tenant-safe, format-safe, and revalidated", async () => {
  const id = suffix();
  const workspace = await prisma.workspace.create({
    data: { name: "Paid asset checks", slug: `paid-assets-${id}` },
  });
  const otherWorkspace = await prisma.workspace.create({
    data: { name: "Other paid assets", slug: `paid-assets-other-${id}` },
  });
  const metaConnection = await prisma.connection.create({
    data: {
      workspaceId: workspace.id,
      platform: "meta_ads",
      externalAccountId: `meta-${id}`,
      displayName: "Meta Ads",
      status: "connected",
      encAccessToken: "encrypted-meta-token",
    },
  });
  const tiktokConnection = await prisma.connection.create({
    data: {
      workspaceId: workspace.id,
      platform: "tiktok_ads",
      externalAccountId: `tiktok-${id}`,
      displayName: "TikTok Ads",
      status: "connected",
      encAccessToken: "encrypted-tiktok-token",
    },
  });
  const [image, imageToDelete, video, unsupportedVideo, otherImage] = await Promise.all([
    prisma.asset.create({
      data: {
        workspaceId: workspace.id,
        kind: "image",
        mimeType: "image/png",
        bytes: 16,
        storageKey: `paid-assets/${id}/image.png`,
      },
    }),
    prisma.asset.create({
      data: {
        workspaceId: workspace.id,
        kind: "image",
        mimeType: "image/jpeg",
        bytes: 16,
        storageKey: `paid-assets/${id}/delete.jpg`,
      },
    }),
    prisma.asset.create({
      data: {
        workspaceId: workspace.id,
        kind: "video",
        mimeType: "video/mp4",
        bytes: 16,
        storageKey: `paid-assets/${id}/video.mp4`,
      },
    }),
    prisma.asset.create({
      data: {
        workspaceId: workspace.id,
        kind: "video",
        mimeType: "video/webm",
        bytes: 16,
        storageKey: `paid-assets/${id}/video.webm`,
      },
    }),
    prisma.asset.create({
      data: {
        workspaceId: otherWorkspace.id,
        kind: "image",
        mimeType: "image/png",
        bytes: 16,
        storageKey: `paid-assets/${id}/other.png`,
      },
    }),
  ]);

  try {
    const create = (requestId: string, snapshot: unknown, connectionId: string) =>
      createPaidCampaignDraft({
        workspaceId: workspace.id,
        actorId: "owner-asset-checks",
        actorRole: "owner",
        body: parseCreatePaidDraftBody({ requestId, connectionId, snapshot }),
      });

    await assert.rejects(
      () => create(
        `cross-tenant-asset-${id}`,
        socialSnapshot({
          connectionId: metaConnection.id,
          accountId: metaConnection.externalAccountId,
          platform: "meta_ads",
          format: "image",
          assetId: otherImage.id,
        }),
        metaConnection.id,
      ),
      (error: unknown) =>
        error instanceof PaidDraftValidationError &&
        error.code === "asset_not_found",
    );
    await assert.rejects(
      () => create(
        `tiktok-image-${id}`,
        socialSnapshot({
          connectionId: tiktokConnection.id,
          accountId: tiktokConnection.externalAccountId,
          platform: "tiktok_ads",
          format: "video",
          assetId: image.id,
        }),
        tiktokConnection.id,
      ),
      (error: unknown) =>
        error instanceof PaidDraftValidationError &&
        error.code === "asset_type_mismatch",
    );
    await assert.rejects(
      () => create(
        `tiktok-mime-${id}`,
        socialSnapshot({
          connectionId: tiktokConnection.id,
          accountId: tiktokConnection.externalAccountId,
          platform: "tiktok_ads",
          format: "video",
          assetId: unsupportedVideo.id,
        }),
        tiktokConnection.id,
      ),
      (error: unknown) =>
        error instanceof PaidDraftValidationError &&
        error.code === "asset_mime_mismatch",
    );

    const validMeta = await create(
      `valid-meta-image-${id}`,
      socialSnapshot({
        connectionId: metaConnection.id,
        accountId: metaConnection.externalAccountId,
        platform: "meta_ads",
        format: "image",
        assetId: image.id,
      }),
      metaConnection.id,
    );
    await assert.rejects(
      () => updatePaidCampaignDraft({
        workspaceId: workspace.id,
        draftId: validMeta.draft.id,
        actorId: "admin-asset-checks",
        actorRole: "admin",
        body: parseUpdatePaidDraftBody({
          requestId: `meta-update-type-${id}`,
          expectedVersion: 1,
          snapshot: socialSnapshot({
            connectionId: metaConnection.id,
            accountId: metaConnection.externalAccountId,
            platform: "meta_ads",
            format: "video",
            assetId: image.id,
          }),
        }),
      }),
      (error: unknown) =>
        error instanceof PaidDraftValidationError &&
        error.code === "asset_type_mismatch",
    );
    const validVideoUpdate = await updatePaidCampaignDraft({
      workspaceId: workspace.id,
      draftId: validMeta.draft.id,
      actorId: "admin-asset-checks",
      actorRole: "admin",
      body: parseUpdatePaidDraftBody({
        requestId: `meta-update-video-${id}`,
        expectedVersion: 1,
        snapshot: socialSnapshot({
          connectionId: metaConnection.id,
          accountId: metaConnection.externalAccountId,
          platform: "meta_ads",
          format: "video",
          assetId: video.id,
        }),
      }),
    });
    assert.equal(validVideoUpdate.draft.version, 2);
    await prisma.asset.update({
      where: { id: video.id },
      data: { kind: "image", mimeType: "image/png" },
    });
    await assert.rejects(
      () => markPaidCampaignDraftReady({
        workspaceId: workspace.id,
        draftId: validMeta.draft.id,
        actorId: "owner-asset-checks",
        actorRole: "owner",
        body: parseMarkPaidDraftReadyBody({
          requestId: `ready-mutated-asset-${id}`,
          expectedVersion: 2,
          snapshotHash: validVideoUpdate.draft.snapshotHash,
        }),
      }),
      (error: unknown) =>
        error instanceof PaidDraftValidationError &&
        error.code === "asset_type_mismatch",
    );

    const deletedAssetDraft = await create(
      `deleted-asset-draft-${id}`,
      socialSnapshot({
        connectionId: metaConnection.id,
        accountId: metaConnection.externalAccountId,
        platform: "meta_ads",
        format: "image",
        assetId: imageToDelete.id,
      }),
      metaConnection.id,
    );
    await prisma.asset.delete({ where: { id: imageToDelete.id } });
    await assert.rejects(
      () => markPaidCampaignDraftReady({
        workspaceId: workspace.id,
        draftId: deletedAssetDraft.draft.id,
        actorId: "owner-asset-checks",
        actorRole: "owner",
        body: parseMarkPaidDraftReadyBody({
          requestId: `ready-deleted-asset-${id}`,
          expectedVersion: 1,
          snapshotHash: deletedAssetDraft.draft.snapshotHash,
        }),
      }),
      (error: unknown) =>
        error instanceof PaidDraftValidationError &&
        error.code === "asset_not_found",
    );
  } finally {
    await prisma.workspace.deleteMany({
      where: { id: { in: [workspace.id, otherWorkspace.id] } },
    });
  }
});
