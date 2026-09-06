import type { Connection, PaidAgentCheck, PaidAgentPolicy } from "@prisma/client";
import { prisma } from "@/lib/db";
import { agentSnapshotHash } from "@/lib/agent-runs/hash";
import type { PaidAccountSyncOutcome, SyncPhaseOutcome } from "@/lib/connectors/paid-sync";
import { MAX_FACTS } from "./policy";

export function connectionGeneration(connection: Connection) {
  return agentSnapshotHash({ id: connection.id, workspaceId: connection.workspaceId, platform: connection.platform,
    accountId: connection.externalAccountId, createdAt: connection.createdAt.toISOString(), currency: connection.currency,
    timezone: connection.timezone, scopes: connection.scopes, access: connection.encAccessToken, refresh: connection.encRefreshToken,
    expiresAt: connection.expiresAt?.toISOString() ?? null });
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function phase(value: unknown): SyncPhaseOutcome | null {
  const row = record(value);
  if (!row || !["succeeded", "partial", "failed", "skipped"].includes(String(row.state)) || typeof row.complete !== "boolean" ||
    !Number.isSafeInteger(row.rows) || Number(row.rows) < 0 || Number(row.rows) > MAX_FACTS ||
    !(row.observedFrom === null || typeof row.observedFrom === "string") || !(row.observedTo === null || typeof row.observedTo === "string")) return null;
  return { state: row.state as SyncPhaseOutcome["state"], complete: row.complete, rows: Number(row.rows),
    observedFrom: row.observedFrom, observedTo: row.observedTo, errorCode: null, errorMessage: null };
}

/** Reuse only a goal-owned refresh started AFTER this check was queued. The
 * exact account, window, credential generation and 5-minute age must match. */
export async function reusableFreshSync(input: {
  policy: PaidAgentPolicy; check: PaidAgentCheck; connection: Connection;
  range: { from: Date; to: Date }; now: Date;
}): Promise<PaidAccountSyncOutcome | null> {
  const source = await prisma.paidAgentCheck.findFirst({ where: {
    workspaceId: input.policy.workspaceId, policy: { connectionId: input.policy.connectionId },
    id: { not: input.check.id }, status: { in: ["healthy", "needs_review"] },
    completedAt: { gte: new Date(input.now.getTime() - 5 * 60_000), lte: input.now }, syncAttemptId: { not: null },
  }, orderBy: { completedAt: "desc" } });
  if (!source || record(source.result)?.connectionGeneration !== connectionGeneration(input.connection)) return null;
  const attempt = await prisma.syncAttempt.findFirst({ where: {
    id: source.syncAttemptId!, workspaceId: input.policy.workspaceId, connectionId: input.policy.connectionId,
    trigger: "paid_agent", status: { in: ["succeeded", "partial"] }, metricsStatus: "succeeded",
    requestedFrom: input.range.from, requestedTo: input.range.to, startedAt: { gte: input.check.createdAt },
    completedAt: { gte: new Date(input.now.getTime() - 5 * 60_000), lte: input.now },
    currency: input.policy.currency, timezone: input.policy.timezone,
  } });
  const details = record(attempt?.phaseDetails);
  const metrics = phase(details?.metrics), campaigns = phase(details?.campaigns), ads = phase(details?.ads);
  if (!attempt?.completedAt || !metrics || !campaigns || !ads) return null;
  return { attemptId: attempt.id, connectionId: input.policy.connectionId, platform: input.policy.platform as "google_ads" | "meta_ads",
    accountId: input.policy.accountId, accountName: input.policy.accountName, state: attempt.status as "succeeded" | "partial",
    currency: attempt.currency, timezone: attempt.timezone, observedFrom: attempt.observedFrom?.toISOString() ?? null,
    observedTo: attempt.observedTo?.toISOString() ?? null, lastSyncedAt: attempt.completedAt.toISOString(), phases: { metrics, campaigns, ads } };
}
