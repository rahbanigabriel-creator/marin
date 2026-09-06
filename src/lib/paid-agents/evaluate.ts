import type { MetricFact } from "@prisma/client";
import type { PaidAccountSyncOutcome } from "@/lib/connectors/paid-sync";
import { CHECK_TTL_MS, MAX_FACTS, type PolicyInput } from "./policy";

export interface Evaluation {
  status: "healthy" | "needs_review" | "blocked";
  code: string;
  reason: string;
  observed: number | null;
  spend: number | null;
  conversions: number | null;
  revenue: number | null;
  recommendation: string | null;
}

type Fact = Pick<MetricFact, "workspaceId" | "connectionId" | "platform" | "date" | "campaignExternalId" | "metric" | "value" | "currency" | "lastSeenAttemptId" | "staleAt">;

export function blocked(code: string, reason: string): Evaluation {
  return { status: "blocked", code, reason, observed: null, spend: null, conversions: null, revenue: null, recommendation: null };
}

export function evaluatePaidGoal(input: {
  policy: PolicyInput & { workspaceId: string; platform: string; accountId: string; currency: string; timezone: string };
  range: { from: Date; to: Date };
  sync: PaidAccountSyncOutcome;
  facts: Fact[];
  startedAt: Date;
  now: Date;
}): Evaluation {
  const { policy, range, sync, facts, now, startedAt } = input;
  const syncedAt = Date.parse(sync.lastSyncedAt);
  if (sync.connectionId !== policy.connectionId || sync.platform !== policy.platform || sync.accountId !== policy.accountId) {
    return blocked("account_mismatch", "The fresh sync does not match this account binding.");
  }
  if (!Number.isFinite(syncedAt) || syncedAt < startedAt.getTime() || syncedAt > now.getTime() || now.getTime() - syncedAt > CHECK_TTL_MS) {
    return blocked("stale_sync", "Fresh evidence is unavailable. Saved metrics were not evaluated.");
  }
  const metrics = sync.phases.metrics;
  if (metrics.state !== "succeeded" || !metrics.complete) return blocked("incomplete_sync", "The fresh metrics sync did not complete. No recommendation was made.");
  if (!metrics.observedFrom || !metrics.observedTo || !Number.isFinite(Date.parse(metrics.observedFrom)) || !Number.isFinite(Date.parse(metrics.observedTo)) || Date.parse(metrics.observedFrom) > range.from.getTime() || Date.parse(metrics.observedTo) < range.to.getTime()) {
    return blocked("coverage_missing", "Fresh metric coverage does not span the requested completed-day window.");
  }
  if (sync.currency !== policy.currency || sync.timezone !== policy.timezone) return blocked("account_metadata_changed", "Account currency or timezone changed. Edit and save the goal before checking again.");
  if (!facts.length || facts.length > MAX_FACTS) return blocked("metrics_missing_or_large", "No complete bounded metric sample is available.");
  const groups = new Map<string, Map<string, number>>();
  const grains = new Set<boolean>();
  // Every observed campaign-day participates, including click-only rows. A
  // campaign cannot disappear from the denominator because tracking is absent.
  for (const fact of facts) {
    if (fact.workspaceId !== policy.workspaceId || fact.connectionId !== policy.connectionId || fact.platform !== policy.platform ||
      fact.lastSeenAttemptId !== sync.attemptId || fact.staleAt || !Number.isFinite(fact.date.getTime()) || fact.date < range.from || fact.date > range.to ||
      !Number.isFinite(fact.value) || fact.value < 0 || fact.currency !== policy.currency) {
      return blocked("invalid_evidence", "The metric sample contains stale, mismatched, or invalid evidence.");
    }
    grains.add(Boolean(fact.campaignExternalId));
    const key = `${fact.date.toISOString()}:${fact.campaignExternalId}`;
    const group = groups.get(key) ?? new Map<string, number>();
    if (group.has(fact.metric)) return blocked("duplicate_evidence", "Duplicate metric evidence prevents a reliable evaluation.");
    group.set(fact.metric, fact.value);
    groups.set(key, group);
  }
  if (grains.size > 1) return blocked("mixed_grain", "Account totals and campaign totals cannot be added together.");
  if (!groups.size) return blocked("metrics_missing", "Canonical spend and conversion evidence is missing.");
  let spend = 0, conversions = 0, revenue = 0;
  for (const group of groups.values()) {
    if (!group.has("spend") || !group.has("conversions") || (policy.goal === "min_roas" && !group.has("revenue"))) {
      return blocked("conversion_evidence_missing", "Spend, conversion counts, and required conversion value must cover every observed campaign-day. Missing values are not zero.");
    }
    spend += group.get("spend")!;
    conversions += group.get("conversions")!;
    revenue += group.get("revenue") ?? 0;
  }
  if (![spend, conversions, revenue].every(Number.isFinite)) return blocked("invalid_evidence", "Metric totals are invalid.");
  if (spend < policy.minSpend || conversions < policy.minConversions || spend <= 0 || conversions <= 0) {
    return { ...blocked("insufficient_sample", "Minimum spend and conversion sample not met. No performance recommendation was made."), spend, conversions };
  }
  // Ratios are calculated from additive canonical totals, never averaged ratios.
  const observed = policy.goal === "min_roas" ? revenue / spend : policy.goal === "max_cpa" ? spend / conversions : spend;
  const breached = policy.goal === "min_roas" ? observed < policy.threshold : observed > policy.threshold;
  return {
    status: breached ? "needs_review" : "healthy", code: breached ? "threshold_breached" : "threshold_met",
    reason: breached ? "The observed account result is outside the saved goal. Human review is required." : "The observed account result meets the saved threshold for this window; future performance is not guaranteed.",
    observed, spend, conversions, revenue: policy.goal === "min_roas" ? revenue : null,
    recommendation: breached ? (policy.goal === "max_spend"
      ? "Review account spend and campaign budgets in the ad platform. This is an alert, not an enforced spend cap. No campaign changes have been made."
      : "Review conversion tracking, attribution, and campaign-level performance in the ad platform before deciding on changes. No campaign changes have been made.") : null,
  };
}
