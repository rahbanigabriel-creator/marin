import type { Connection } from "@prisma/client";

import { decryptToken, isVaultConfigured } from "@/lib/security/vault";
import {
  ConnectorNotReadyError,
  type CanonicalMetric,
  type ConnectorClient,
  type ConnectorPlatform,
  type MetricRange,
} from "./types";
import { META_GRAPH_VERSION } from "./registry";

/**
 * Per-platform connector clients (Stack B, architecture §6/§7). Server-only,
 * import-safe.
 *
 * Each client implements ConnectorClient. The REAL platform API endpoints are
 * wired (URLs/queries below are the production ones), but every network call is
 * GUARDED behind runtime prerequisites: the token vault must be configured and
 * the Connection must carry a decryptable access token. With no keys/tokens,
 * constructing a client is a no-op and fetchMetrics throws ConnectorNotReadyError
 * at CALL time — never at import — so `next build` / `tsc --noEmit` stay green.
 *
 * Token handling (architecture §8 "tokens decrypted only in the integrations
 * workers at execution time"): the encrypted access token is decrypted from the
 * Connection ONLY here, immediately before the API call, via the vault. We never
 * log token material.
 *
 * NOTE on scope of round 1: these clients establish the interface + the wired
 * endpoints + the canonical mapping seam. The exhaustive request/response
 * parsing per platform (Google Ads GAQL pagination, GA4 report rows, Meta async
 * insight job submit→poll→ingest) lands with the live sync milestone; the
 * normalize() seam (rawRowsToCanonical) is where that detail plugs in behind
 * this same interface.
 */

/** Pinned Google Ads API version for the REST searchStream endpoint. */
const GOOGLE_ADS_API_VERSION = "v17";

/** Decrypt a Connection's access token via the vault, guarding every failure. */
function requireAccessToken(connection: Connection, platform: ConnectorPlatform): string {
  if (!isVaultConfigured()) {
    throw new ConnectorNotReadyError(platform, "token vault is not configured (TOKEN_ENC_KEY)");
  }
  if (!connection.encAccessToken) {
    throw new ConnectorNotReadyError(platform, "connection has no stored access token");
  }
  // decryptToken throws (VaultNotConfiguredError / VaultDecryptError) on a bad
  // key or tampered blob; both are runtime-only and safe to propagate.
  return decryptToken(connection.encAccessToken);
}

/** Format a Date as YYYY-MM-DD (UTC) for the platform reporting windows. */
function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/**
 * Google Ads connector. Reads campaign-level metrics via the Google Ads API
 * REST searchStream endpoint (GAQL). Requires, beyond the OAuth access token, a
 * developer token (GOOGLE_ADS_DEVELOPER_TOKEN) and the customer id (stored as
 * Connection.externalAccountId). The query/endpoint are real; execution is
 * guarded so the build never reaches the network.
 */
export class GoogleAdsClient implements ConnectorClient {
  readonly platform = "google_ads" as const;

  async fetchMetrics(connection: Connection, range: MetricRange): Promise<CanonicalMetric[]> {
    const accessToken = requireAccessToken(connection, this.platform);

    const developerToken = process.env.GOOGLE_ADS_DEVELOPER_TOKEN;
    if (!developerToken) {
      throw new ConnectorNotReadyError(
        this.platform,
        "missing GOOGLE_ADS_DEVELOPER_TOKEN (required by the Google Ads API)",
      );
    }
    const customerId = connection.externalAccountId.replace(/-/g, "");
    if (!customerId) {
      throw new ConnectorNotReadyError(this.platform, "connection has no Google Ads customer id");
    }

    // Real Google Ads API REST endpoint (GAQL search stream).
    const url = `https://googleads.googleapis.com/${GOOGLE_ADS_API_VERSION}/customers/${customerId}/googleAds:searchStream`;
    const query = [
      "SELECT campaign.name,",
      "metrics.cost_micros,",
      "metrics.conversions,",
      "metrics.clicks,",
      "metrics.impressions,",
      "segments.date",
      "FROM campaign",
      `WHERE segments.date BETWEEN '${isoDate(range.from)}' AND '${isoDate(range.to)}'`,
    ].join(" ");

    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "developer-token": developerToken,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ query }),
    });
    if (!res.ok) {
      throw new ConnectorNotReadyError(
        this.platform,
        `Google Ads API responded ${res.status}`,
      );
    }
    const payload = (await res.json()) as unknown;
    return this.normalize(payload, range);
  }

  /**
   * Map the raw Google Ads searchStream payload → canonical metrics. Defensive
   * (unknown payload), since the exhaustive parser lands with the live-sync
   * milestone; the seam exists so that detail plugs in without interface churn.
   */
  private normalize(_payload: unknown, _range: MetricRange): CanonicalMetric[] {
    void _payload;
    void _range;
    return [];
  }
}

