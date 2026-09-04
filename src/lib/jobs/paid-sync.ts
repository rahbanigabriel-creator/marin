import type { PaidSyncPlatform } from "@/lib/connectors/paid-clients";
import type { MetricRange } from "@/lib/connectors/types";

export const PAID_SYNC_JOB_TRIGGERS = {
  scheduled: "scheduled",
  connected: "connected",
  backfill: "backfill",
} as const;

export type PaidSyncJobTrigger = (typeof PAID_SYNC_JOB_TRIGGERS)[keyof typeof PAID_SYNC_JOB_TRIGGERS];

const BACKGROUND_PAID_PLATFORMS = [
  "google_ads",
  "meta_ads",
] as const satisfies readonly PaidSyncPlatform[];

interface PaidSyncJobRunnerInput {
  workspaceId: string;
  range: MetricRange;
  trigger: PaidSyncJobTrigger;
  platforms: PaidSyncPlatform[];
}

interface PaidSyncJobRunnerResult {
  results: Array<{
    connectionId: string;
    phases: { metrics: { complete: boolean; rows: number } };
  }>;
}

export type PaidSyncJobRunner = (
  input: PaidSyncJobRunnerInput,
) => Promise<PaidSyncJobRunnerResult>;

export interface PaidSyncJobSummary {
  connections: number;
  metrics: number;
}

export function isBackgroundPaidPlatform(platform: string): platform is PaidSyncPlatform {
  return (BACKGROUND_PAID_PLATFORMS as readonly string[]).includes(platform);
}

export function clampPaidBackfillDays(value: unknown, maximumDays: number): number {
  if (!Number.isInteger(maximumDays) || maximumDays < 1) {
    throw new RangeError("maximumDays must be a positive integer");
  }
  const days = typeof value === "number" && Number.isFinite(value)
    ? Math.floor(value)
    : maximumDays;
  return Math.max(1, Math.min(days, maximumDays));
}

function paidPlatformsForFilter(platformFilter?: string): PaidSyncPlatform[] {
  if (!platformFilter) return [...BACKGROUND_PAID_PLATFORMS];
  return isBackgroundPaidPlatform(platformFilter) ? [platformFilter] : [];
}

/**
 * Route one bounded background batch through the canonical account-scoped paid
 * sync. That service owns connection locking, idempotent reconciliation, and
 * the per-account SyncAttempt health record.
 */
export async function runPaidSyncJob(
  input: {
    workspaceId: string;
    range: MetricRange;
    trigger: PaidSyncJobTrigger;
    platformFilter?: string;
  },
  dependencies: { syncPaidWorkspace?: PaidSyncJobRunner } = {},
): Promise<PaidSyncJobSummary> {
  const platforms = paidPlatformsForFilter(input.platformFilter);
  if (platforms.length === 0) return { connections: 0, metrics: 0 };

  const syncPaidWorkspace = dependencies.syncPaidWorkspace ?? (async (syncInput) => {
    const paidSync = await import("@/lib/connectors/paid-sync");
    return paidSync.syncPaidWorkspace(syncInput);
  });
  const result = await syncPaidWorkspace({
    workspaceId: input.workspaceId,
    range: input.range,
    trigger: input.trigger,
    platforms,
  });

  return {
    connections: new Set(result.results.map((account) => account.connectionId)).size,
    metrics: result.results.reduce(
      (total, account) => total + (account.phases.metrics.complete ? account.phases.metrics.rows : 0),
      0,
    ),
  };
}
