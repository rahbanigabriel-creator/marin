import { createHash } from "node:crypto";

import type { Prisma } from "@prisma/client";

import type { ModelTier } from "@/lib/agent/router";
import { includedCreditsFor, PLANS, type LaunchPlanId } from "@/lib/billing/plans";
import { isDatabaseConfigured, prisma } from "@/lib/db";
import { resolveWorkspaceBillingPolicy, type BillingDatabase } from "@/lib/billing/entitlements";

export type UsageKind = "answer" | "credit";
export type UsageDecisionCode =
  | "credit_limit"
  | "model_not_in_plan"
  | "idempotency_conflict"
  | "request_in_progress";

export interface UsageDecision {
  allowed: boolean;
  persisted: boolean;
  planId: LaunchPlanId;
  included: number;
  used: number;
  reserved: number;
  remaining: number;
  code?: UsageDecisionCode;
  message?: string;
}

export interface ReserveAnswerInput {
  workspaceId: string;
  idempotencyKey: string;
  requestHash: string;
  credits: number;
  model: string;
  requiresOpus: boolean;
  now?: Date;
}

const STALE_RESERVATION_MS = 15 * 60 * 1_000;

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, canonicalize(entry)]),
    );
  }
  return value;
}

export function answerRequestFingerprint(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(canonicalize(value))).digest("hex");
}

export function creditsForAnswer(tier: ModelTier): number {
  return tier === "high" ? 2 : 1;
}

async function usageTotals(
  db: BillingDatabase,
  workspaceId: string,
  periodStart: Date,
  periodEnd: Date,
): Promise<{ used: number; reserved: number }> {
  const [committed, pending] = await Promise.all([
    db.usageEvent.aggregate({
      _sum: { credits: true },
      where: {
        workspaceId,
        status: "committed",
        periodStart: { gte: periodStart, lt: periodEnd },
      },
    }),
    db.usageEvent.aggregate({
      _sum: { credits: true },
      where: {
        workspaceId,
        status: "reserved",
        periodStart: { gte: periodStart, lt: periodEnd },
      },
    }),
  ]);
  return {
    used: committed._sum.credits ?? 0,
    reserved: pending._sum.credits ?? 0,
  };
}

function decision(input: {
  allowed: boolean;
  persisted: boolean;
  planId: LaunchPlanId;
  included: number;
  used: number;
  reserved: number;
  code?: UsageDecisionCode;
  message?: string;
}): UsageDecision {
  return {
    ...input,
    remaining: Math.max(0, input.included - input.used - input.reserved),
  };
}

/**
 * Atomically reserve one answer's credits before model work starts. The workspace
 * row lock serializes concurrent turns, while the compound idempotency key makes
 * retries reuse the same reservation instead of charging twice.
 */
