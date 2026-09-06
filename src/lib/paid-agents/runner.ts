import type { PaidAgentCheck, PaidAgentPolicy } from "@prisma/client";
import { prisma, isDatabaseConfigured } from "@/lib/db";
import { agentSnapshotHash } from "@/lib/agent-runs/hash";
import { syncPaidConnection, PaidSyncInProgressError, PaidSyncStoppedError, type PaidAccountSyncOutcome } from "@/lib/connectors/paid-sync";
import { BATCH_SIZE, MAX_FACTS, PAID_AGENT_EVENT, PaidAgentError, completedWindow, parsePolicy } from "./policy";
import { blocked, evaluatePaidGoal, type Evaluation } from "./evaluate";
import { access, boundConnection, findPolicy, invalidateChecks, jsonValue, lockWorkspace, policySnapshot, scheduleChecks, type Db } from "./service";
import { verifyCurrentActor, type VerifyActor } from "./authority";
import { connectionGeneration, reusableFreshSync } from "./shared-sync";

type RunIdentity = { workspaceId: string; checkId: string };

async function preflight(db: Db, policy: PaidAgentPolicy, check: PaidAgentCheck, now: Date) {
  if (policy.status !== "active" || policy.version !== check.policyVersion ||
    agentSnapshotHash(policySnapshot(policy)) !== agentSnapshotHash(check.snapshot)) throw new PaidAgentError("policy_changed", "The goal was paused or changed; this check was cancelled.");
  if (check.deadlineAt <= now) throw new PaidAgentError("deadline_exceeded", "The bounded check deadline expired. No recommendation was made.");
  await access(db, { workspaceId: policy.workspaceId, actorId: policy.createdBy }, true);
  const connection = await boundConnection(db, policy);
  if (connection.currency !== policy.currency || connection.timezone !== policy.timezone) throw new PaidAgentError("binding_changed", "Account settings changed. Edit and save the goal before checking again.");
  return connection;
}

function errorResult(error: unknown): Evaluation {
  if (error instanceof PaidSyncStoppedError) return blocked(error.code, error.code === "sync_limit_exceeded"
    ? "The bounded reporting limit was exceeded before ingestion. No recommendation was made."
    : "The account connection changed or the sync was cancelled. No recommendation was made.");
  return error instanceof PaidAgentError ? blocked(error.code, error.message)
    : blocked("sync_failed", "The fresh account sync could not be completed. Saved metrics were not used and no campaign changes were made.");
}

async function finish(db: Db, policy: PaidAgentPolicy, check: PaidAgentCheck, result: Evaluation, now: Date, evidence?: { syncAttemptId: string; range: { from: Date; to: Date }; syncedAt: string; connectionGeneration: string | null; sharedRefresh: boolean }) {
  await db.paidAgentCheck.update({ where: { id: check.id }, data: {
    status: result.status, reason: result.reason, completedAt: now,
    result: jsonValue({ ...result, ...(evidence ?? {}), policyVersion: check.policyVersion, threshold: policy.threshold, currency: policy.currency }),
    syncAttemptId: evidence?.syncAttemptId,
    reviewStatus: result.status === "needs_review" ? "pending" : "none",
    reviewExpiresAt: result.status === "needs_review" ? new Date(now.getTime() + Math.min(policy.cadenceHours, 24) * 3_600_000) : null,
  } });
  if (["access_revoked", "authority_revoked", "authority_unavailable", "upgrade_required", "connection_unavailable", "connection_changed", "binding_changed", "account_metadata_changed"].includes(result.code)) {
    await db.paidAgentPolicy.update({ where: { id: policy.id }, data: { status: "paused", nextCheckAt: null, version: { increment: 1 } } });
    await invalidateChecks(db, policy.id, "Cancelled because account or workspace access changed.", now);
  }
}

async function deferCheck(db: Db, check: PaidAgentCheck, now: Date) {
  await db.paidAgentCheck.update({ where: { id: check.id }, data: {
    status: "queued", startedAt: null, dueAt: new Date(now.getTime() + 5 * 60_000),
    reason: "Deferred while this account is syncing. A bounded retry is planned; no performance conclusion was made.",
  } });
}

