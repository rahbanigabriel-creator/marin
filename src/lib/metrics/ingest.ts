import { prisma, isDatabaseConfigured } from "@/lib/db";
import type { CanonicalMetric, ConnectorPlatform } from "@/lib/connectors/types";

/**
 * Metric ingestion (Stack B, architecture §6). Server-only.
 *
 * Writes canonical, platform-normalized metrics into the MetricFact warehouse.
 * Idempotent by the natural key (workspace, platform, date, campaign, metric):
 * platforms RESTATE recent conversions for days/weeks, so a re-pull of the same
 * day must update the value in place rather than duplicate it. We therefore
 * upsert on the compound @@unique, applying the "" account-level sentinel for
 * campaign-less facts (see prisma/schema.prisma MetricFact note).
 *
 * Graceful-without-keys (mirrors src/lib/db.ts / provider.ts): importing this
 * module never touches the database. ingestMetrics throws MetricIngestError only
 * when CALLED with no DATABASE_URL configured — never at import/build time — so
 * `npm run build` / `tsc --noEmit` stay green with no env. Callers ingest only
 * after a connector has produced data, which already implies a live deployment.
 *
 * The actual DB writer is injected behind the MetricUpsert seam, so this is
 * testable without a live database (stub the writer; assert the keys/values).
 */

export class MetricIngestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MetricIngestError";
  }
}

/** One normalized row ready for the warehouse natural key. */
export interface MetricFactInput {
  workspaceId: string;
  platform: ConnectorPlatform;
  date: Date;
  /** "" sentinel for account-level (campaign-less) facts. */
  campaign: string;
  metric: string;
  value: number;
}

/**
 * The injectable write seam: upsert one row on the natural key. The default
 * uses prisma's compound-unique upsert; tests pass a stub recorder.
 */
export type MetricUpsert = (row: MetricFactInput) => Promise<void>;

const defaultUpsert: MetricUpsert = async (row) => {
  await prisma.metricFact.upsert({
    where: {
      workspaceId_platform_date_campaign_metric: {
        workspaceId: row.workspaceId,
        platform: row.platform,
        date: row.date,
        campaign: row.campaign,
        metric: row.metric,
      },
    },
    update: { value: row.value },
    create: {
      workspaceId: row.workspaceId,
      platform: row.platform,
      date: row.date,
      campaign: row.campaign,
      metric: row.metric,
      value: row.value,
    },
  });
};

/**
 * Normalize a CanonicalMetric (connector boundary) into a warehouse row.
 * Applies the account-level "" campaign sentinel and truncates the date to
 * midnight UTC so restatements of the same calendar day collide on the natural
 * key (rather than producing one row per timestamp).
 */
export function toFactInput(
  workspaceId: string,
  platform: ConnectorPlatform,
  m: CanonicalMetric,
): MetricFactInput {
  const date = new Date(m.date);
  date.setUTCHours(0, 0, 0, 0);
  return {
    workspaceId,
    platform,
    date,
    campaign: m.campaign && m.campaign.length > 0 ? m.campaign : "",
    metric: m.metric,
    value: m.value,
  };
}

/**
 * Upsert canonical metrics for one workspace + platform. Idempotent: re-running
 * with the same (date, campaign, metric) updates the value in place. Returns the
 * number of rows written. Throws MetricIngestError if no DB is configured.
 *
 * `upsert` is injectable for tests; production omits it (real prisma upsert).
 */
export async function ingestMetrics(
  workspaceId: string,
  platform: ConnectorPlatform,
  rows: CanonicalMetric[],
  upsert: MetricUpsert = defaultUpsert,
): Promise<number> {
  if (!isDatabaseConfigured()) {
    throw new MetricIngestError(
      "DATABASE_URL is not set — cannot ingest metrics into the warehouse",
    );
  }
  if (rows.length === 0) return 0;

  let written = 0;
  for (const m of rows) {
    // Defensive: a connector should only emit its own platform, but the natural
    // key uses the explicit `platform` arg so the warehouse stays consistent.
    await upsert(toFactInput(workspaceId, platform, m));
    written += 1;
  }
  return written;
}
