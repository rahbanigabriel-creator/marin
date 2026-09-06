import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { prisma } from "@/lib/db";
import { PaidSyncInProgressError, syncPaidConnection } from "@/lib/connectors/paid-sync";
import type { PaidReadClient } from "@/lib/connectors/paid-clients";
import { command, history, listWorkspace, scheduleChecks, type PolicyCommand } from "../service";
import { executePaidAgentCheck, reconcilePaidChecks, type RunnerDependencies } from "../runner";
import { MAX_FACTS, PaidAgentError, parsePolicy } from "../policy";

function disposableDatabaseEnabled() {
  if (process.env.MARPIN_INTEGRATION_DATABASE !== "1") return false;
  const url = process.env.DATABASE_URL;
  if (!url || url !== (process.env.POSTGRES_TEST_URL ?? process.env.TEST_DATABASE_URL)) return false;
  try { const parsed = new URL(url); return ["localhost", "127.0.0.1"].includes(parsed.hostname) && /(?:_test|_ci)$/.test(parsed.pathname.slice(1)); } catch { return false; }
}
const integrationTest = disposableDatabaseEnabled() ? test : test.skip;
const code = (value: string) => (error: unknown) => error instanceof PaidAgentError && error.code === value;

async function fixture(platform: "google_ads" | "meta_ads" = "google_ads") {
  const id = randomUUID();
  const workspace = await prisma.workspace.create({ data: { name: "Paid goals test", slug: `paid-goals-${id}` } });
  const actorId = `paid-owner-${id}`;
  await prisma.membership.create({ data: { workspaceId: workspace.id, clerkUserId: actorId, role: "owner" } });
  await prisma.subscription.create({ data: { workspaceId: workspace.id, plan: "solo", status: "active", currentPeriodStart: new Date(Date.now() - 86400000), currentPeriodEnd: new Date(Date.now() + 30 * 86400000) } });
  const connection = await prisma.connection.create({ data: { workspaceId: workspace.id, platform, externalAccountId: `account-${id}`, displayName: "Paid account", currency: "EUR", timezone: "Europe/Madrid", encAccessToken: "test-ciphertext-never-sent", status: "connected" } });
  const identity = { workspaceId: workspace.id, actorId };
  let now = new Date();
  let syncs = 0;
  let afterSync: (() => Promise<void>) | undefined;
  const input = parsePolicy({ name: "Maintain ROAS", connectionId: connection.id, goal: "min_roas", threshold: 2, windowDays: 1, minSpend: 50, minConversions: 5, cadenceHours: 6 });
  const client: PaidReadClient = {
    platform: platform as "google_ads" | "meta_ads",
    async fetchMetricsSnapshot(_account, range) {
      return { complete: true, currency: "EUR", timezone: "Europe/Madrid", observedFrom: range.from, observedTo: range.to,
        items: [["spend", 100], ["conversions", 5], ["revenue", 150]].map(([metric, value]) => ({ date: range.from, platform, campaignExternalId: "campaign", metric: String(metric), value: Number(value) })) };
    },
    async fetchCampaignsSnapshot() { return { complete: true, currency: "EUR", timezone: "Europe/Madrid", observedFrom: null, observedTo: null, items: [] }; },
    async fetchAdsSnapshot() { return { complete: true, currency: "EUR", timezone: "Europe/Madrid", observedFrom: null, observedTo: null, items: [] }; },
  };
  const dependencies: RunnerDependencies = {
    clock: () => now, workerConfigured: () => true, verifyActor: async () => {},
    sync: async (args) => {
      syncs++;
      const outcome = await syncPaidConnection({ ...args, client });
      await afterSync?.();
      return { ...outcome, lastSyncedAt: now.toISOString() };
    },
  };
  const send = (value: PolicyCommand, requestId = randomUUID()) => command(identity, requestId, value, now);
  const create = () => send({ kind: "create", policy: input });
  const getPolicy = (policyId: string) => prisma.paidAgentPolicy.findUniqueOrThrow({ where: { id: policyId } });
  const queue = async (policyId: string) => send({ kind: "check", policyId, version: (await getPolicy(policyId)).version });
  const run = (checkId: string) => executePaidAgentCheck({ workspaceId: workspace.id, checkId }, dependencies);
  return { workspace, identity, connection, input, send, create, queue, run, getPolicy, client, dependencies,
    syncs: () => syncs, advance: (ms: number) => { now = new Date(now.getTime() + ms); }, now: () => now,
    afterSync: (fn: () => Promise<void>) => { afterSync = fn; },
    async cleanup() {
      await prisma.workspaceDeletionRequest.deleteMany({ where: { workspaceId: workspace.id } });
      await prisma.workspace.deleteMany({ where: { id: workspace.id } });
    },
  };
}

