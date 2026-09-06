import type { PaidAgentPolicy, PaidAgentCheck } from "@prisma/client";
import type { Evaluation } from "./evaluate";

export interface CheckDto {
  id: string;
  policyVersion: number;
  status: string;
  reason: string;
  reviewStatus: string;
  reviewExpiresAt: string | null;
  reviewedAt: string | null;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
  syncAttemptId: string | null;
  snapshot: { goal: string; threshold: number; currency: string; windowDays: number };
  result: (Evaluation & { range?: { from: string; to: string }; syncedAt?: string }) | null;
}

export interface PolicyDto {
  id: string;
  name: string;
  connectionId: string;
  platform: string;
  accountId: string;
  accountName: string;
  currency: string;
  timezone: string;
  goal: string;
  threshold: number;
  windowDays: number;
  minSpend: number;
  minConversions: number;
  cadenceHours: number;
  version: number;
  status: string;
  lastCheckAt: string | null;
  nextCheckAt: string | null;
  checks: CheckDto[];
}

export interface WorkspaceDto {
  canManage: boolean;
  entitled: boolean;
  workerAvailable: boolean;
  policies: PolicyDto[];
  connections: Array<{ id: string; platform: string; externalAccountId: string; displayName: string | null; status: string; currency: string | null; timezone: string | null }>;
}

export function checkDto(check: PaidAgentCheck, now = new Date()): CheckDto {
  const snapshot = check.snapshot as unknown as CheckDto["snapshot"];
  return {
    id: check.id, policyVersion: check.policyVersion, status: check.status, reason: check.reason,
    reviewStatus: check.reviewStatus === "pending" && check.reviewExpiresAt && check.reviewExpiresAt <= now ? "expired" : check.reviewStatus,
    reviewExpiresAt: check.reviewExpiresAt?.toISOString() ?? null, reviewedAt: check.reviewedAt?.toISOString() ?? null,
    startedAt: check.startedAt?.toISOString() ?? null, completedAt: check.completedAt?.toISOString() ?? null,
    createdAt: check.createdAt.toISOString(), syncAttemptId: check.syncAttemptId,
    snapshot: { goal: snapshot.goal, threshold: snapshot.threshold, currency: snapshot.currency, windowDays: snapshot.windowDays },
    result: check.result as unknown as CheckDto["result"],
  };
}

export function policyDto(policy: PaidAgentPolicy & { checks: PaidAgentCheck[] }): PolicyDto {
  return {
    id: policy.id, name: policy.name, connectionId: policy.connectionId, platform: policy.platform, accountId: policy.accountId,
    accountName: policy.accountName, currency: policy.currency, timezone: policy.timezone, goal: policy.goal, threshold: policy.threshold,
    windowDays: policy.windowDays, minSpend: policy.minSpend, minConversions: policy.minConversions, cadenceHours: policy.cadenceHours,
    version: policy.version, status: policy.status, lastCheckAt: policy.lastCheckAt?.toISOString() ?? null,
    nextCheckAt: policy.nextCheckAt?.toISOString() ?? null, checks: policy.checks.map((check) => checkDto(check)),
  };
}