export interface RunnerDependencies {
  sync?: typeof syncPaidConnection;
  clock?: () => Date;
  workerConfigured?: () => boolean;
  verifyActor?: VerifyActor;
}

export async function executePaidAgentCheck(identity: RunIdentity, dependencies: RunnerDependencies = {}) {
  if (!isDatabaseConfigured()) return { ran: false, reason: "database_unavailable" };
  const { isAgentRunDispatchConfigured } = await import("@/lib/jobs/inngest");
  if (!(dependencies.workerConfigured ?? isAgentRunDispatchConfigured)()) return { ran: false, reason: "worker_unavailable" };
  const clock = dependencies.clock ?? (() => new Date());
  const claimed = await prisma.$transaction(async (db) => {
    await lockWorkspace(db, identity.workspaceId);
    const check = await db.paidAgentCheck.findFirst({ where: { id: identity.checkId, workspaceId: identity.workspaceId } });
    if (!check || check.status !== "queued" || check.dueAt > clock()) return null;
    const policy = await findPolicy(db, identity.workspaceId, check.policyId);
    const now = clock();
    try {
      const connection = await preflight(db, policy, check, now);
      const other = await db.paidAgentCheck.findFirst({ where: { workspaceId: identity.workspaceId, status: "running", policy: { connectionId: policy.connectionId } } });
      if (other) { await deferCheck(db, check, now); return null; }
      await db.paidAgentCheck.update({ where: { id: check.id }, data: { status: "running", startedAt: now, reason: "Refreshing canonical account evidence before evaluation." } });
      await db.paidAgentPolicy.update({ where: { id: policy.id }, data: { lastCheckAt: now } });
      return { policy, check: { ...check, startedAt: now }, connection };
    } catch (error) {
      await finish(db, policy, check, errorResult(error), now);
      return null;
    }
  }).catch((error: unknown) => { if (error instanceof PaidAgentError && error.status === 404) return null; throw error; });
  if (!claimed) return { ran: false, reason: "not_queued_or_blocked" };
  const { policy, check, connection } = claimed;
  const range = completedWindow(check.startedAt, policy.timezone, policy.windowDays);
  let result: Evaluation;
  let sync: PaidAccountSyncOutcome | undefined;
  let generation: string | null = null;
  let sharedRefresh = false;
  let contention = false;
  let stopped: PaidAgentError | null = null;

  const verifyActor = async () => {
    const workspace = await prisma.workspace.findUnique({ where: { id: policy.workspaceId }, select: { slug: true } });
    if (!workspace) throw new PaidAgentError("access_revoked", "The workspace no longer exists.");
    await (dependencies.verifyActor ?? verifyCurrentActor)({ actorId: policy.createdBy, workspaceSlug: workspace.slug });
  };

  const guard = async (db: Db = prisma) => {
    const currentCheck = await db.paidAgentCheck.findFirst({ where: { id: check.id, workspaceId: identity.workspaceId } });
    if (!currentCheck || currentCheck.status !== "running") throw new PaidAgentError("cancelled", "This check was cancelled.");
    const current = await findPolicy(db, identity.workspaceId, policy.id);
    return preflight(db, current, currentCheck, clock());
  };
  // The canonical sync owns cancellation, bounded reads, credential generation
  // fencing, token refresh and the pre-ingestion row limit as one operation.
  const deadline = AbortSignal.timeout(90_000);
  try {
    await guard();
    await verifyActor();
    sync = await reusableFreshSync({ policy, check, connection: await guard(), range, now: clock() }) ?? undefined;
    sharedRefresh = Boolean(sync);
    sync ??= await (dependencies.sync ?? syncPaidConnection)({ connection, range, trigger: "paid_agent",
      metricsOnly: true, signal: deadline,
      limits: { maxRows: MAX_FACTS, maxRequests: 12, maxResponseBytes: 2 * 1024 * 1024, maxTotalResponseBytes: 8 * 1024 * 1024 },
      guard: async (db) => {
        try { await guard(db); }
        catch (error) { if (error instanceof PaidAgentError) stopped = error; throw error; }
      },
    });
    generation = connectionGeneration(await guard());
    await verifyActor();
    await guard();
    if (stopped) throw stopped;
    const facts = await prisma.metricFact.findMany({ where: {
      workspaceId: policy.workspaceId, connectionId: policy.connectionId, platform: policy.platform,
      lastSeenAttemptId: sync.attemptId, staleAt: null, date: { gte: range.from, lte: range.to },
    }, take: MAX_FACTS + 1 });
    result = facts.length !== sync.phases.metrics.rows
      ? blocked("evidence_changed", "The fresh sync evidence is incomplete or has been replaced. Run a later check.")
      : evaluatePaidGoal({ policy: { ...parsePolicy({ name: policy.name, connectionId: policy.connectionId, goal: policy.goal, threshold: policy.threshold, windowDays: policy.windowDays, minSpend: policy.minSpend, minConversions: policy.minConversions, cadenceHours: policy.cadenceHours }), workspaceId: policy.workspaceId, platform: policy.platform, accountId: policy.accountId, currency: policy.currency, timezone: policy.timezone }, range, sync, facts, startedAt: sharedRefresh ? check.createdAt : check.startedAt, now: clock() });
  } catch (error) {
    contention = error instanceof PaidSyncInProgressError;
    result = errorResult(stopped ?? error);
  }
  await prisma.$transaction(async (db) => {
    await lockWorkspace(db, identity.workspaceId);
    const currentCheck = await db.paidAgentCheck.findFirst({ where: { id: check.id, workspaceId: identity.workspaceId, status: "running" } });
    if (!currentCheck) return;
    const currentPolicy = await findPolicy(db, identity.workspaceId, policy.id);
    try { await preflight(db, currentPolicy, currentCheck, clock()); }
    catch (error) { contention = false; result = errorResult(error); }
    if (contention) { await deferCheck(db, currentCheck, clock()); return; }
    await finish(db, currentPolicy, currentCheck, result, clock(), sync ? { syncAttemptId: sync.attemptId, range, syncedAt: sync.lastSyncedAt, connectionGeneration: generation, sharedRefresh } : undefined);
  }).catch((error: unknown) => { if (!(error instanceof PaidAgentError && error.status === 404)) throw error; });
  return { ran: true, status: contention ? "deferred" : result.status };
}

