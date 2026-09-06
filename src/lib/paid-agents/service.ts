import { Prisma, type PaidAgentPolicy } from "@prisma/client";
import { prisma } from "@/lib/db";
import { resolveWorkspaceBillingPolicy } from "@/lib/billing/entitlements";
import { agentSnapshotHash } from "@/lib/agent-runs/hash";
import { BATCH_SIZE, CHECK_TTL_MS, MANUAL_COOLDOWN_MS, MAX_POLICIES, PaidAgentError, completedWindow, parsePolicy, type PolicyInput } from "./policy";

export type Db = Prisma.TransactionClient;
export type Identity = { workspaceId: string; actorId: string };
export const jsonValue = (value: unknown) => JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;

export async function lockWorkspace(db: Db, workspaceId: string) {
  const rows = await db.$queryRaw<Array<{ id: string }>>`SELECT "id" FROM "workspaces" WHERE "id" = ${workspaceId} FOR UPDATE`;
  if (!rows.length) throw new PaidAgentError("not_found", "Workspace not found", 404);
}

export async function access(db: Db, identity: Identity, manage: boolean, entitlement = true) {
  const membership = await db.membership.findUnique({ where: { workspaceId_clerkUserId: { workspaceId: identity.workspaceId, clerkUserId: identity.actorId } } });
  const deletion = await db.workspaceDeletionRequest.findUnique({ where: { workspaceId: identity.workspaceId }, select: { id: true } });
  if (deletion || !membership || !(manage ? ["owner", "admin"] : ["owner", "admin", "member"]).includes(membership.role)) {
    throw new PaidAgentError("access_revoked", "Current workspace access does not permit this operation", 403);
  }
  const billing = await resolveWorkspaceBillingPolicy(identity.workspaceId, db);
  if (entitlement && !billing.entitlements.canExecuteActions) throw new PaidAgentError("upgrade_required", "This plan does not include paid agent checks", 403);
  return { canManage: ["owner", "admin"].includes(membership.role), entitled: billing.entitlements.canExecuteActions };
}

export async function boundConnection(db: Db, policy: Pick<PaidAgentPolicy, "workspaceId" | "connectionId" | "platform" | "accountId">) {
  const connection = await db.connection.findFirst({ where: {
    id: policy.connectionId, workspaceId: policy.workspaceId, platform: policy.platform, externalAccountId: policy.accountId,
    status: { in: ["connected", "error"] },
  } });
  if (!connection || !["google_ads", "meta_ads"].includes(connection.platform) || ["authentication", "permission"].includes(connection.lastErrorCode ?? "")) {
    throw new PaidAgentError("connection_unavailable", "The bound ad account is disconnected or its access has been revoked", 409);
  }
  return connection;
}

export async function findPolicy(db: Db, workspaceId: string, policyId: string) {
  const policy = await db.paidAgentPolicy.findFirst({ where: { id: policyId, workspaceId } });
  if (!policy) throw new PaidAgentError("not_found", "Paid goal not found", 404);
  return policy;
}

export function policySnapshot(policy: PaidAgentPolicy) {
  return {
    workspaceId: policy.workspaceId, connectionId: policy.connectionId, platform: policy.platform, accountId: policy.accountId,
    currency: policy.currency, timezone: policy.timezone, name: policy.name, goal: policy.goal, threshold: policy.threshold,
    windowDays: policy.windowDays, minSpend: policy.minSpend, minConversions: policy.minConversions, cadenceHours: policy.cadenceHours,
  };
}

async function bindInput(db: Db, workspaceId: string, input: PolicyInput) {
  const connection = await db.connection.findFirst({ where: { id: input.connectionId, workspaceId, platform: { in: ["google_ads", "meta_ads"] }, status: "connected" } });
  if (!connection) throw new PaidAgentError("connection_unavailable", "Choose a connected Google Ads or Meta Ads account", 422);
  if (!connection.currency || !/^[A-Z]{3}$/.test(connection.currency) || !connection.timezone) {
    throw new PaidAgentError("account_metadata_missing", "Sync the ad account to establish its currency and timezone before saving a goal", 422);
  }
  try { completedWindow(new Date(), connection.timezone, input.windowDays); }
  catch { throw new PaidAgentError("timezone_invalid", "The account timezone is unavailable; reconnect and sync the account", 422); }
  const binding = { platform: connection.platform, accountId: connection.externalAccountId, accountName: connection.displayName ?? connection.externalAccountId, currency: connection.currency, timezone: connection.timezone };
  const { name: _name, ...semantics } = input;
  void _name;
  return { ...input, ...binding, policyKey: agentSnapshotHash({ ...semantics, currency: binding.currency, timezone: binding.timezone }) };
}