integrationTest("paid goals: duplicate commands, semantic duplicates, tenant and role isolation, no brand", async () => {
  const f = await fixture(); const other = await fixture("meta_ads");
  try {
    const requestId = randomUUID();
    const legacyOperations = ["content_plan_create", "content_post_create", "content_item_create", "content_variant_create", "publication_create", "conversation_create"];
    await prisma.manualCreationRequest.createMany({ data: legacyOperations.map((operation) => ({
      workspaceId: f.workspace.id, operation, requestId, requestHash: "a".repeat(64), responseBody: {}, statusCode: 201,
    })) });
    const [first, replay] = await Promise.all([f.send({ kind: "create", policy: f.input }, requestId), f.send({ kind: "create", policy: f.input }, requestId)]);
    assert.equal(first.policyId, replay.policyId);
    assert.equal(await prisma.manualCreationRequest.count({ where: { workspaceId: f.workspace.id, requestId } }), legacyOperations.length + 1);
    assert.equal(await prisma.brand.count({ where: { workspaceId: f.workspace.id } }), 0);
    await assert.rejects(() => f.create(), code("duplicate_goal"));
    await assert.rejects(() => f.send({ kind: "create", policy: { ...f.input, threshold: 3 } }, requestId), code("request_conflict"));
    await assert.rejects(() => f.send({ kind: "create", policy: { ...f.input, connectionId: other.connection.id } }), code("connection_unavailable"));
    await assert.rejects(() => history(other.identity, first.policyId), code("not_found"));
    await assert.rejects(() => other.send({ kind: "pause", policyId: first.policyId, version: 1 }), code("not_found"));
    await prisma.membership.update({ where: { workspaceId_clerkUserId: { workspaceId: f.workspace.id, clerkUserId: f.identity.actorId } }, data: { role: "member" } });
    await assert.rejects(() => f.send({ kind: "pause", policyId: first.policyId, version: 1 }), code("access_revoked"));
    assert.equal((await listWorkspace(f.identity)).canManage, false);
  } finally { await f.cleanup(); await other.cleanup(); }
});

integrationTest("paid goals: canonical fresh run, duplicate worker replay, durable recommendation and review", async () => {
  const f = await fixture();
  try {
    const { policyId } = await f.create();
    const [first, second] = await Promise.all([f.queue(policyId), f.queue(policyId)]);
    assert.equal(first.checkId, second.checkId);
    await Promise.all([f.run(first.checkId!), f.run(first.checkId!)]);
    assert.equal(f.syncs(), 1);
    let check = (await history(f.identity, policyId)).checks[0];
    assert.equal(check.status, "needs_review"); assert.equal(check.reviewStatus, "pending");
    assert.ok(check.syncAttemptId);
    assert.equal(await prisma.metricFact.count({ where: { workspaceId: f.workspace.id, lastSeenAttemptId: check.syncAttemptId } }), 3);
    assert.equal(await prisma.action.count({ where: { workspaceId: f.workspace.id } }), 0);
    const review = { kind: "review" as const, policyId, version: 1, checkId: check.id, decision: "acknowledged" as const };
    const requestId = randomUUID();
    await f.send(review, requestId); await f.send(review, requestId);
    check = (await history(f.identity, policyId)).checks[0];
    assert.equal(check.reviewStatus, "acknowledged");
    await assert.rejects(() => f.queue(policyId), code("check_cooldown"));
    await f.run(first.checkId!); assert.equal(f.syncs(), 1);
  } finally { await f.cleanup(); }
});

integrationTest("paid goals: pause cancels queued and in-flight work; edits invalidate recommendation versions", async () => {
  const f = await fixture("meta_ads");
  try {
    const { policyId } = await f.create(); const first = await f.queue(policyId);
    await f.send({ kind: "pause", policyId, version: 1 });
    await f.run(first.checkId!); assert.equal(f.syncs(), 0);
    assert.equal((await history(f.identity, policyId)).checks[0].status, "cancelled");
    await assert.rejects(() => f.send({ kind: "check", policyId, version: 2 }), code("paused"));
    await f.send({ kind: "resume", policyId, version: 2 }); f.advance(3600001);
    const second = await f.queue(policyId);
    f.afterSync(async () => { await f.send({ kind: "pause", policyId, version: 3 }); });
    await f.run(second.checkId!);
    assert.equal((await prisma.paidAgentCheck.findUniqueOrThrow({ where: { id: second.checkId } })).status, "cancelled");
    f.afterSync(async () => {});
    await f.send({ kind: "resume", policyId, version: 4 }); f.advance(3600001);
    const third = await f.queue(policyId); await f.run(third.checkId!);
    await f.send({ kind: "edit", policyId, version: 5, policy: { ...f.input, threshold: 3 } });
    assert.equal((await prisma.paidAgentCheck.findUniqueOrThrow({ where: { id: third.checkId } })).reviewStatus, "invalidated");
    await assert.rejects(() => f.send({ kind: "review", policyId, version: 6, checkId: third.checkId!, decision: "acknowledged" }), code("review_invalidated"));
  } finally { await f.cleanup(); }
});