export async function dispatchPaidCheck(identity: RunIdentity) {
  const { inngest, isAgentRunDispatchConfigured } = await import("@/lib/jobs/inngest");
  if (!isAgentRunDispatchConfigured()) return false;
  const check = await prisma.paidAgentCheck.findFirst({ where: { id: identity.checkId, workspaceId: identity.workspaceId, status: "queued", dueAt: { lte: new Date() } }, include: { policy: { select: { connectionId: true } } } });
  if (!check) return false;
  try {
    await inngest.send({ name: PAID_AGENT_EVENT, id: `paid-check:${check.id}:${check.dueAt.getTime()}`, data: { ...identity, connectionId: check.policy.connectionId } });
    return true;
  } catch { return false; }
}

export async function reconcilePaidChecks(now = new Date()) {
  const expired = await prisma.paidAgentCheck.findMany({ where: { status: { in: ["queued", "running"] }, deadlineAt: { lte: now } }, take: BATCH_SIZE, orderBy: { deadlineAt: "asc" } });
  for (const check of expired) {
    await prisma.paidAgentCheck.updateMany({ where: { id: check.id, workspaceId: check.workspaceId, status: { in: ["queued", "running"] } }, data: { status: "blocked", reason: "The check deadline expired or the worker was unavailable. No recommendation was made.", completedAt: now } });
  }
  const expiredReviews = await prisma.paidAgentCheck.findMany({ where: { reviewStatus: "pending", reviewExpiresAt: { lte: now } }, take: BATCH_SIZE, select: { id: true } });
  await prisma.paidAgentCheck.updateMany({ where: { id: { in: expiredReviews.map((row) => row.id) }, reviewStatus: "pending" }, data: { reviewStatus: "expired" } });
  await scheduleChecks(now);
  return prisma.paidAgentCheck.findMany({ where: { status: "queued", dueAt: { lte: now }, deadlineAt: { gt: now } }, orderBy: { createdAt: "asc" }, take: BATCH_SIZE, select: { id: true, workspaceId: true, dueAt: true, policy: { select: { connectionId: true } } } });
}
