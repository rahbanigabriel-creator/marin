import type { Connection } from "@prisma/client";

/**
 * Connector type contracts (Stack B, architecture §6 & §7). Server-only.
 *
 * These are pure type/interface declarations plus a small canonical-metric
 * shape — no env access, no SDK construction, no network. Importing this module
 * is always safe (graceful-without-keys): nothing here runs at import/build
 * time. The per-platform client classes (./clients) implement ConnectorClient;
 * the registry (./registry) wires platform → config + client.
 */

/** The platforms we ship in connectors round 1. */
export type ConnectorPlatform = "google_ads" | "ga4" | "meta_ads";

/** A normalized date range for a metrics pull (inclusive `from`/`to`). */
export interface MetricRange {
  from: Date;
  to: Date;
}

/**
 * One canonical, platform-normalized metric point. This is the unit every
 * connector emits and the warehouse stores (maps onto prisma MetricFact:
 * workspace×platform×date×campaign×metric → value). `campaign` is optional at
 * the connector boundary; the warehouse upsert applies the "" account-level
 * sentinel (see prisma/schema.prisma MetricFact note).
 *
 * `metric` is a CANONICAL name (spend | roas | cpa | conversions | impressions
 * | clicks | revenue | ...), not a platform-specific column — identity/entity
 * resolution and the multi-measure attribution model (§6) live above this.
 */
export interface CanonicalMetric {
  platform: ConnectorPlatform;
  date: Date;
  campaign?: string;
  metric: string;
  value: number;
}

/**
 * The contract every per-platform client implements. `fetchMetrics` is the
 * read path: given a persisted Connection (whose encrypted tokens the client
 * decrypts via the vault at call time) and a date range, it returns canonical
 * metrics. Implementations MUST NOT touch the network at construction — only
 * inside fetchMetrics, and only after feature-detecting config/tokens — so the
 * module graph stays import-safe and the build is green with no keys.
 */
export interface ConnectorClient {
  readonly platform: ConnectorPlatform;
  fetchMetrics(connection: Connection, range: MetricRange): Promise<CanonicalMetric[]>;
}

/**
 * Thrown by a connector client when it is invoked without the runtime
 * prerequisites (platform not configured, or the Connection has no usable
 * token). Never thrown at import — only when fetchMetrics is actually called.
 */
export class ConnectorNotReadyError extends Error {
  constructor(
    public readonly platform: ConnectorPlatform,
    detail: string,
  ) {
    super(`Connector "${platform}" is not ready: ${detail}`);
    this.name = "ConnectorNotReadyError";
  }
}