for (const change of ["connection", "role", "entitlement", "deletion"] as const) {
  integrationTest(`paid goals: ${change} revocation before and after sync blocks evaluation`, async () => {
    for (const during of [false, true]) {
      const f = await fixture();
      try {
        const { policyId } = await f.create(); const queued = await f.queue(policyId);
        const revoke = async () => {
          if (change === "connection") await prisma.connection.update({ where: { id: f.connection.id }, data: { status: "revoked" } });
          if (change === "role") await prisma.membership.delete({ where: { workspaceId_clerkUserId: { workspaceId: f.workspace.id, clerkUserId: f.identity.actorId } } });
          if (change === "entitlement") await prisma.subscription.update({ where: { workspaceId: f.workspace.id }, data: { status: "canceled" } });
          if (change === "deletion") await prisma.workspaceDeletionRequest.create({ data: { workspaceId: f.workspace.id, workspaceSlug: f.workspace.slug, requestedBy: f.identity.actorId, requestId: randomUUID(), requestHash: "a".repeat(64) } });
        };
        if (during) f.afterSync(revoke); else await revoke();
        await f.run(queued.checkId!);
        assert.equal(f.syncs(), during ? 1 : 0);
        const check = await prisma.paidAgentCheck.findUniqueOrThrow({ where: { id: queued.checkId } });
        assert.equal(check.status, "blocked"); assert.equal(check.reviewStatus, "none");
        assert.equal((await f.getPolicy(policyId)).status, "paused");
        if (change === "entitlement" && !during) await f.send({ kind: "pause", policyId, version: 2 });
      } finally { await f.cleanup(); }
    }
  });
}

integrationTest("paid goals: stale/missing evidence never reuses saved results; deadline and unavailable worker fail closed", async () => {
  const f = await fixture();
  try {
    const { policyId } = await f.create(); const queued = await f.queue(policyId);
    assert.deepEqual(await executePaidAgentCheck({ workspaceId: f.workspace.id, checkId: queued.checkId! }, { ...f.dependencies, workerConfigured: () => false }), { ran: false, reason: "worker_unavailable" });
    assert.equal(f.syncs(), 0);
    const original = f.client.fetchMetricsSnapshot;
    f.client.fetchMetricsSnapshot = async (...args) => ({ ...await original(...args), items: [], observedFrom: null, observedTo: null });
    await f.run(queued.checkId!);
    assert.equal((await history(f.identity, policyId)).checks[0].status, "blocked");
    f.client.fetchMetricsSnapshot = original;
    f.advance(3600001); const next = await f.queue(policyId);
    f.advance(16 * 60000); await f.run(next.checkId!);
    assert.equal(f.syncs(), 1);
    assert.match((await prisma.paidAgentCheck.findUniqueOrThrow({ where: { id: next.checkId } })).reason, /deadline/);
  } finally { await f.cleanup(); }
});

integrationTest("paid goals: bounded scheduler deduplicates due checks and recovers expired leases", async () => {
  const f = await fixture();
  try {
    const { policyId } = await f.create();
    await Promise.all([scheduleChecks(f.now()), scheduleChecks(f.now())]);
    assert.equal(await prisma.paidAgentCheck.count({ where: { policyId } }), 1);
    const due = await f.getPolicy(policyId);
    assert.equal(due.nextCheckAt!.getTime(), f.now().getTime() + 6 * 3600000);
    f.advance(16 * 60000); await reconcilePaidChecks(f.now());
    assert.equal((await history(f.identity, policyId)).checks[0].status, "blocked");
    await f.send({ kind: "pause", policyId, version: 1 });
    f.advance(24 * 3600000); await scheduleChecks(f.now());
    assert.equal(await prisma.paidAgentCheck.count({ where: { policyId } }), 1);
  } finally { await f.cleanup(); }
});

