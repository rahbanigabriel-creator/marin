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

/** Every marketing channel Marpin can connect (paid ads + organic/SEO). */
export type ConnectorPlatform =
  // ── Paid ads ──
  | "google_ads"
  | "meta_ads"
  | "tiktok_ads"
  | "linkedin_ads"
  | "microsoft_ads"
  | "pinterest_ads"
  | "snapchat_ads"
  | "reddit_ads"
  | "x_ads"
  | "amazon_ads"
  | "apple_search_ads"
  // ── Organic / SEO / analytics ──
  | "ga4"
  | "search_console";

/** Marketing-channel category — drives the Paid vs Organic split in the UI. */
export type ConnectorCategory = "paid" | "organic";

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
/**
 * Campaign CONFIGURATION (not performance) — status, budget, objective for the
 * command center. Emitted by `fetchCampaigns` and upserted into the Campaign
 * entity (prisma `campaigns`). All config fields are optional: a platform may
 * not expose budget/objective, and metrics-only platforms implement no
 * `fetchCampaigns` at all. `name`/`externalId` let the dashboard join config
 * onto MetricFact rows (which key performance by campaign name or id).
 */
export interface CampaignConfig {
  platform: ConnectorPlatform;
  externalId: string;
  name: string;
  status?: string | null;
  objective?: string | null;
  /** Budget in account-currency MAJOR units (e.g. euros), or null. */
  budget?: number | null;
  budgetType?: "daily" | "lifetime" | null;
  currency?: string | null;
}

/**
 * An individual AD with its CREATIVE and a performance snapshot over the
 * requested window — the level below CampaignConfig. Emitted by `fetchAds` and
 * upserted into the Ad entity so the workspace (and the agent) can see the
 * actual running creatives, their copy, and how each performs. Joined to a
 * campaign by `campaignExternalId`/`campaignName`. All fields beyond id/name are
 * optional: a platform may not expose creatives or per-ad metrics.
 */
export interface AdCreative {
  platform: ConnectorPlatform;
  externalId: string; // the platform's ad id
  campaignExternalId?: string | null;
  campaignName?: string | null;
  adsetName?: string | null;
  name: string;
  status?: string | null;
  /** image | video | carousel | text */
  creativeType?: string | null;
  /** Platform CDN preview URL (best-effort; may expire). */
  thumbnailUrl?: string | null;
  /** Creative headline. */
  title?: string | null;
  /** Creative primary text / body copy. */
  body?: string | null;
  /** Human-readable call-to-action label, e.g. "Install Now", "Shop Now". */
  callToAction?: string | null;
  linkUrl?: string | null;
  // Performance snapshot over the requested window:
  spend?: number | null;
  impressions?: number | null;
  clicks?: number | null;
  conversions?: number | null;
}

export interface ConnectorClient {
  readonly platform: ConnectorPlatform;
  fetchMetrics(connection: Connection, range: MetricRange): Promise<CanonicalMetric[]>;
  /**
   * Optional config read: campaign status/budget/objective. Implemented only by
   * platforms with a campaigns endpoint (Meta, Google Ads today). Like
   * fetchMetrics, it MUST NOT touch the network at construction — only when
   * called, after feature-detecting config/tokens.
   */
  fetchCampaigns?(connection: Connection): Promise<CampaignConfig[]>;
  /**
   * Optional ad + creative read with a per-ad performance snapshot over `range`.
   * Implemented by platforms with an ads/creative endpoint (Meta today). Same
   * import-safety rule as fetchMetrics: no network at construction.
   */
  fetchAds?(connection: Connection, range: MetricRange): Promise<AdCreative[]>;
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
