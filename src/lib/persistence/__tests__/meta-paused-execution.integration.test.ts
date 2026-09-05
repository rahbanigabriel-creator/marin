import assert from "node:assert/strict";
import test from "node:test";
import { prisma } from "@/lib/db";
import { metaPausedFixture } from "@/lib/paid-drafts/__fixtures__/meta-paused";
import { hashPaidCampaignSnapshotV1 } from "@/lib/paid-drafts/hash";
import { executePaidCampaignDraftOperation, getPaidCampaignDraft, verifySnapshotAssets } from "@/lib/paid-drafts/service";
import { MetaPausedProviderError, runMetaPausedCreation, type MetaPausedStep } from "@/lib/paid-drafts/meta-paused-provider";
import { assetBlobPath } from "@/lib/storage/asset-path";

function disposable() {
  if (process.env.MARPIN_INTEGRATION_DATABASE !== "1" || !process.env.DATABASE_URL || process.env.DATABASE_URL !== (process.env.POSTGRES_TEST_URL ?? process.env.TEST_DATABASE_URL)) return false;
  const url = new URL(process.env.DATABASE_URL);
  return ["localhost", "127.0.0.1"].includes(url.hostname) && /(_test|_ci)$/.test(url.pathname);
}
const integrationTest = disposable() ? test : test.skip;
const steps: MetaPausedStep[] = [
  { key: "campaign", kind: "campaign", status: "created", id: "10001" },
  { key: "adset", kind: "adset", status: "created", id: "10002" },
  { key: "image:asset_1", kind: "image", status: "created", id: "a".repeat(32) },
  { key: "creative:ad_1", kind: "creative", status: "created", id: "10003" },
  { key: "ad:ad_1", kind: "ad", status: "created", id: "10004" },
];

async function seed() {
  const workspace = await prisma.workspace.create({ data: { name: "Meta execution test", slug: `meta-test-${crypto.randomUUID()}` } });
  await prisma.subscription.create({ data: { workspaceId: workspace.id, plan: "solo", status: "trialing", currentPeriodStart: new Date(Date.now() - 86_400_000), currentPeriodEnd: new Date(Date.now() + 86_400_000) } });
  const connection = await prisma.connection.create({ data: { workspaceId: workspace.id, platform: "meta_ads", externalAccountId: "123456789", encAccessToken: "not-a-real-token", currency: "EUR", timezone: "UTC" } });
  const assetId = crypto.randomUUID();
  const asset = await prisma.asset.create({ data: { id: assetId, workspaceId: workspace.id, kind: "image", mimeType: "image/png", bytes: 8, storageKey: assetBlobPath(workspace.id, assetId, "test.png") } });
  const snapshot = metaPausedFixture(connection.id, connection.externalAccountId, asset.id);
  const hash = hashPaidCampaignSnapshotV1(snapshot);
  const draft = await prisma.paidCampaignDraft.create({ data: { workspaceId: workspace.id, connectionId: connection.id, platform: "meta_ads", accountId: connection.externalAccountId, accountName: "Test account", source: "manual", template: "meta_traffic", state: "ready", snapshot: JSON.parse(JSON.stringify(snapshot)), snapshotHash: hash, version: 2, createdBy: "owner", updatedBy: "owner" } });
  const approval = await prisma.paidCampaignApproval.create({ data: { workspaceId: workspace.id, draftId: draft.id, requestId: crypto.randomUUID(), requestHash: "a".repeat(64), kind: "create_paused", platform: "meta_ads", connectionId: connection.id, accountId: connection.externalAccountId, snapshotVersion: 2, snapshotHash: hash, approvedBy: "owner" } });
  const input = { workspaceId: workspace.id, draftId: draft.id, actorId: "owner", actorRole: "owner" as const, body: { requestId: crypto.randomUUID(), operation: "create_paused" as const, approvalId: approval.id, expectedVersion: 2, snapshotHash: hash } };
  return { workspace, connection, asset, snapshot, draft, approval, input, steps: steps.map((step) => step.kind === "image" ? { ...step, key: `image:${asset.id}` } : step) };
}

