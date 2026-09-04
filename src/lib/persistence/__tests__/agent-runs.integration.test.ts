import assert from "node:assert/strict";
import test from "node:test";

import { WorkspaceAuthorizationError } from "@/lib/auth";
import { executeAgentRun, reconcileExpiredAgentRuns } from "@/lib/agent-runs/coordinator";
import { AgentRunConflictError, AgentRunNotFoundError } from "@/lib/agent-runs/errors";
import { agentSnapshotHash } from "@/lib/agent-runs/hash";
import {
  cancelAgentRun,
  createAgentRun,
  decideAgentRunApproval,
  getAgentRun,
  retryAgentRun,
  updateAgentRunDispatch,
} from "@/lib/agent-runs/service";
import { parseAgentApprovalDecision, parseAgentRunRequest } from "@/lib/agent-runs/validation";
import { prisma } from "@/lib/db";

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

integrationTest("agent runs are tenant-safe, bounded, replay-safe, and approval-bound", async () => {
  const id = suffix();
  const now = new Date("2026-08-21T12:00:00.000Z");
  // Entitlements use wall-clock time, independently of the injected workflow clock.
  const billingNow = Date.now();
  const workspace = await prisma.workspace.create({
    data: { name: "Agent runs", slug: `agent-runs-${id}`, timezone: "Europe/Madrid" },
  });
  const other = await prisma.workspace.create({
    data: { name: "Other agent runs", slug: `agent-runs-other-${id}` },
  });
  await prisma.subscription.create({
    data: {
      workspaceId: workspace.id,
      plan: "solo",
      status: "active",
      currentPeriodStart: new Date(billingNow - 24 * 60 * 60 * 1_000),
      currentPeriodEnd: new Date(billingNow + 30 * 24 * 60 * 60 * 1_000),
    },
  });
  const owner = await prisma.membership.create({
    data: { workspaceId: workspace.id, clerkUserId: `owner-${id}`, role: "owner" },
  });
  const brand = await prisma.brand.create({
    data: {
      workspaceId: workspace.id,
      name: "Marpin",
      timezone: "Europe/Madrid",
      isPrimary: true,
    },
  });
  const otherBrand = await prisma.brand.create({
    data: { workspaceId: other.id, name: "Other", isPrimary: true },
  });
  const conversation = await prisma.conversation.create({
    data: {
      workspaceId: workspace.id,
      brandId: brand.id,
      title: "Organic launch",
      createdBy: owner.clerkUserId,
    },
  });

  try {
    const request = parseAgentRunRequest({
      brandId: brand.id,
      conversationId: conversation.id,
      goal: "Prepare a practical organic plan for next week",
      mode: "organic",
      requestId: `create-run-${id}`,
    });
    await assert.rejects(() => createAgentRun({
      workspaceId: workspace.id,
      actorId: "member",
      actorRole: "member",
      request,
      now,
    }), WorkspaceAuthorizationError);
    await assert.rejects(() => createAgentRun({
      workspaceId: workspace.id,
      actorId: owner.clerkUserId,
      actorRole: "owner",
      request: parseAgentRunRequest({
        ...request,
        brandId: otherBrand.id,
        conversationId: null,
        requestId: `cross-tenant-${id}`,
      }),
      now,
    }), AgentRunNotFoundError);

    const [created, replay] = await Promise.all([
      createAgentRun({
        workspaceId: workspace.id,
        actorId: owner.clerkUserId,
        actorRole: "owner",
        request,
        now,
      }),
      createAgentRun({
        workspaceId: workspace.id,
        actorId: owner.clerkUserId,
        actorRole: "owner",
        request,
        now,
      }),
    ]);
    assert.equal(created.run.id, replay.run.id);
    assert.deepEqual(new Set([created.replayed, replay.replayed]), new Set([false, true]));
    assert.equal(await prisma.agentRun.count({ where: { workspaceId: workspace.id } }), 1);
    await assert.rejects(() => getAgentRun({
      workspaceId: other.id,
      runId: created.run.id,
    }), AgentRunNotFoundError);

    const executed = await executeAgentRun({
      workspaceId: workspace.id,
      runId: created.run.id,
      now,
    });
    assert.equal(executed.status, "succeeded");
    const executedReplay = await executeAgentRun({
      workspaceId: workspace.id,
      runId: created.run.id,
      now,
    });
    assert.equal(executedReplay.reason, "terminal");
    const finished = await getAgentRun({ workspaceId: workspace.id, runId: created.run.id });
    assert.equal(finished.status, "succeeded");
    assert.equal(finished.steps.length, 1);
    assert.equal(finished.steps[0].output?.objectType, "content_plan");
    assert.equal(await prisma.contentPlan.count({
      where: { workspaceId: workspace.id, brandId: brand.id },
    }), 1);
    assert.equal("providerPayload" in (finished.steps[0] as object), false);

    const inputRun = await createAgentRun({
      workspaceId: workspace.id,
      actorId: owner.clerkUserId,
      actorRole: "owner",
      request: parseAgentRunRequest({
        brandId: brand.id,
        conversationId: null,
        goal: "Prepare a paid campaign after I choose the draft",
        mode: "paid",
        requestId: `paid-run-${id}`,
      }),
      now,
    });
    assert.equal((await executeAgentRun({
      workspaceId: workspace.id,
      runId: inputRun.run.id,
      now,
    })).status, "waiting_input");
    const cancelled = await cancelAgentRun({
      workspaceId: workspace.id,
      runId: inputRun.run.id,
      actorId: owner.clerkUserId,
      actorRole: "owner",
      command: { requestId: `cancel-run-${id}` },
      now,
    });
    assert.equal(cancelled.run.status, "cancelled");
    const cancelledReplay = await cancelAgentRun({
      workspaceId: workspace.id,
      runId: inputRun.run.id,
      actorId: owner.clerkUserId,
      actorRole: "owner",
      command: { requestId: `cancel-run-${id}` },
      now,
    });
    assert.equal(cancelledReplay.replayed, true);

    const retryRun = await createAgentRun({
      workspaceId: workspace.id,
      actorId: owner.clerkUserId,
      actorRole: "owner",
      request: parseAgentRunRequest({
        brandId: brand.id,
        conversationId: null,
        goal: "Create another weekly organic plan",
        mode: "organic",
        requestId: `retry-run-${id}`,
      }),
      now,
    });
    await updateAgentRunDispatch({
      workspaceId: workspace.id,
      runId: retryRun.run.id,
      status: "unavailable",
      errorCode: "inngest_not_configured",
    });
    const retried = await retryAgentRun({
      workspaceId: workspace.id,
      runId: retryRun.run.id,
      actorId: owner.clerkUserId,
      actorRole: "owner",
      command: { requestId: `retry-command-${id}` },
      now,
    });
    assert.equal(retried.run.status, "queued");
    assert.equal(retried.run.dispatchStatus, "pending");

    const paidConnection = await prisma.connection.create({
      data: {
        workspaceId: workspace.id,
        platform: "google_ads",
        externalAccountId: `account-${id}`,
        displayName: "Marpin Ads",
        encAccessToken: "encrypted-test-token",
      },
    });
    const paidDraft = await prisma.paidCampaignDraft.create({
      data: {
        workspaceId: workspace.id,
        connectionId: paidConnection.id,
        platform: "google_ads",
        accountId: paidConnection.externalAccountId,
        accountName: "Marpin Ads",
        source: "manual",
        template: "google_search_rsa",
        state: "ready",
        snapshot: { schemaVersion: 1, safe: true },
        snapshotHash: agentSnapshotHash({ schemaVersion: 1, safe: true }),
        createdBy: owner.clerkUserId,
        updatedBy: owner.clerkUserId,
      },
    });
    const approvalRun = await createAgentRun({
      workspaceId: workspace.id,
      actorId: owner.clerkUserId,
      actorRole: "owner",
      request: parseAgentRunRequest({
        brandId: brand.id,
        conversationId: null,
        goal: "Wait for exact paid activation approval",
        mode: "paid",
        requestId: `approval-run-${id}`,
        target: {
          kind: "paid_create_paused",
          objectId: paidDraft.id,
        },
      }),
      now,
    });
    assert.equal((await executeAgentRun({
      workspaceId: workspace.id,
      runId: approvalRun.run.id,
      now,
    })).status, "waiting_approval");
    const pendingApproval = await getAgentRun({
      workspaceId: workspace.id,
      runId: approvalRun.run.id,
    });
    const step = pendingApproval.steps[0];
    const binding = step.approvalBinding;
    assert.ok(binding);
    assert.equal(binding.objectId, paidDraft.id);
    assert.equal(binding.objectVersion, paidDraft.version);
    assert.equal(binding.snapshotHash, paidDraft.snapshotHash);
    assert.equal(binding.accountId, paidDraft.accountId);
    const approvalBody = {
      requestId: `approval-command-${id}`,
      decision: "accepted" as const,
      stepId: step.id,
      kind: binding.kind,
      objectType: binding.objectType,
      objectId: binding.objectId,
      objectVersion: binding.objectVersion,
      snapshotHash: binding.snapshotHash,
      accountId: binding.accountId,
    };
    await assert.rejects(() => decideAgentRunApproval({
      workspaceId: workspace.id,
      runId: approvalRun.run.id,
      actorId: owner.clerkUserId,
      actorRole: "owner",
      decision: parseAgentApprovalDecision({
        ...approvalBody,
        requestId: `wrong-approval-${id}`,
        snapshotHash: "a".repeat(64),
      }),
      now,
    }), (error: unknown) => error instanceof AgentRunConflictError && error.code === "approval_wrong_snapshot");
    await prisma.paidCampaignDraft.update({
      where: { id: paidDraft.id },
      data: {
        version: { increment: 1 },
        snapshotHash: "b".repeat(64),
      },
    });
    await assert.rejects(() => decideAgentRunApproval({
      workspaceId: workspace.id,
      runId: approvalRun.run.id,
      actorId: owner.clerkUserId,
      actorRole: "owner",
      decision: parseAgentApprovalDecision({
        ...approvalBody,
        requestId: `stale-object-approval-${id}`,
      }),
      now,
    }), (error: unknown) => error instanceof AgentRunConflictError && error.code === "approval_stale");
    await prisma.paidCampaignDraft.update({
      where: { id: paidDraft.id },
      data: {
        version: paidDraft.version,
        snapshotHash: paidDraft.snapshotHash,
      },
    });
    const approved = await decideAgentRunApproval({
      workspaceId: workspace.id,
      runId: approvalRun.run.id,
      actorId: owner.clerkUserId,
      actorRole: "owner",
      decision: parseAgentApprovalDecision(approvalBody),
      now,
    });
    assert.equal(approved.run.status, "queued");
    assert.equal(approved.run.approvals[0].snapshotHash, binding.snapshotHash);
    const afterApproval = await executeAgentRun({
      workspaceId: workspace.id,
      runId: approvalRun.run.id,
      now: new Date(now.getTime() + 1_000),
    });
    assert.equal(afterApproval.status, "waiting_input");
    assert.equal(afterApproval.reason, "assisted_handoff_required");
    assert.equal((await prisma.paidCampaignDraft.findUniqueOrThrow({
      where: { id: paidDraft.id },
      select: { state: true },
    })).state, "ready");
    assert.equal(await prisma.paidCampaignOperationAttempt.count({
      where: { draftId: paidDraft.id },
    }), 0);

    const revokedRun = await createAgentRun({
      workspaceId: workspace.id,
      actorId: owner.clerkUserId,
      actorRole: "owner",
      request: parseAgentRunRequest({
        brandId: brand.id,
        conversationId: null,
        goal: "Create a plan only if my current role permits it",
        mode: "organic",
        requestId: `revoked-run-${id}`,
      }),
      now,
    });
    await prisma.membership.update({ where: { id: owner.id }, data: { role: "member" } });
    assert.equal((await executeAgentRun({
      workspaceId: workspace.id,
      runId: revokedRun.run.id,
      now,
    })).reason, "capability_denied");
    assert.equal((await getAgentRun({
      workspaceId: workspace.id,
      runId: revokedRun.run.id,
    })).status, "failed");

    await prisma.membership.update({ where: { id: owner.id }, data: { role: "owner" } });
    const expiredRun = await createAgentRun({
      workspaceId: workspace.id,
      actorId: owner.clerkUserId,
      actorRole: "owner",
      request: parseAgentRunRequest({
        brandId: brand.id,
        conversationId: null,
        goal: "This queued run must not remain stuck after its deadline",
        mode: "organic",
        requestId: `expired-run-${id}`,
      }),
      now,
    });
    const reconciliation = await reconcileExpiredAgentRuns(
      new Date(now.getTime() + 16 * 60 * 1_000),
    );
    assert.ok(reconciliation.reconciled >= 1);
    const expired = await getAgentRun({
      workspaceId: workspace.id,
      runId: expiredRun.run.id,
    });
    assert.equal(expired.status, "failed");
    assert.equal(expired.failure?.code, "deadline_exceeded");
  } finally {
    await prisma.workspace.deleteMany({ where: { id: { in: [workspace.id, other.id] } } });
  }
});