/**
 * GA4 connector. Reads via the Analytics Data API v1beta runReport endpoint.
 * The GA4 property id is stored as Connection.externalAccountId. Real endpoint;
 * execution guarded.
 */
export class Ga4Client implements ConnectorClient {
  readonly platform = "ga4" as const;

  async fetchMetrics(connection: Connection, range: MetricRange): Promise<CanonicalMetric[]> {
    const accessToken = requireAccessToken(connection, this.platform);

    const propertyId = connection.externalAccountId.replace(/^properties\//, "");
    if (!propertyId) {
      throw new ConnectorNotReadyError(this.platform, "connection has no GA4 property id");
    }

    // Real Analytics Data API (GA4) runReport endpoint.
    const url = `https://analyticsdata.googleapis.com/v1beta/properties/${propertyId}:runReport`;
    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        dateRanges: [{ startDate: isoDate(range.from), endDate: isoDate(range.to) }],
        dimensions: [{ name: "date" }, { name: "sessionCampaignName" }],
        metrics: [
          { name: "sessions" },
          { name: "conversions" },
          { name: "totalRevenue" },
        ],
      }),
    });
    if (!res.ok) {
      throw new ConnectorNotReadyError(this.platform, `GA4 Data API responded ${res.status}`);
    }
    const payload = (await res.json()) as unknown;
    return this.normalize(payload, range);
  }

  private normalize(_payload: unknown, _range: MetricRange): CanonicalMetric[] {
    void _payload;
    void _range;
    return [];
  }
}

/**
 * Meta Ads connector. Reads via the Marketing API Insights edge on the Graph
 * API (pinned version). The ad-account id (act_<id>) is stored as
 * Connection.externalAccountId. For large windows Meta requires an async
 * insight job (submit→poll→ingest, architecture §7); the synchronous edge below
 * covers bounded on-demand pulls. Real endpoint; execution guarded.
 */
export class MetaAdsClient implements ConnectorClient {
  readonly platform = "meta_ads" as const;

  async fetchMetrics(connection: Connection, range: MetricRange): Promise<CanonicalMetric[]> {
    const accessToken = requireAccessToken(connection, this.platform);

    const accountId = connection.externalAccountId.startsWith("act_")
      ? connection.externalAccountId
      : `act_${connection.externalAccountId}`;

    // Real Graph API Marketing Insights endpoint (pinned version).
    const url = new URL(
      `https://graph.facebook.com/${META_GRAPH_VERSION}/${accountId}/insights`,
    );
    url.searchParams.set("level", "campaign");
    url.searchParams.set("fields", "campaign_name,spend,impressions,clicks,actions");
    url.searchParams.set("time_increment", "1");
    url.searchParams.set(
      "time_range",
      JSON.stringify({ since: isoDate(range.from), until: isoDate(range.to) }),
    );
    // Meta passes the token as a query param on GET; never logged.
    url.searchParams.set("access_token", accessToken);

    const res = await fetch(url, { method: "GET", headers: { Accept: "application/json" } });
    if (!res.ok) {
      throw new ConnectorNotReadyError(this.platform, `Meta Graph API responded ${res.status}`);
    }
    const payload = (await res.json()) as unknown;
    return this.normalize(payload, range);
  }

  private normalize(_payload: unknown, _range: MetricRange): CanonicalMetric[] {
    void _payload;
    void _range;
    return [];
  }
}