integrationTest("Meta paused execution claims one exact approval, persists every step and replays without writes", async () => {
  const { workspace, input, steps } = await seed();
  let writes = 0;
  const dependencies = { prepareMeta: async () => ({ run: async (checkpoint: (steps: MetaPausedStep[]) => Promise<void>) => {
    writes += 1;
    for (let index = 0; index < steps.length; index += 1) {
      await checkpoint([...steps.slice(0, index), { ...steps[index], id: undefined, status: "submitting" }]);
      const recorded = await prisma.paidCampaignOperationAttempt.findFirstOrThrow({ where: { draftId: input.draftId } });
      assert.equal(recorded.status, "running");
      await checkpoint(steps.slice(0, index + 1));
    }
    return { campaignId: "10001", steps };
  } }) };
  try {
    const settled = await Promise.allSettled([executePaidCampaignDraftOperation(input, dependencies), executePaidCampaignDraftOperation(input, dependencies), executePaidCampaignDraftOperation({ ...input, body: { ...input.body, requestId: crypto.randomUUID() } }, dependencies)]);
    assert.ok(settled.some((result) => result.status === "fulfilled"));
    assert.equal(writes, 1);
    assert.equal(await prisma.paidCampaignOperationAttempt.count({ where: { draftId: input.draftId } }), 1);
    const result = await executePaidCampaignDraftOperation(input, dependencies);
    assert.equal(result.replayed, true);
    assert.equal(result.draft.state, "provider_paused");
    assert.equal(result.draft.version, 4);
    assert.equal(result.draft.providerPausedConfirmation?.verificationStatus, "provider_verified");
    assert.equal(result.attempt.status, "succeeded");
    assert.equal(writes, 1);
    assert.equal(result.draft.capabilities.execution.activation.canExecuteProvider, false);
  } finally { await prisma.workspace.delete({ where: { id: workspace.id } }); }
});

integrationTest("uncertain Meta creation retains IDs, freezes editing and never blindly retries", async () => {
  const { workspace, input, steps } = await seed();
  let writes = 0;
  const dependencies = { prepareMeta: async () => ({ run: async (checkpoint: (steps: MetaPausedStep[]) => Promise<void>): Promise<{ campaignId: string; steps: MetaPausedStep[] }> => {
    writes += 1;
    await checkpoint([steps[0], { key: "adset", kind: "adset", status: "submitting" }]);
    throw new Error("sensitive-provider-error-not-for-client");
  } }) };
  try {
    const result = await executePaidCampaignDraftOperation(input, dependencies);
    assert.equal(result.draft.state, "needs_reconciliation");
    assert.equal(result.draft.capabilities.canEdit, false);
    assert.equal(result.attempt.status, "needs_reconciliation");
    assert.ok(!JSON.stringify(result).includes("sensitive-provider"));
    assert.match(JSON.stringify(result), /10001/);
    await executePaidCampaignDraftOperation(input, dependencies);
    await assert.rejects(executePaidCampaignDraftOperation({ ...input, body: { ...input.body, requestId: crypto.randomUUID() } }, dependencies));
    assert.equal(writes, 1);
    assert.equal((await getPaidCampaignDraft(input)).state, "needs_reconciliation");
  } finally { await prisma.workspace.delete({ where: { id: workspace.id } }); }
});

integrationTest("tenant, role, stale or missing approval failures happen before Meta preparation", async () => {
  const { workspace, input } = await seed();
  let prepares = 0;
  const dependencies = { prepareMeta: async () => { prepares += 1; throw new Error("must not run"); } };
  try {
    await assert.rejects(executePaidCampaignDraftOperation({ ...input, actorRole: "member" }, dependencies));
    await assert.rejects(executePaidCampaignDraftOperation({ ...input, workspaceId: "another_workspace" }, dependencies));
    await assert.rejects(executePaidCampaignDraftOperation({ ...input, body: { ...input.body, approvalId: "missing" } }, dependencies));
    await assert.rejects(executePaidCampaignDraftOperation({ ...input, body: { ...input.body, snapshotHash: "b".repeat(64) } }, dependencies));
    assert.equal(prepares, 0);
    assert.equal(await prisma.paidCampaignOperationAttempt.count({ where: { draftId: input.draftId } }), 0);
  } finally { await prisma.workspace.delete({ where: { id: workspace.id } }); }
});

integrationTest("asset deletion and connection revocation during preflight prevent the provider claim", async () => {
  for (const change of ["asset", "connection", "token", "billing"]) {
    const { workspace, input, draft } = await seed();
    let writes = 0;
    try {
      await assert.rejects(executePaidCampaignDraftOperation(input, { prepareMeta: async () => {
        if (change === "asset") await prisma.asset.deleteMany({ where: { workspaceId: workspace.id } });
        else if (change === "connection") await prisma.connection.update({ where: { id: draft.connectionId! }, data: { status: "revoked" } });
        else if (change === "token") await prisma.connection.update({ where: { id: draft.connectionId! }, data: { encAccessToken: "replacement-token" } });
        else await prisma.subscription.update({ where: { workspaceId: workspace.id }, data: { status: "canceled" } });
        return { run: async () => { writes += 1; return { campaignId: "10001", steps }; } };
      } }));
      assert.equal(writes, 0);
      assert.equal(await prisma.paidCampaignOperationAttempt.count({ where: { draftId: draft.id } }), 0);
      assert.equal((await getPaidCampaignDraft(input)).state, "ready");
    } finally { await prisma.workspace.delete({ where: { id: workspace.id } }); }
  }
});