export async function reserveAnswerUsage(input: ReserveAnswerInput): Promise<UsageDecision> {
  const idempotencyKey = input.idempotencyKey.trim().slice(0, 160);
  const requestHash = input.requestHash.trim();
  if (!idempotencyKey) throw new Error("A usage idempotency key is required");
  if (!/^[a-f0-9]{64}$/.test(requestHash)) throw new Error("A valid request hash is required");
  if (!Number.isSafeInteger(input.credits) || input.credits <= 0) {
    throw new Error("Credits must be a positive integer");
  }

  if (!isDatabaseConfigured() || input.workspaceId === "dev-workspace") {
    return decision({
      allowed: true,
      persisted: false,
      planId: "free",
      included: PLANS.free.includedCredits,
      used: 0,
      reserved: 0,
    });
  }

  const now = input.now ?? new Date();
  return prisma.$transaction(async (tx) => {
    const locked = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT "id" FROM "workspaces" WHERE "id" = ${input.workspaceId} FOR UPDATE
    `;
    if (!locked.length) throw new Error("Workspace not found");

    await tx.usageEvent.updateMany({
      where: {
        workspaceId: input.workspaceId,
        status: "reserved",
        reservedAt: { lt: new Date(now.getTime() - STALE_RESERVATION_MS) },
      },
      data: { status: "released", releasedAt: now },
    });

    const policy = await resolveWorkspaceBillingPolicy(input.workspaceId, tx, now);
    const plan = PLANS[policy.planId];
    const existing = await tx.usageEvent.findUnique({
      where: {
        workspaceId_idempotencyKey: {
          workspaceId: input.workspaceId,
          idempotencyKey,
        },
      },
    });

    if (input.requiresOpus && !policy.entitlements.canUseOpus) {
      const totals = await usageTotals(tx, input.workspaceId, policy.periodStart, policy.periodEnd);
      return decision({
        allowed: false,
        persisted: false,
        planId: policy.planId,
        included: plan.includedCredits,
        ...totals,
        code: "model_not_in_plan",
        message: "Extra depth with Opus is available on the Solo Founder plan.",
      });
    }

    if (existing && existing.requestHash !== requestHash) {
      const totals = await usageTotals(tx, input.workspaceId, policy.periodStart, policy.periodEnd);
      return decision({
        allowed: false,
        persisted: false,
        planId: policy.planId,
        included: plan.includedCredits,
        ...totals,
        code: "idempotency_conflict",
        message: "This retry no longer matches the original request. Start a new message.",
      });
    }

    if (
      existing &&
      existing.status !== "released" &&
      (existing.credits !== input.credits || existing.model !== input.model)
    ) {
      const totals = await usageTotals(tx, input.workspaceId, policy.periodStart, policy.periodEnd);
      return decision({
        allowed: false,
        persisted: false,
        planId: policy.planId,
        included: plan.includedCredits,
        ...totals,
        code: "idempotency_conflict",
        message: "This retry no longer matches the original model request. Start a new message.",
      });
    }

    if (existing?.status === "committed") {
      const totals = await usageTotals(tx, input.workspaceId, policy.periodStart, policy.periodEnd);
      return decision({
        allowed: false,
        persisted: false,
        planId: policy.planId,
        included: plan.includedCredits,
        ...totals,
        code: "idempotency_conflict",
        message: "This message already completed. Start a new message for another answer.",
      });
    }

    if (existing?.status === "reserved") {
      const totals = await usageTotals(tx, input.workspaceId, policy.periodStart, policy.periodEnd);
      return decision({
        allowed: false,
        persisted: false,
        planId: policy.planId,
        included: plan.includedCredits,
        ...totals,
        code: "request_in_progress",
        message: "This message is already being generated. Wait for it to finish before retrying.",
      });
    }

    const totals = await usageTotals(tx, input.workspaceId, policy.periodStart, policy.periodEnd);
    if (totals.used + totals.reserved + input.credits > plan.includedCredits) {
      return decision({
        allowed: false,
        persisted: false,
        planId: policy.planId,
        included: plan.includedCredits,
        ...totals,
        code: "credit_limit",
        message: `You have used the ${plan.includedCredits} credits included in ${plan.name}.`,
      });
    }

    if (existing) {
      await tx.usageEvent.update({
        where: { id: existing.id },
        data: {
          kind: "answer",
          credits: input.credits,
          model: input.model,
          requestHash,
          status: "reserved",
          periodStart: policy.periodStart,
          periodEnd: policy.periodEnd,
          reservedAt: now,
          committedAt: null,
          releasedAt: null,
        },
      });
    } else {
      await tx.usageEvent.create({
        data: {
          workspaceId: input.workspaceId,
          idempotencyKey,
          requestHash,
          kind: "answer",
          credits: input.credits,
          model: input.model,
          status: "reserved",
          periodStart: policy.periodStart,
          periodEnd: policy.periodEnd,
          reservedAt: now,
        },
      });
    }

    return decision({
      allowed: true,
      persisted: true,
      planId: policy.planId,
      included: plan.includedCredits,
      used: totals.used,
      reserved: totals.reserved + input.credits,
    });
  });
}

export async function commitUsageReservation(
  workspaceId: string,
  idempotencyKey: string,
  committedAt = new Date(),
): Promise<boolean> {
  if (!isDatabaseConfigured() || workspaceId === "dev-workspace") return false;
  return commitUsageReservationWithDb(prisma, workspaceId, idempotencyKey, committedAt);
}

type UsageSettlementDatabase = Pick<Prisma.TransactionClient, "usageEvent">;

/** Settle usage inside a caller-owned transaction when work and billing are inseparable. */
export async function commitUsageReservationWithDb(
  db: UsageSettlementDatabase,
  workspaceId: string,
  idempotencyKey: string,
  committedAt = new Date(),
): Promise<boolean> {
  const result = await db.usageEvent.updateMany({
    where: { workspaceId, idempotencyKey, status: "reserved" },
    data: { status: "committed", committedAt, releasedAt: null },
  });
  return result.count > 0;
}

export async function releaseUsageReservation(
  workspaceId: string,
  idempotencyKey: string,
  releasedAt = new Date(),
): Promise<boolean> {
  if (!isDatabaseConfigured() || workspaceId === "dev-workspace") return false;
  const result = await prisma.usageEvent.updateMany({
    where: { workspaceId, idempotencyKey, status: "reserved" },
    data: { status: "released", releasedAt },
  });
  return result.count > 0;
}

export async function sumCreditsUsed(
  workspaceId: string,
  from: Date,
  to: Date = new Date(),
): Promise<number> {
  if (!isDatabaseConfigured() || workspaceId === "dev-workspace") return 0;
  const aggregate = await prisma.usageEvent.aggregate({
    _sum: { credits: true },
    where: { workspaceId, status: "committed", createdAt: { gte: from, lt: to } },
  });
  return aggregate._sum.credits ?? 0;
}

export async function checkCreditBudget(
  workspaceId: string,
  plan: string,
  periodStart: Date,
): Promise<{ allowed: boolean; used: number; included: number; remaining: number }> {
  const included = includedCreditsFor(plan);
  const used = await sumCreditsUsed(workspaceId, periodStart);
  const remaining = Math.max(0, included - used);
  return { allowed: remaining > 0, used, included, remaining };
}