integrationTest("paid goals: sync contention defers the same check with a bounded retry and no terminal conclusion", async () => {
  const f = await fixture();
  try {
    const { policyId } = await f.create(); const queued = await f.queue(policyId);
    const result = await executePaidAgentCheck({ workspaceId: f.workspace.id, checkId: queued.checkId! }, { ...f.dependencies, sync: async () => { throw new PaidSyncInProgressError(); } });
    assert.equal(result.status, "deferred");
    const check = await prisma.paidAgentCheck.findUniqueOrThrow({ where: { id: queued.checkId } });
    assert.equal(check.status, "queued"); assert.equal(check.completedAt, null); assert.equal(check.reviewStatus, "none");
    assert.equal(check.dueAt.getTime(), f.now().getTime() + 5 * 60000);
    assert.equal((await f.getPolicy(policyId)).status, "active");
    await f.run(check.id); assert.equal(f.syncs(), 0);
    f.advance(5 * 60000); await f.run(check.id);
    assert.equal(f.syncs(), 1); assert.equal((await prisma.paidAgentCheck.findUniqueOrThrow({ where: { id: check.id } })).status, "needs_review");
    assert.equal(await prisma.paidAgentCheck.count({ where: { policyId } }), 1);
  } finally { await f.cleanup(); }
});

integrationTest("paid goals: authoritative Clerk revocation blocks stale stored owners before and after reads", async () => {
  for (const revokedOnCall of [1, 2]) {
    const f = await fixture();
    try {
      const { policyId } = await f.create(); const queued = await f.queue(policyId); let calls = 0;
      await executePaidAgentCheck({ workspaceId: f.workspace.id, checkId: queued.checkId! }, { ...f.dependencies, verifyActor: async () => {
        if (++calls === revokedOnCall) throw new PaidAgentError("authority_revoked", "Clerk role revoked");
      } });
      assert.equal(f.syncs(), revokedOnCall === 1 ? 0 : 1);
      assert.equal((await f.getPolicy(policyId)).status, "paused");
      const check = await prisma.paidAgentCheck.findUniqueOrThrow({ where: { id: queued.checkId } });
      assert.equal(check.status, "blocked"); assert.equal(check.reviewStatus, "none");
      assert.equal((await prisma.membership.findFirstOrThrow({ where: { workspaceId: f.workspace.id } })).role, "owner");
    } finally { await f.cleanup(); }
  }
});

integrationTest("paid goals: already-queued goals share only an exact fresh refresh, not pre-existing saved metrics", async () => {
  const f = await fixture();
  try {
    const first = await f.create();
    const second = await f.send({ kind: "create", policy: { ...f.input, goal: "max_cpa", threshold: 10 } });
    const firstCheck = await f.queue(first.policyId); const secondCheck = await f.queue(second.policyId);
    // Let the injected clock cover the real canonical attempt's completion.
    f.advance(60_000);
    await f.run(firstCheck.checkId!); await f.run(secondCheck.checkId!);
    assert.equal(f.syncs(), 1);
    const a = await prisma.paidAgentCheck.findUniqueOrThrow({ where: { id: firstCheck.checkId } });
    const b = await prisma.paidAgentCheck.findUniqueOrThrow({ where: { id: secondCheck.checkId } });
    assert.equal(a.syncAttemptId, b.syncAttemptId); assert.equal(b.status, "needs_review");
    const third = await f.send({ kind: "create", policy: { ...f.input, goal: "max_spend", threshold: 90 } });
    const thirdCheck = await f.queue(third.policyId); await f.run(thirdCheck.checkId!);
    assert.equal(f.syncs(), 2);
  } finally { await f.cleanup(); }
});

integrationTest("paid goals: limits and cancellation enter canonical sync before metric ingestion", async () => {
  const f = await fixture();
  try {
    const { policyId } = await f.create(); const queued = await f.queue(policyId);
    const original = f.client.fetchMetricsSnapshot;
    f.client.fetchMetricsSnapshot = async (...args) => {
      const snapshot = await original(...args);
      return { ...snapshot, items: Array.from({ length: MAX_FACTS + 1 }, (_, index) => ({ ...snapshot.items[0], campaignExternalId: `campaign-${index}` })) };
    };
    f.client.fetchCampaignsSnapshot = async () => { throw new Error("Goal must be metrics-only"); };
    f.client.fetchAdsSnapshot = async () => { throw new Error("Goal must be metrics-only"); };
    await executePaidAgentCheck({ workspaceId: f.workspace.id, checkId: queued.checkId! }, { ...f.dependencies, sync: async (args) => {
      assert.equal(args.metricsOnly, true); assert.equal(args.limits?.maxRows, MAX_FACTS); assert.equal(args.limits?.maxRequests, 12);
      assert.ok(args.guard); assert.ok(args.signal);
      return f.dependencies.sync!(args);
    } });
    const check = await prisma.paidAgentCheck.findUniqueOrThrow({ where: { id: queued.checkId } });
    assert.equal(check.status, "blocked"); assert.match(check.reason, /limit/);
    assert.equal(await prisma.metricFact.count({ where: { workspaceId: f.workspace.id } }), 0);
    assert.equal((await prisma.connection.findUniqueOrThrow({ where: { id: f.connection.id } })).status, "connected");
  } finally { await f.cleanup(); }
});
