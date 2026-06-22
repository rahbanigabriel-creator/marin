import "server-only";

import type { ModelTier } from "@/lib/agent/router";
import { includedCreditsFor } from "@/lib/billing/plans";

/**
 * Usage metering (Stack C — Billing & metering). Server-only.
 *
 * Records per-answer credit consumption into the UsageEvent warehouse
 * (prisma/schema.prisma) so plan limits / overage billing can be computed. The
 * "credit" is the friendly face of the token budget (docs/pricing-strategy.md §1):
 * a standard answer = 1 credit, a deep (Opus) answer = 2 credits.
 *
 * Graceful without keys (mirrors src/lib/metrics/ingest.ts and src/lib/db.ts):
 *   • Importing this module NEVER touches the database. prisma + isDatabaseConfigured
 *     are imported DYNAMICALLY inside recordUsage, only on the live path, so the
 *     import graph stays light and `next build` / `tsc --noEmit` are env-free.
 *   • recordUsage is a SILENT NO-OP (never throws) when no DATABASE_URL is set, so
 *     the chat answer stream is byte-identical with no DB. Any write error is
 *     swallowed and logged at warn — metering must never break a request path.
 *
 * Security: a UsageEvent records only the shape of usage (kind, credit count,
 * model tier) — never the question text, never any token or secret.
 */

/** UsageEvent.kind discriminator (matches prisma/schema.prisma). */
export type UsageKind = "answer" | "credit";

/** What recordUsage writes for one metered event. */
export interface UsageInput {
  /** "answer" = a completed chat answer; "credit" = a manual credit ledger entry. */
  kind: UsageKind;
  /** Credits consumed by this event (1 standard, 2 deep). */
  credits: number;
  /** The model/tier that served the answer, for cost attribution (optional). */
  model?: string | null;
}

/**
 * Credits a single answer consumes, by routed model tier (pricing-strategy.md §1):
 *   • high (Opus 4.8 — deep dive / forecast / strategy) → 2 credits
 *   • low / medium (Haiku / Sonnet — quick lookup / standard) → 1 credit
 * Pure + deterministic; no env, no I/O.
 */
export function creditsForAnswer(tier: ModelTier): number {
  return tier === "high" ? 2 : 1;
}

/**
 * Record one usage event for a workspace. No-op (and never throws) when the DB
 * is not configured — so the keyless chat path is completely unaffected. Returns
 * true when a row was written, false when it was skipped (no DB) or failed.
 *
 * Wired into the chat route when an answer completes; safe to await or fire as a
 * floating promise (errors are swallowed internally and logged at warn).
 */
export async function recordUsage(
  workspaceId: string,
  input: UsageInput,
): Promise<boolean> {
  if (workspaceId === "dev-workspace") return false;

  // Dynamic import keeps Prisma out of this module's static import graph; the DB
  // is only touched on the live path, after the gate passes.
  const { prisma, isDatabaseConfigured } = await import("@/lib/db");
  if (!isDatabaseConfigured()) return false; // no DB → silent no-op

  try {
    await prisma.usageEvent.create({
      data: {
        workspaceId,
        kind: input.kind,
        credits: input.credits,
        model: input.model ?? null,
      },
    });
    return true;
  } catch (err) {
    // Never let metering surface to, or break, the caller (e.g. the answer stream).
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[billing] recordUsage failed for workspace ${workspaceId}: ${msg}`);
    return false;
  }
}

/**
 * Sum the credits a workspace has consumed within a window [from, to). Returns 0
 * when the DB is not configured. Used by the (future) enforcement path to compare
 * against the plan's included allowance.
 */
export async function sumCreditsUsed(
  workspaceId: string,
  from: Date,
  to: Date = new Date(),
): Promise<number> {
  if (workspaceId === "dev-workspace") return 0;

  const { prisma, isDatabaseConfigured } = await import("@/lib/db");
  if (!isDatabaseConfigured()) return 0;

  try {
    const agg = await prisma.usageEvent.aggregate({
      _sum: { credits: true },
      where: { workspaceId, createdAt: { gte: from, lt: to } },
    });
    return agg._sum.credits ?? 0;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[billing] sumCreditsUsed failed for workspace ${workspaceId}: ${msg}`);
    return 0;
  }
}

/**
 * Enforcement check (DOCUMENTED STUB — round 1).
 *
 * The pricing strategy (§2, §7) enforces a hard per-tenant credit budget in the
 * router: as the cap nears it downgrades tier / serves from cache, and only
 * REFUSES at the hard ceiling. That live enforcement is intentionally NOT wired
 * yet — round 1 only meters (records UsageEvents) so the keyless path stays
 * byte-identical. This helper returns the data a future enforcement gate needs,
 * but the chat route does NOT yet refuse on it.
 *
 * Returns { allowed, used, included, remaining }. With no DB it reports the plan
 * allowance as fully available (allowed: true) so nothing is ever blocked today.
 */
export async function checkCreditBudget(
  workspaceId: string,
  plan: string,
  periodStart: Date,
): Promise<{ allowed: boolean; used: number; included: number; remaining: number }> {
  const included = includedCreditsFor(plan);
  const used = await sumCreditsUsed(workspaceId, periodStart);
  const remaining = Math.max(0, included - used);
  // STUB: always allow in round 1. Enforcement (refuse-at-ceiling, downgrade,
  // serve-from-cache) is a separate chunk; flipping this gate must not change the
  // keyless path. See pricing-strategy.md §7 guardrail 1.
  return { allowed: true, used, included, remaining };
}