async function uniquePolicy(db: Db, workspaceId: string, policyKey: string, exceptId?: string) {
  const duplicate = await db.paidAgentPolicy.findFirst({ where: { workspaceId, policyKey, ...(exceptId ? { id: { not: exceptId } } : {}) } });
  if (duplicate) throw new PaidAgentError("duplicate_goal", "An identical goal already exists for this account");
}

export async function invalidateChecks(db: Db, policyId: string, reason: string, now: Date) {
  await db.paidAgentCheck.updateMany({ where: { policyId, status: { in: ["queued", "running"] } }, data: { status: "cancelled", reason, completedAt: now } });
  await db.paidAgentCheck.updateMany({ where: { policyId, reviewStatus: "pending" }, data: { reviewStatus: "invalidated" } });
}

export async function queueCheck(db: Db, policy: PaidAgentPolicy, now: Date) {
  const pending = await db.paidAgentCheck.findFirst({ where: { policyId: policy.id, status: { in: ["queued", "running"] } } });
  if (pending) return pending;
  await db.paidAgentCheck.updateMany({ where: { policyId: policy.id, reviewStatus: "pending" }, data: { reviewStatus: "invalidated" } });
  const check = await db.paidAgentCheck.create({ data: {
    workspaceId: policy.workspaceId, policyId: policy.id, policyVersion: policy.version, snapshot: jsonValue(policySnapshot(policy)),
    dueAt: now, deadlineAt: new Date(now.getTime() + CHECK_TTL_MS), reason: "Queued for a fresh account sync; no evaluation has run yet.",
  } });
  await db.paidAgentPolicy.update({ where: { id: policy.id }, data: { nextCheckAt: new Date(now.getTime() + policy.cadenceHours * 3_600_000) } });
  return check;
}

type CommandResult = { policyId: string; checkId?: string };
export type PolicyCommand =
  | { kind: "create"; policy: PolicyInput }
  | { kind: "edit"; policyId: string; version: number; policy: PolicyInput }
  | { kind: "pause" | "resume" | "check"; policyId: string; version: number }
  | { kind: "review"; policyId: string; version: number; checkId: string; decision: "acknowledged" | "dismissed" };