integrationTest("free or expired workspaces cannot prepare real Meta writes", async () => {
  const { workspace, input } = await seed();
  let prepares = 0;
  try {
    const dependencies = { prepareMeta: async () => { prepares++; throw new Error("must not prepare"); } };
    for (const data of [{ plan: "free" }, { plan: "solo", currentPeriodEnd: new Date(Date.now() - 1) }]) {
      await prisma.subscription.update({ where: { workspaceId: workspace.id }, data });
      await assert.rejects(executePaidCampaignDraftOperation(input, dependencies), { code: "actions_not_in_plan" });
    }
    assert.equal(prepares, 0);
    assert.equal(await prisma.paidCampaignOperationAttempt.count({ where: { draftId: input.draftId } }), 0);
  } finally { await prisma.workspace.delete({ where: { id: workspace.id } }); }
});

integrationTest("unfinished or deleting image uploads cannot enter an approved Meta snapshot", async () => {
  const { workspace, asset, snapshot } = await seed();
  try {
    for (const storageKey of ["marpin:storage-reservation:pending", "marpin:storage-delete:pending", "ws/another-workspace/file.png"]) {
      await prisma.asset.update({ where: { id: asset.id }, data: { storageKey } });
      await assert.rejects(verifySnapshotAssets(prisma, workspace.id, snapshot));
    }
  } finally { await prisma.workspace.delete({ where: { id: workspace.id } }); }
});

integrationTest("proven pre-write failure consumes approval but safely reopens the draft", async () => {
  const { workspace, input } = await seed();
  try {
    const result = await executePaidCampaignDraftOperation(input, { prepareMeta: async () => ({ run: async () => { throw new MetaPausedProviderError("meta_paused_request_failed", false); } }) });
    assert.equal(result.draft.state, "draft");
    assert.equal(result.draft.version, 4);
    assert.equal(result.draft.capabilities.canEdit, true);
    assert.equal(result.attempt.status, "failed");
    assert.equal(result.attempt.providerOutcome?.providerSideEffect, "none");
    assert.equal(result.draft.approvals[0].status, "consumed");
    assert.equal((await executePaidCampaignDraftOperation(input)).replayed, true);
  } finally { await prisma.workspace.delete({ where: { id: workspace.id } }); }
});

integrationTest("a checkpoint failure after Meta returns an ID keeps that ID without a repeated POST", async () => {
  const { workspace, input, snapshot, asset } = await seed();
  let posts = 0;
  try {
    const result = await executePaidCampaignDraftOperation(input, { prepareMeta: async () => ({ run: async (checkpoint) => runMetaPausedCreation({
      snapshot, accessToken: "fixture-only", appSecretProof: null,
      images: new Map([[asset.id, Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])]]),
      fetchImpl: async (_url, init) => {
        if (init?.method === "POST") { posts++; return Response.json({ id: "10001" }); }
        return Response.json({ id: "act_123456789", account_id: "123456789", currency: "EUR" });
      },
      checkpoint: async (steps) => {
        if (steps.at(-1)?.status === "created") throw new Error("database-checkpoint-unavailable");
        await checkpoint(steps);
      },
    }) }) });
    assert.equal(posts, 1);
    assert.equal(result.draft.state, "needs_reconciliation");
    assert.match(JSON.stringify(result.attempt.providerOutcome), /10001/);
    assert.ok(!JSON.stringify(result).includes("database-checkpoint-unavailable"));
    await executePaidCampaignDraftOperation(input);
    assert.equal(posts, 1);
  } finally { await prisma.workspace.delete({ where: { id: workspace.id } }); }
});

integrationTest("credential rotation after the first object stops subsequent Meta writes and retains it", async () => {
  const { workspace, input, snapshot, asset, connection } = await seed();
  let posts = 0;
  try {
    const result = await executePaidCampaignDraftOperation(input, { prepareMeta: async () => ({ run: async (checkpoint) => runMetaPausedCreation({
      snapshot, accessToken: "fixture-only", appSecretProof: null,
      images: new Map([[asset.id, Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])]]),
      fetchImpl: async (_url, init) => {
        if (init?.method === "POST") {
          posts++;
          await prisma.connection.update({ where: { id: connection.id }, data: { encAccessToken: "rotated" } });
          return Response.json({ id: "10001" });
        }
        return Response.json({ id: "act_123456789", account_id: "123456789", currency: "EUR" });
      }, checkpoint,
    }) }) });
    assert.equal(posts, 1);
    assert.equal(result.draft.state, "needs_reconciliation");
    assert.match(JSON.stringify(result.attempt.providerOutcome), /10001/);
  } finally { await prisma.workspace.delete({ where: { id: workspace.id } }); }
});
