export const PAID_AUTO_SYNC_INTERVAL_MS = 5 * 60 * 1000;
export const PAID_AUTO_SYNC_CHECK_MS = 60 * 1000;
export const PAID_AUTO_SYNC_RANGE_COOLDOWN_MS = 30 * 1000;

interface RecentAttempt {
  status: string;
  startedAt: Date;
  completedAt: Date | null;
  requestedFrom: Date;
  requestedTo: Date;
  metricsStatus: string;
  campaignsStatus: string;
  adsStatus: string;
  errorCode?: string | null;
}

/** Used under the account lock, so multiple tabs cannot race the freshness check. */
export function paidAutoSyncSkipReason(
  attempts: RecentAttempt[],
  range: { from: Date; to: Date },
  now: Date,
): "fresh" | "cooldown" | null {
  const recent = attempts.filter((attempt) => attempt.errorCode !== "sync_abandoned"
    && (attempt.completedAt ?? attempt.startedAt).getTime() > now.getTime() - PAID_AUTO_SYNC_INTERVAL_MS);
  const latest = [...recent].sort((a, b) => b.startedAt.getTime() - a.startedAt.getTime())[0];
  if (latest && latest.status !== "succeeded") return "cooldown";
  if (recent.some((attempt) =>
    attempt.status === "succeeded"
    && attempt.metricsStatus === "succeeded"
    && attempt.campaignsStatus === "succeeded"
    && attempt.adsStatus === "succeeded"
    && attempt.requestedFrom <= range.from && attempt.requestedTo >= range.to
  )) return "fresh";
  if (latest && (latest.completedAt ?? latest.startedAt).getTime() > now.getTime() - PAID_AUTO_SYNC_RANGE_COOLDOWN_MS) return "cooldown";
  return null;
}