export async function command(identity: Identity, requestId: string, input: PolicyCommand, now = new Date()): Promise<CommandResult> {
  return prisma.$transaction(async (db) => {
    await lockWorkspace(db, identity.workspaceId);
    // Pause remains available after downgrade, so users can always stop checks.
    await access(db, identity, true, input.kind !== "pause");
    const requestHash = agentSnapshotHash({ actorId: identity.actorId, ...input });
    const ledgerKey = { workspaceId: identity.workspaceId, operation: "paid_agents", requestId };
    const prior = await db.manualCreationRequest.findUnique({ where: { workspaceId_operation_requestId: ledgerKey } });
    if (prior) {
      if (prior.requestHash !== requestHash) throw new PaidAgentError("request_conflict", "This request key was already used for a different command");
      return prior.responseBody as CommandResult;
    }
    let result: CommandResult;
    if (input.kind === "create") {
      if (await db.paidAgentPolicy.count({ where: { workspaceId: identity.workspaceId } }) >= MAX_POLICIES) throw new PaidAgentError("policy_limit", "This workspace has reached its 20-goal limit");
      const data = await bindInput(db, identity.workspaceId, parsePolicy(input.policy));
      await uniquePolicy(db, identity.workspaceId, data.policyKey);
      const policy = await db.paidAgentPolicy.create({ data: { ...data, workspaceId: identity.workspaceId, createdBy: identity.actorId, nextCheckAt: now } });
      result = { policyId: policy.id };
    } else {
      const policy = await findPolicy(db, identity.workspaceId, input.policyId);
      if (policy.version !== input.version) throw new PaidAgentError("version_conflict", "The goal changed. Refresh before trying again.");
      result = { policyId: policy.id };
      if (input.kind === "edit" || input.kind === "pause" || input.kind === "resume") {
        const data = input.kind === "edit" ? await bindInput(db, identity.workspaceId, parsePolicy(input.policy)) : null;
        if (data) await uniquePolicy(db, identity.workspaceId, data.policyKey, policy.id);
        if (input.kind === "resume") await boundConnection(db, policy);
        await invalidateChecks(db, policy.id, "Cancelled because the goal was edited, paused, or resumed.", now);
        const status = input.kind === "pause" ? "paused" : input.kind === "resume" ? "active" : policy.status;
        await db.paidAgentPolicy.update({ where: { id: policy.id }, data: {
          ...data, status, version: { increment: 1 }, createdBy: identity.actorId,
          nextCheckAt: status === "active" ? new Date(Math.max(now.getTime(), (policy.lastCheckAt?.getTime() ?? 0) + MANUAL_COOLDOWN_MS)) : null,
        } });
      } else if (input.kind === "check") {
        if (policy.status !== "active") throw new PaidAgentError("paused", "Resume the goal before requesting a check");
        await boundConnection(db, policy);
        const latest = await db.paidAgentCheck.findFirst({ where: { policyId: policy.id }, orderBy: { createdAt: "desc" } });
        if (latest && ["queued", "running"].includes(latest.status)) result.checkId = latest.id;
        else {
          if (latest && now.getTime() - latest.dueAt.getTime() < MANUAL_COOLDOWN_MS) throw new PaidAgentError("check_cooldown", "Allow at least one hour between manual checks");
          result.checkId = (await queueCheck(db, policy, now)).id;
        }
      } else if (input.kind === "review") {
        await boundConnection(db, policy);
        const check = await db.paidAgentCheck.findFirst({ where: { id: input.checkId, workspaceId: identity.workspaceId, policyId: policy.id } });
        if (!check) throw new PaidAgentError("not_found", "Check not found", 404);
        if (policy.status !== "active" || check.policyVersion !== policy.version || check.reviewStatus !== "pending" || !check.reviewExpiresAt || check.reviewExpiresAt <= now) {
          throw new PaidAgentError("review_invalidated", "This recommendation has expired or the goal changed. Run a fresh check.");
        }
        const current = await boundConnection(db, policy);
        if (current.currency !== policy.currency || current.timezone !== policy.timezone) throw new PaidAgentError("binding_changed", "Account settings changed; edit and recheck the goal");
        await db.paidAgentCheck.update({ where: { id: check.id }, data: { reviewStatus: input.decision, reviewedBy: identity.actorId, reviewedAt: now } });
        result.checkId = check.id;
      }
    }
    await db.manualCreationRequest.create({ data: { ...ledgerKey, requestHash, responseBody: jsonValue(result), statusCode: 200 } });
    return result;
  }, { timeout: 15_000 });
}

export async function listWorkspace(identity: Identity) {
  const permissions = await access(prisma, identity, false, false);
  const policies = await prisma.paidAgentPolicy.findMany({ where: { workspaceId: identity.workspaceId }, orderBy: { createdAt: "desc" }, take: MAX_POLICIES, include: { checks: { orderBy: { createdAt: "desc" }, take: 1 } } });
  const connections = await prisma.connection.findMany({ where: { workspaceId: identity.workspaceId, platform: { in: ["google_ads", "meta_ads"] } }, select: { id: true, platform: true, externalAccountId: true, displayName: true, status: true, currency: true, timezone: true } });
  const { isAgentRunDispatchConfigured } = await import("@/lib/jobs/inngest");
  return { ...permissions, workerAvailable: isAgentRunDispatchConfigured(), policies, connections };
}

export async function history(identity: Identity, policyId: string, cursor?: string) {
  await access(prisma, identity, false, false);
  await findPolicy(prisma, identity.workspaceId, policyId);
  // The cursor is only an ID boundary, never an unscoped Prisma cursor lookup.
  const rows = await prisma.paidAgentCheck.findMany({ where: { workspaceId: identity.workspaceId, policyId, ...(cursor ? { id: { lt: cursor } } : {}) }, orderBy: { id: "desc" }, take: 31 });
  return { checks: rows.slice(0, 30), nextCursor: rows.length > 30 ? rows[29].id : null };
}

export async function scheduleChecks(now = new Date()) {
  const due = await prisma.paidAgentPolicy.findMany({ where: { status: "active", nextCheckAt: { lte: now } }, orderBy: [{ nextCheckAt: "asc" }, { id: "asc" }], take: BATCH_SIZE });
  for (const candidate of due) {
    await prisma.$transaction(async (db) => {
      await lockWorkspace(db, candidate.workspaceId);
      const policy = await findPolicy(db, candidate.workspaceId, candidate.id);
      if (policy.status !== "active" || !policy.nextCheckAt || policy.nextCheckAt > now) return;
      // Execution performs fresh access checks and records any denial durably.
      await queueCheck(db, policy, now);
    }).catch((error: unknown) => { if (!(error instanceof PaidAgentError && error.status === 404)) throw error; });
  }
  return due.length;
}
