import { createSign } from "node:crypto";

import type { Connection } from "@prisma/client";

import { prisma } from "@/lib/db";
import { decryptToken, encryptToken, isVaultConfigured, tokenAad } from "@/lib/security/vault";
import { refreshAccessToken } from "@/lib/connectors/oauth";
import {
  ConnectorNotReadyError,
  type AdCreative,
  type CampaignConfig,
  type CanonicalMetric,
  type ConnectorClient,
  type ConnectorPlatform,
  type MetricRange,
} from "./types";
import { CONNECTORS, META_GRAPH_VERSION } from "./registry";

const GOOGLE_ADS_API_VERSION = "v24";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GA4_ADMIN_URL = "https://analyticsadmin.googleapis.com/v1beta/accountSummaries";
const APPLE_TOKEN_URL = "https://appleid.apple.com/auth/oauth2/token";
const APPLE_SEARCH_ADS_API = "https://api.searchads.apple.com/api/v5";
const LINKEDIN_API = "https://api.linkedin.com/rest";
const LINKEDIN_VERSION = "202406";
const TIKTOK_API = "https://business-api.tiktok.com/open_api/v1.3";
const PINTEREST_API = "https://api.pinterest.com/v5";
const SNAPCHAT_API = "https://adsapi.snapchat.com/v1";
const SEARCH_CONSOLE_API = "https://www.googleapis.com/webmasters/v3";
const AMAZON_ADS_API = "https://advertising-api.amazon.com";

export interface AccountSelection {
  externalAccountId: string;
  displayName: string;
}

function requireAccessToken(connection: Connection, platform: ConnectorPlatform): string {
  if (!isVaultConfigured()) {
    throw new ConnectorNotReadyError(platform, "token vault is not configured (TOKEN_ENC_KEY)");
  }
  if (!connection.encAccessToken) {
    throw new ConnectorNotReadyError(platform, "connection has no stored access token");
  }
  return decryptToken(
    connection.encAccessToken,
    tokenAad({
      workspaceId: connection.workspaceId,
      platform: connection.platform,
      externalAccountId: connection.externalAccountId,
      tokenKind: "access",
    }),
  );
}

async function accessTokenFor(connection: Connection, platform: ConnectorPlatform): Promise<string> {
  if (
    connection.encRefreshToken &&
    connection.expiresAt &&
    connection.expiresAt.getTime() < Date.now() + 60_000
  ) {
    const refreshed = await refreshStoredToken(connection, platform);
    if (refreshed) return refreshed;
  }
  return requireAccessToken(connection, platform);
}

async function refreshStoredToken(connection: Connection, platform: ConnectorPlatform): Promise<string | null> {
  if (!connection.encRefreshToken) return null;
  const refreshToken = decryptToken(
    connection.encRefreshToken,
    tokenAad({
      workspaceId: connection.workspaceId,
      platform: connection.platform,
      externalAccountId: connection.externalAccountId,
      tokenKind: "refresh",
    }),
  );

  // Google-family connectors (Ads, GA4, Search Console) share the Google OAuth
  // app and refresh the same way; others use their long-lived stored token.
  if (platform !== "google_ads" && platform !== "ga4" && platform !== "search_console") return null;
  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
  if (!clientId || !clientSecret) return null;

  const refreshed = await refreshAccessToken({
    tokenUrl: GOOGLE_TOKEN_URL,
    clientId,
    clientSecret,
    refreshToken,
  });
  await prisma.connection.update({
    where: { id: connection.id },
    data: {
      encAccessToken: encryptToken(
        refreshed.accessToken,
        tokenAad({
          workspaceId: connection.workspaceId,
          platform: connection.platform,
          externalAccountId: connection.externalAccountId,
          tokenKind: "access",
        }),
      ),
      expiresAt: refreshed.expiresAt ?? connection.expiresAt,
      scopes: refreshed.scope ?? connection.scopes,
    },
  });
  return refreshed.accessToken;
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function compactDate(date: string): Date {
  if (/^\d{8}$/.test(date)) {
    return new Date(`${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6, 8)}T00:00:00.000Z`);
  }
  return new Date(`${date}T00:00:00.000Z`);
}

function n(value: unknown): number {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function rowsFor(input: {
  platform: ConnectorPlatform;
  date: Date;
  campaign?: string;
  spend?: number;
  revenue?: number;
  conversions?: number;
  impressions?: number;
  clicks?: number;
  sessions?: number;
}): CanonicalMetric[] {
  const out: CanonicalMetric[] = [];
  const add = (metric: string, value: number | undefined) => {
    if (value === undefined || !Number.isFinite(value)) return;
    out.push({ platform: input.platform, date: input.date, campaign: input.campaign, metric, value });
  };
  add("spend", input.spend);
  add("revenue", input.revenue);
  add("conversions", input.conversions);
  add("impressions", input.impressions);
  add("clicks", input.clicks);
  add("sessions", input.sessions);
  if (input.spend && input.revenue !== undefined) add("roas", input.revenue / input.spend);
  if (input.conversions && input.spend !== undefined) add("cpa", input.spend / input.conversions);
  return out;
}

function googleAdsHeaders(accessToken: string): HeadersInit {
  const developerToken = process.env.GOOGLE_ADS_DEVELOPER_TOKEN;
  if (!developerToken) {
    throw new ConnectorNotReadyError("google_ads", "missing GOOGLE_ADS_DEVELOPER_TOKEN");
  }
  const headers: Record<string, string> = {
    Authorization: `Bearer ${accessToken}`,
    "developer-token": developerToken,
    "Content-Type": "application/json",
  };
  if (process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID) {
    headers["login-customer-id"] = process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID.replace(/-/g, "");
  }
  return headers;
}

interface GoogleAdsBatch {
  results?: Array<{
    campaign?: { name?: string };
    customer?: { id?: string; descriptiveName?: string };
    metrics?: {
      costMicros?: string | number;
      conversions?: string | number;
      conversionsValue?: string | number;
      clicks?: string | number;
      impressions?: string | number;
    };
    segments?: { date?: string };
  }>;
}

export class GoogleAdsClient implements ConnectorClient {
  readonly platform = "google_ads" as const;

  async fetchMetrics(connection: Connection, range: MetricRange): Promise<CanonicalMetric[]> {
    const accessToken = await accessTokenFor(connection, this.platform);
    const customerId = connection.externalAccountId.replace(/-/g, "");
    if (!customerId) {
      throw new ConnectorNotReadyError(this.platform, "connection has no Google Ads customer id");
    }

    const url = `https://googleads.googleapis.com/${GOOGLE_ADS_API_VERSION}/customers/${customerId}/googleAds:searchStream`;
    const query = [
      "SELECT campaign.name, metrics.cost_micros, metrics.conversions,",
      "metrics.conversions_value, metrics.clicks, metrics.impressions, segments.date",
      "FROM campaign",
      `WHERE segments.date BETWEEN '${isoDate(range.from)}' AND '${isoDate(range.to)}'`,
      "ORDER BY segments.date",
    ].join(" ");

    const res = await fetch(url, {
      method: "POST",
      headers: googleAdsHeaders(accessToken),
      body: JSON.stringify({ query }),
    });
    if (!res.ok) {
      throw new ConnectorNotReadyError(this.platform, `Google Ads API responded ${res.status}`);
    }
    return this.normalize((await res.json()) as GoogleAdsBatch[]);
  }

  private normalize(payload: GoogleAdsBatch[]): CanonicalMetric[] {
    const batches = Array.isArray(payload) ? payload : [];
    return batches.flatMap((batch) =>
      (batch.results ?? []).flatMap((row) => {
        const date = row.segments?.date ? compactDate(row.segments.date) : new Date();
        const spend = n(row.metrics?.costMicros) / 1_000_000;
        return rowsFor({
          platform: this.platform,
          date,
          campaign: row.campaign?.name,
          spend,
          revenue: n(row.metrics?.conversionsValue),
          conversions: n(row.metrics?.conversions),
          clicks: n(row.metrics?.clicks),
          impressions: n(row.metrics?.impressions),
        });
      }),
    );
  }

  async fetchCampaigns(connection: Connection): Promise<CampaignConfig[]> {
    const accessToken = await accessTokenFor(connection, this.platform);
    const customerId = connection.externalAccountId.replace(/-/g, "");
    if (!customerId) {
      throw new ConnectorNotReadyError(this.platform, "connection has no Google Ads customer id");
    }
    const url = `https://googleads.googleapis.com/${GOOGLE_ADS_API_VERSION}/customers/${customerId}/googleAds:searchStream`;
    const query = [
      "SELECT campaign.id, campaign.name, campaign.status,",
      "campaign.advertising_channel_type, campaign_budget.amount_micros,",
      "campaign_budget.period, customer.currency_code",
      "FROM campaign",
      "WHERE campaign.status != 'REMOVED'",
    ].join(" ");
    const res = await fetch(url, {
      method: "POST",
      headers: googleAdsHeaders(accessToken),
      body: JSON.stringify({ query }),
    });
    if (!res.ok) {
      throw new ConnectorNotReadyError(this.platform, `Google Ads campaigns API responded ${res.status}`);
    }
    const batches = (await res.json()) as GoogleAdsCampaignBatch[];
    const out: CampaignConfig[] = [];
    for (const batch of Array.isArray(batches) ? batches : []) {
      for (const row of batch.results ?? []) {
        const id = row.campaign?.id;
        const name = row.campaign?.name;
        if (id == null || !name) continue;
        const micros = n(row.campaignBudget?.amountMicros);
        // amount_micros is per-day only for a DAILY budget period; a custom/total
        // period reports a total, so label it lifetime rather than mislabel daily.
        const period = (row.campaignBudget?.period ?? "").toUpperCase();
        out.push({
          platform: this.platform,
          externalId: String(id),
          name,
          status: googleStatus(row.campaign?.status),
          objective: prettyToken(row.campaign?.advertisingChannelType),
          budget: micros > 0 ? micros / 1_000_000 : null,
          budgetType: micros > 0 ? (period === "" || period.includes("DAILY") ? "daily" : "lifetime") : null,
          currency: row.customer?.currencyCode ?? null,
        });
      }
    }
    return out;
  }
}

interface GoogleAdsCampaignBatch {
  results?: Array<{
    campaign?: { id?: string | number; name?: string; status?: string; advertisingChannelType?: string };
    campaignBudget?: { amountMicros?: string | number; period?: string };
    customer?: { currencyCode?: string };
  }>;
}

/** ENABLED/PAUSED/REMOVED → normalized lower-case status. */
function googleStatus(s: string | undefined): string | null {
  if (!s) return null;
  const v = s.toUpperCase();
  if (v === "ENABLED") return "active";
  if (v === "PAUSED") return "paused";
  if (v === "REMOVED") return "removed";
  return s.toLowerCase();
}

/** SCREAMING_SNAKE platform token → Title Case label (channel type, objective). */
function prettyToken(t: string | undefined): string | null {
  if (!t) return null;
  return t
    .replace(/^OUTCOME_/, "")
    .replace(/_/g, " ")
    .toLowerCase()
    .replace(/\b\w/g, (m) => m.toUpperCase());
}

interface Ga4Report {
  rows?: Array<{
    dimensionValues?: Array<{ value?: string }>;
    metricValues?: Array<{ value?: string }>;
  }>;
}

export class Ga4Client implements ConnectorClient {
  readonly platform = "ga4" as const;

  async fetchMetrics(connection: Connection, range: MetricRange): Promise<CanonicalMetric[]> {
    const accessToken = await accessTokenFor(connection, this.platform);
    const propertyId = connection.externalAccountId.replace(/^properties\//, "");
    if (!propertyId) {
      throw new ConnectorNotReadyError(this.platform, "connection has no GA4 property id");
    }

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
        metrics: [{ name: "sessions" }, { name: "conversions" }, { name: "totalRevenue" }],
      }),
    });
    if (!res.ok) {
      throw new ConnectorNotReadyError(this.platform, `GA4 Data API responded ${res.status}`);
    }
    return this.normalize((await res.json()) as Ga4Report);
  }

  private normalize(payload: Ga4Report): CanonicalMetric[] {
    return (payload.rows ?? []).flatMap((row) => {
      const date = compactDate(row.dimensionValues?.[0]?.value ?? isoDate(new Date()));
      const campaignValue = row.dimensionValues?.[1]?.value;
      const campaign =
        campaignValue && campaignValue !== "(not set)" && campaignValue !== "(direct)"
          ? campaignValue
          : undefined;
      return rowsFor({
        platform: this.platform,
        date,
        campaign,
        sessions: n(row.metricValues?.[0]?.value),
        conversions: n(row.metricValues?.[1]?.value),
        revenue: n(row.metricValues?.[2]?.value),
      });
    });
  }
}

interface MetaInsights {
  data?: Array<{
    campaign_name?: string;
    spend?: string;
    impressions?: string;
    clicks?: string;
    actions?: Array<{ action_type?: string; value?: string }>;
    action_values?: Array<{ action_type?: string; value?: string }>;
    purchase_roas?: Array<{ value?: string }>;
    date_start?: string;
  }>;
  paging?: { next?: string };
}

export class MetaAdsClient implements ConnectorClient {
  readonly platform = "meta_ads" as const;

  async fetchMetrics(connection: Connection, range: MetricRange): Promise<CanonicalMetric[]> {
    const accessToken = await accessTokenFor(connection, this.platform);
    const accountId = connection.externalAccountId.startsWith("act_")
      ? connection.externalAccountId
      : `act_${connection.externalAccountId}`;

    const url = new URL(`https://graph.facebook.com/${META_GRAPH_VERSION}/${accountId}/insights`);
    url.searchParams.set("level", "campaign");
    url.searchParams.set(
      "fields",
      "campaign_name,spend,impressions,clicks,actions,action_values,purchase_roas,date_start",
    );
    url.searchParams.set("time_increment", "1");
    url.searchParams.set("time_range", JSON.stringify({ since: isoDate(range.from), until: isoDate(range.to) }));
    url.searchParams.set("access_token", accessToken);

    const rows: CanonicalMetric[] = [];
    let next: string | undefined = url.toString();
    while (next) {
      const res = await fetch(next, { method: "GET", headers: { Accept: "application/json" } });
      if (!res.ok) {
        throw new ConnectorNotReadyError(this.platform, `Meta Graph API responded ${res.status}`);
      }
      const payload = (await res.json()) as MetaInsights;
      rows.push(...this.normalize(payload));
      next = payload.paging?.next;
    }
    return rows;
  }

  private normalize(payload: MetaInsights): CanonicalMetric[] {
    return (payload.data ?? []).flatMap((row) => {
      const spend = n(row.spend);
      // The campaign's RESULT — count the dominant conversion event (installs,
      // registrations, leads, purchases…), not just purchases. Each category
      // de-dupes the omni_* / specific variants (Meta reports both with the same
      // value), and we take the largest category as the optimization result so
      // an app-install campaign reads its installs, an e-commerce one its sales.
      const conversions = metaConversions(row.actions);
      const actionRevenue = actionValue(row.action_values, [
        "purchase",
        "offsite_conversion.fb_pixel_purchase",
        "onsite_conversion.purchase",
        "omni_purchase",
      ]);
      const revenue = actionRevenue || spend * n(row.purchase_roas?.[0]?.value);
      return rowsFor({
        platform: this.platform,
        date: compactDate(row.date_start ?? isoDate(new Date())),
        campaign: row.campaign_name,
        spend,
        revenue,
        conversions,
        clicks: n(row.clicks),
        impressions: n(row.impressions),
      });
    });
  }

  async fetchCampaigns(connection: Connection): Promise<CampaignConfig[]> {
    const accessToken = await accessTokenFor(connection, this.platform);
    const accountId = connection.externalAccountId.startsWith("act_")
      ? connection.externalAccountId
      : `act_${connection.externalAccountId}`;

    // Resolve the account currency once so budget minor-units convert correctly:
    // most currencies use 1/100, but zero-decimal (JPY, KRW…) use 1/1.
    const currency = await metaAccountCurrency(accountId, accessToken);
    const divisor = minorUnitDivisor(currency);

    const url = new URL(`https://graph.facebook.com/${META_GRAPH_VERSION}/${accountId}/campaigns`);
    url.searchParams.set("fields", "id,name,status,effective_status,objective,daily_budget,lifetime_budget");
    url.searchParams.set("limit", "200");
    url.searchParams.set("access_token", accessToken);

    const out: CampaignConfig[] = [];
    let next: string | undefined = url.toString();
    while (next) {
      const res = await fetch(next, { method: "GET", headers: { Accept: "application/json" } });
      if (!res.ok) {
        throw new ConnectorNotReadyError(this.platform, `Meta campaigns API responded ${res.status}`);
      }
      const payload = (await res.json()) as MetaCampaignsResponse;
      for (const c of payload.data ?? []) {
        if (!c.id || !c.name) continue;
        // Meta budgets are MINOR units as strings; null when budget is set at the
        // ad-set level (campaign-level budget absent).
        const daily = n(c.daily_budget);
        const lifetime = n(c.lifetime_budget);
        const budget = daily > 0 ? daily / divisor : lifetime > 0 ? lifetime / divisor : null;
        out.push({
          platform: this.platform,
          externalId: c.id,
          name: c.name,
          status: metaStatus(c.effective_status ?? c.status),
          objective: prettyToken(c.objective),
          budget,
          budgetType: daily > 0 ? "daily" : lifetime > 0 ? "lifetime" : null,
          currency,
        });
      }
      next = payload.paging?.next;
    }
    return out;
  }

  async fetchAds(connection: Connection, range: MetricRange): Promise<AdCreative[]> {
    const accessToken = await accessTokenFor(connection, this.platform);
    const accountId = connection.externalAccountId.startsWith("act_")
      ? connection.externalAccountId
      : `act_${connection.externalAccountId}`;

    // 1) Per-ad performance over the window (one aggregate row per ad).
    const perf = await this.fetchAdInsights(accountId, accessToken, range);

    // 2) Ads + their creative (config). Paginated.
    const url = new URL(`https://graph.facebook.com/${META_GRAPH_VERSION}/${accountId}/ads`);
    url.searchParams.set(
      "fields",
      [
        "id,name,status,effective_status,campaign_id,adset{name}",
        "campaign{name}",
        "creative{thumbnail_url,image_url,title,body,object_type,call_to_action_type," +
          "object_story_spec{link_data{message,name,link,call_to_action{type},child_attachments{link}}," +
          "video_data{message,title,call_to_action{type}}}}",
      ].join(","),
    );
    url.searchParams.set("limit", "100");
    url.searchParams.set("access_token", accessToken);

    const out: AdCreative[] = [];
    let next: string | undefined = url.toString();
    while (next) {
      const res = await fetch(next, { method: "GET", headers: { Accept: "application/json" } });
      if (!res.ok) {
        throw new ConnectorNotReadyError(this.platform, `Meta ads API responded ${res.status}`);
      }
      const payload = (await res.json()) as MetaAdsResponse;
      for (const ad of payload.data ?? []) {
        if (!ad.id || !ad.name) continue;
        const creative = extractMetaCreative(ad.creative);
        const p = perf.get(ad.id);
        out.push({
          platform: this.platform,
          externalId: ad.id,
          campaignExternalId: ad.campaign_id ?? null,
          campaignName: ad.campaign?.name ?? null,
          adsetName: ad.adset?.name ?? null,
          name: ad.name,
          // effective_status is the REAL delivery state (carries CAMPAIGN_PAUSED /
          // ADSET_PAUSED / DISAPPROVED that the configured `status` hides).
          status: metaStatus(ad.effective_status ?? ad.status),
          creativeType: creative.creativeType,
          thumbnailUrl: creative.thumbnailUrl,
          title: creative.title,
          body: creative.body,
          callToAction: prettyToken(creative.callToAction ?? undefined),
          linkUrl: creative.linkUrl,
          spend: p?.spend ?? null,
          impressions: p?.impressions ?? null,
          clicks: p?.clicks ?? null,
          conversions: p?.conversions ?? null,
        });
      }
      next = payload.paging?.next;
    }
    return out;
  }

  /** Aggregate per-ad insights over the window → map keyed by ad id. */
  private async fetchAdInsights(
    accountId: string,
    accessToken: string,
    range: MetricRange,
  ): Promise<Map<string, { spend: number; impressions: number; clicks: number; conversions: number }>> {
    const map = new Map<string, { spend: number; impressions: number; clicks: number; conversions: number }>();
    const url = new URL(`https://graph.facebook.com/${META_GRAPH_VERSION}/${accountId}/insights`);
    url.searchParams.set("level", "ad");
    url.searchParams.set("fields", "ad_id,spend,impressions,clicks,actions");
    url.searchParams.set("time_range", JSON.stringify({ since: isoDate(range.from), until: isoDate(range.to) }));
    url.searchParams.set("limit", "300");
    url.searchParams.set("access_token", accessToken);

    let next: string | undefined = url.toString();
    while (next) {
      const res = await fetch(next, { method: "GET", headers: { Accept: "application/json" } });
      if (!res.ok) {
        // Best-effort: ads still render without perf. Log so a token/permission
        // failure (which would leave every ad at €0) is diagnosable, not silent.
        console.warn(`[meta] ad insights responded ${res.status}; ads will show without a performance snapshot`);
        break;
      }
      const payload = (await res.json()) as MetaAdInsightsResponse;
      for (const row of payload.data ?? []) {
        if (!row.ad_id) continue;
        map.set(row.ad_id, {
          spend: n(row.spend),
          impressions: n(row.impressions),
          clicks: n(row.clicks),
          conversions: metaConversions(row.actions),
        });
      }
      next = payload.paging?.next;
    }
    return map;
  }
}

interface MetaAdsResponse {
  data?: Array<{
    id?: string;
    name?: string;
    status?: string;
    effective_status?: string;
    campaign_id?: string;
    campaign?: { name?: string };
    adset?: { name?: string };
    creative?: MetaCreative;
  }>;
  paging?: { next?: string };
}

interface MetaCreative {
  thumbnail_url?: string;
  image_url?: string;
  title?: string;
  body?: string;
  object_type?: string;
  call_to_action_type?: string;
  object_story_spec?: {
    link_data?: {
      message?: string;
      name?: string;
      link?: string;
      call_to_action?: { type?: string };
      child_attachments?: Array<{ link?: string }>;
    };
    video_data?: { message?: string; title?: string; call_to_action?: { type?: string } };
  };
}

interface MetaAdInsightsResponse {
  data?: Array<{
    ad_id?: string;
    spend?: string;
    impressions?: string;
    clicks?: string;
    actions?: Array<{ action_type?: string; value?: string }>;
  }>;
  paging?: { next?: string };
}

/** Pull headline/body/CTA/thumbnail out of Meta's nested creative shape. */
function extractMetaCreative(c: MetaCreative | undefined): {
  creativeType: string | null;
  thumbnailUrl: string | null;
  title: string | null;
  body: string | null;
  callToAction: string | null;
  linkUrl: string | null;
} {
  if (!c) {
    return { creativeType: null, thumbnailUrl: null, title: null, body: null, callToAction: null, linkUrl: null };
  }
  const link = c.object_story_spec?.link_data;
  const video = c.object_story_spec?.video_data;
  const objType = (c.object_type ?? "").toUpperCase();
  const childCount = link?.child_attachments?.length ?? 0;
  // object_type=SHARE is Meta's generic container (link/carousel/dynamic), NOT a
  // photo signal — classify by concrete evidence: video_data → video, multi-card
  // child_attachments → carousel, else a thumbnail/image → image, else text.
  const creativeType =
    objType.includes("VIDEO") || video
      ? "video"
      : childCount > 1
        ? "carousel"
        : c.thumbnail_url || c.image_url
          ? "image"
          : "text";
  return {
    creativeType,
    thumbnailUrl: c.thumbnail_url ?? c.image_url ?? null,
    title: c.title ?? link?.name ?? video?.title ?? null,
    body: c.body ?? link?.message ?? video?.message ?? null,
    callToAction: c.call_to_action_type ?? link?.call_to_action?.type ?? video?.call_to_action?.type ?? null,
    linkUrl: link?.link ?? null,
  };
}

/** Read a Meta ad account's reporting currency (best-effort; null on failure). */
async function metaAccountCurrency(accountId: string, accessToken: string): Promise<string | null> {
  try {
    const url = new URL(`https://graph.facebook.com/${META_GRAPH_VERSION}/${accountId}`);
    url.searchParams.set("fields", "currency");
    url.searchParams.set("access_token", accessToken);
    const res = await fetch(url.toString(), { headers: { Accept: "application/json" } });
    if (!res.ok) return null;
    const j = (await res.json()) as { currency?: string };
    return j.currency ?? null;
  } catch {
    return null;
  }
}

/** Zero-decimal currencies (amounts already in major units — no /100). */
const ZERO_DECIMAL_CURRENCIES = new Set([
  "JPY", "KRW", "VND", "CLP", "ISK", "UGX", "PYG", "GNF", "RWF", "VUV",
  "XAF", "XOF", "XPF", "BIF", "DJF", "KMF", "MGA",
]);
/** Three-decimal currencies (minor unit is 1/1000). */
const THREE_DECIMAL_CURRENCIES = new Set(["BHD", "IQD", "JOD", "KWD", "LYD", "OMR", "TND"]);

/** Minor-unit → major-unit divisor for a currency (default 100). */
function minorUnitDivisor(currency: string | null): number {
  if (!currency) return 100;
  const c = currency.toUpperCase();
  if (ZERO_DECIMAL_CURRENCIES.has(c)) return 1;
  if (THREE_DECIMAL_CURRENCIES.has(c)) return 1000;
  return 100;
}

interface MetaCampaignsResponse {
  data?: Array<{
    id?: string;
    name?: string;
    status?: string;
    effective_status?: string;
    objective?: string;
    daily_budget?: string;
    lifetime_budget?: string;
  }>;
  paging?: { next?: string };
}

/**
 * Meta (effective_)status → normalized state. Handles the delivery-blocking
 * effective_status values (CAMPAIGN_PAUSED / ADSET_PAUSED → paused, DISAPPROVED /
 * WITH_ISSUES → rejected, PENDING_REVIEW / IN_PROCESS → in review) so the UI pill
 * and agent text reflect whether the ad is actually running.
 */
function metaStatus(s: string | undefined): string | null {
  if (!s) return null;
  const v = s.toLowerCase();
  if (v.includes("active")) return "active";
  if (v.includes("paused")) return "paused";
  if (v.includes("archived") || v.includes("deleted")) return "archived";
  if (v.includes("disapprov") || v.includes("with_issue")) return "rejected";
  if (v.includes("pending") || v.includes("in_process") || v.includes("review")) return "in review";
  return v;
}

function actionValue(actions: Array<{ action_type?: string; value?: string }> | undefined, names: string[]): number {
  return (actions ?? [])
    .filter((action) => action.action_type && names.includes(action.action_type))
    .reduce((sum, action) => sum + n(action.value), 0);
}

// Conversion categories for Meta "results". Each category lists equivalent
// action_types (the omni_* aggregate duplicates the specific event with the
// same value), so we count ONE per category. We then take the largest category
// as the campaign's optimization result.
const META_CONVERSION_CATEGORIES: ReadonlyArray<ReadonlyArray<string>> = [
  ["purchase", "offsite_conversion.fb_pixel_purchase", "onsite_conversion.purchase", "omni_purchase"],
  ["mobile_app_install", "app_install", "omni_app_install"],
  ["lead", "offsite_conversion.fb_pixel_lead", "onsite_conversion.lead_grouped", "omni_lead"],
  ["complete_registration", "offsite_conversion.fb_pixel_complete_registration", "omni_complete_registration"],
  ["subscribe", "omni_subscribe"],
  ["start_trial", "omni_start_trial"],
  ["add_to_cart", "offsite_conversion.fb_pixel_add_to_cart", "omni_add_to_cart"],
];

/**
 * Meta's `actions` array reports every tracked event, and omni_* duplicates the
 * specific event with the same value — so naively summing double-counts. We take
 * the dominant conversion CATEGORY (de-duped within category, largest across
 * categories) as the campaign's result: an app-install campaign reads its
 * installs, an e-commerce one its purchases.
 */
function metaConversions(actions: Array<{ action_type?: string; value?: string }> | undefined): number {
  if (!actions || actions.length === 0) return 0;
  const byType = new Map<string, number>();
  for (const a of actions) if (a.action_type) byType.set(a.action_type, n(a.value));
  let best = 0;
  for (const category of META_CONVERSION_CATEGORIES) {
    for (const type of category) {
      const v = byType.get(type);
      if (v !== undefined) {
        best = Math.max(best, v); // first present type per category — no omni_* double-count
        break;
      }
    }
  }
  return best;
}

interface LinkedInAnalytics {
  elements?: Array<{
    dateRange?: { start?: { year?: number; month?: number; day?: number } };
    costInLocalCurrency?: string | number;
    impressions?: string | number;
    clicks?: string | number;
    externalWebsiteConversions?: string | number;
    pivotValues?: string[];
  }>;
}

function linkedinHeaders(accessToken: string): HeadersInit {
  return {
    Authorization: `Bearer ${accessToken}`,
    "LinkedIn-Version": LINKEDIN_VERSION,
    "X-Restli-Protocol-Version": "2.0.0",
    Accept: "application/json",
  };
}

export class LinkedInAdsClient implements ConnectorClient {
  readonly platform = "linkedin_ads" as const;

  async fetchMetrics(connection: Connection, range: MetricRange): Promise<CanonicalMetric[]> {
    const accessToken = await accessTokenFor(connection, this.platform);
    const accountId = connection.externalAccountId.replace(/\D/g, "");
    if (!accountId) {
      throw new ConnectorNotReadyError(this.platform, "connection has no LinkedIn ad account id");
    }
    const dateRange =
      `(start:(year:${range.from.getUTCFullYear()},month:${range.from.getUTCMonth() + 1},day:${range.from.getUTCDate()}),` +
      `end:(year:${range.to.getUTCFullYear()},month:${range.to.getUTCMonth() + 1},day:${range.to.getUTCDate()}))`;

    const url = new URL(`${LINKEDIN_API}/adAnalytics`);
    url.searchParams.set("q", "analytics");
    url.searchParams.set("pivot", "CAMPAIGN");
    url.searchParams.set("timeGranularity", "DAILY");
    url.searchParams.set("dateRange", dateRange);
    url.searchParams.set("accounts", `List(urn:li:sponsoredAccount:${accountId})`);
    url.searchParams.set(
      "fields",
      "dateRange,costInLocalCurrency,impressions,clicks,externalWebsiteConversions,pivotValues",
    );

    const res = await fetch(url, { headers: linkedinHeaders(accessToken) });
    if (!res.ok) {
      throw new ConnectorNotReadyError(this.platform, `LinkedIn adAnalytics responded ${res.status}`);
    }
    return this.normalize((await res.json()) as LinkedInAnalytics);
  }

  private normalize(payload: LinkedInAnalytics): CanonicalMetric[] {
    return (payload.elements ?? []).flatMap((row) => {
      const start = row.dateRange?.start;
      const date = start?.year
        ? new Date(Date.UTC(start.year, (start.month ?? 1) - 1, start.day ?? 1))
        : new Date();
      const campaign = row.pivotValues?.[0]?.replace("urn:li:sponsoredCampaign:", "");
      return rowsFor({
        platform: this.platform,
        date,
        campaign,
        spend: n(row.costInLocalCurrency),
        conversions: n(row.externalWebsiteConversions),
        clicks: n(row.clicks),
        impressions: n(row.impressions),
      });
    });
  }
}

interface AppleReport {
  data?: {
    reportingDataResponse?: {
      row?: Array<{
        metadata?: { campaignName?: string };
        granularity?: Array<{
          date?: string;
          impressions?: string | number;
          taps?: string | number;
          installs?: string | number;
          totalInstalls?: string | number;
          localSpend?: { amount?: string | number };
        }>;
      }>;
    };
  };
}

export class AppleSearchAdsClient implements ConnectorClient {
  readonly platform = "apple_search_ads" as const;

  async fetchMetrics(connection: Connection, range: MetricRange): Promise<CanonicalMetric[]> {
    const token = await getAppleSearchAdsAccessToken();
    const orgId = connection.externalAccountId;
    if (!orgId) {
      throw new ConnectorNotReadyError(this.platform, "connection has no Apple Search Ads org id");
    }

    const res = await fetch(`${APPLE_SEARCH_ADS_API}/reports/campaigns`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token.accessToken}`,
        "Content-Type": "application/json",
        "X-AP-Context": `orgId=${orgId}`,
      },
      body: JSON.stringify({
        startTime: isoDate(range.from),
        endTime: isoDate(range.to),
        granularity: "DAILY",
        returnRowTotals: false,
        returnGrandTotals: false,
        returnRecordsWithNoMetrics: true,
        selector: {
          orderBy: [{ field: "localSpend", sortOrder: "DESCENDING" }],
          pagination: { offset: 0, limit: 1000 },
        },
      }),
    });
    if (!res.ok) {
      throw new ConnectorNotReadyError(this.platform, `Apple Search Ads API responded ${res.status}`);
    }
    return this.normalize((await res.json()) as AppleReport);
  }

  private normalize(payload: AppleReport): CanonicalMetric[] {
    const campaigns = payload.data?.reportingDataResponse?.row ?? [];
    return campaigns.flatMap((campaign) =>
      (campaign.granularity ?? []).flatMap((day) =>
        rowsFor({
          platform: this.platform,
          date: compactDate(day.date ?? isoDate(new Date())),
          campaign: campaign.metadata?.campaignName,
          spend: n(day.localSpend?.amount),
          impressions: n(day.impressions),
          clicks: n(day.taps),
          conversions: n(day.totalInstalls) || n(day.installs),
        }),
      ),
    );
  }
}

// ── TikTok Ads (paid) — real reporting via the integrated report API ─────────
export class TikTokAdsClient implements ConnectorClient {
  readonly platform = "tiktok_ads" as const;

  async fetchMetrics(connection: Connection, range: MetricRange): Promise<CanonicalMetric[]> {
    const accessToken = await accessTokenFor(connection, this.platform);
    const advertiserId = connection.externalAccountId;
    if (!advertiserId) throw new ConnectorNotReadyError(this.platform, "connection has no TikTok advertiser id");
    const url = new URL(`${TIKTOK_API}/report/integrated/get/`);
    url.searchParams.set("advertiser_id", advertiserId);
    url.searchParams.set("report_type", "BASIC");
    url.searchParams.set("data_level", "AUCTION_CAMPAIGN");
    url.searchParams.set("dimensions", JSON.stringify(["campaign_id", "stat_time_day"]));
    url.searchParams.set(
      "metrics",
      JSON.stringify(["spend", "impressions", "clicks", "conversion", "total_complete_payment_rate"]),
    );
    url.searchParams.set("start_date", isoDate(range.from));
    url.searchParams.set("end_date", isoDate(range.to));
    url.searchParams.set("page_size", "1000");
    const res = await fetch(url, { headers: { "Access-Token": accessToken, Accept: "application/json" } });
    if (!res.ok) throw new ConnectorNotReadyError(this.platform, `TikTok report API responded ${res.status}`);
    const payload = (await res.json()) as {
      data?: { list?: Array<{ dimensions?: Record<string, string>; metrics?: Record<string, string> }> };
    };
    return (payload.data?.list ?? []).flatMap((row) => {
      const day = row.dimensions?.stat_time_day;
      if (!day) return [];
      return rowsFor({
        platform: this.platform,
        date: compactDate(day.slice(0, 10)),
        campaign: row.dimensions?.campaign_id,
        spend: n(row.metrics?.spend),
        conversions: n(row.metrics?.conversion),
        clicks: n(row.metrics?.clicks),
        impressions: n(row.metrics?.impressions),
      });
    });
  }
}

// ── Pinterest Ads (paid) — synchronous daily analytics ───────────────────────
export class PinterestAdsClient implements ConnectorClient {
  readonly platform = "pinterest_ads" as const;

  async fetchMetrics(connection: Connection, range: MetricRange): Promise<CanonicalMetric[]> {
    const accessToken = await accessTokenFor(connection, this.platform);
    const accountId = connection.externalAccountId;
    if (!accountId) throw new ConnectorNotReadyError(this.platform, "connection has no Pinterest ad account id");
    const url = new URL(`${PINTEREST_API}/ad_accounts/${accountId}/analytics`);
    url.searchParams.set("start_date", isoDate(range.from));
    url.searchParams.set("end_date", isoDate(range.to));
    url.searchParams.set("granularity", "DAY");
    url.searchParams.set("columns", "SPEND_IN_DOLLAR,IMPRESSION_1,CLICKTHROUGH_1,TOTAL_CONVERSIONS");
    const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" } });
    if (!res.ok) throw new ConnectorNotReadyError(this.platform, `Pinterest analytics API responded ${res.status}`);
    const payload = (await res.json()) as Array<{
      DATE?: string;
      SPEND_IN_DOLLAR?: number;
      IMPRESSION_1?: number;
      CLICKTHROUGH_1?: number;
      TOTAL_CONVERSIONS?: number;
    }>;
    const rows = Array.isArray(payload) ? payload : [];
    return rows.flatMap((row) => {
      if (!row.DATE) return [];
      return rowsFor({
        platform: this.platform,
        date: compactDate(row.DATE),
        spend: n(row.SPEND_IN_DOLLAR),
        conversions: n(row.TOTAL_CONVERSIONS),
        clicks: n(row.CLICKTHROUGH_1),
        impressions: n(row.IMPRESSION_1),
      });
    });
  }
}

// ── Snapchat Ads (paid) — daily stats (spend/revenue in micro-currency) ──────
export class SnapchatAdsClient implements ConnectorClient {
  readonly platform = "snapchat_ads" as const;

  async fetchMetrics(connection: Connection, range: MetricRange): Promise<CanonicalMetric[]> {
    const accessToken = await accessTokenFor(connection, this.platform);
    const accountId = connection.externalAccountId;
    if (!accountId) throw new ConnectorNotReadyError(this.platform, "connection has no Snapchat ad account id");
    const url = new URL(`${SNAPCHAT_API}/adaccounts/${accountId}/stats`);
    url.searchParams.set("granularity", "DAY");
    url.searchParams.set("fields", "spend,impressions,swipes,conversion_purchases,conversion_purchases_value");
    url.searchParams.set("start_time", `${isoDate(range.from)}T00:00:00.000-00:00`);
    url.searchParams.set("end_time", `${isoDate(range.to)}T00:00:00.000-00:00`);
    const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" } });
    if (!res.ok) throw new ConnectorNotReadyError(this.platform, `Snapchat stats API responded ${res.status}`);
    const payload = (await res.json()) as {
      timeseries_stats?: Array<{
        timeseries_stat?: { timeseries?: Array<{ start_time?: string; stats?: Record<string, number> }> };
      }>;
    };
    const series = payload.timeseries_stats?.[0]?.timeseries_stat?.timeseries ?? [];
    return series.flatMap((point) => {
      if (!point.start_time) return [];
      const stats = point.stats ?? {};
      return rowsFor({
        platform: this.platform,
        date: compactDate(point.start_time.slice(0, 10)),
        spend: n(stats.spend) / 1_000_000,
        revenue: n(stats.conversion_purchases_value) / 1_000_000,
        conversions: n(stats.conversion_purchases),
        clicks: n(stats.swipes),
        impressions: n(stats.impressions),
      });
    });
  }
}

// ── Google Search Console (organic / SEO) — search analytics by day ──────────
export class SearchConsoleClient implements ConnectorClient {
  readonly platform = "search_console" as const;

  async fetchMetrics(connection: Connection, range: MetricRange): Promise<CanonicalMetric[]> {
    const accessToken = await accessTokenFor(connection, this.platform);
    const site = connection.externalAccountId;
    if (!site) throw new ConnectorNotReadyError(this.platform, "connection has no Search Console site");
    const res = await fetch(`${SEARCH_CONSOLE_API}/sites/${encodeURIComponent(site)}/searchAnalytics/query`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        startDate: isoDate(range.from),
        endDate: isoDate(range.to),
        dimensions: ["date"],
        rowLimit: 1000,
      }),
    });
    if (!res.ok) throw new ConnectorNotReadyError(this.platform, `Search Console API responded ${res.status}`);
    const payload = (await res.json()) as {
      rows?: Array<{ keys?: string[]; clicks?: number; impressions?: number }>;
    };
    return (payload.rows ?? []).flatMap((row) => {
      const day = row.keys?.[0];
      if (!day) return [];
      return rowsFor({
        platform: this.platform,
        date: compactDate(day),
        clicks: n(row.clicks),
        impressions: n(row.impressions),
      });
    });
  }
}

// ── Amazon Ads (paid) — OAuth + profiles wired; reporting is async (pending) ──
export class AmazonAdsClient implements ConnectorClient {
  readonly platform = "amazon_ads" as const;

  async fetchMetrics(_connection: Connection, _range: MetricRange): Promise<CanonicalMetric[]> {
    throw new ConnectorNotReadyError(
      this.platform,
      "Amazon Ads reporting is async (request → poll → download); finalized against a live account",
    );
  }
}

// ── Microsoft Ads (paid) — OAuth wired; Bing reporting is SOAP (pending) ─────
export class MicrosoftAdsClient implements ConnectorClient {
  readonly platform = "microsoft_ads" as const;

  async fetchMetrics(_connection: Connection, _range: MetricRange): Promise<CanonicalMetric[]> {
    throw new ConnectorNotReadyError(
      this.platform,
      "Microsoft Advertising reporting (SOAP) is finalized against a live account",
    );
  }
}

// ── Reddit Ads (paid) — OAuth wired; reporting finalized on live connect ─────
export class RedditAdsClient implements ConnectorClient {
  readonly platform = "reddit_ads" as const;

  async fetchMetrics(_connection: Connection, _range: MetricRange): Promise<CanonicalMetric[]> {
    throw new ConnectorNotReadyError(this.platform, "Reddit Ads reporting is finalized against a live account");
  }
}

// ── X (Twitter) Ads (paid) — OAuth2 surface; Ads API is OAuth1.0a (pending) ──
export class XAdsClient implements ConnectorClient {
  readonly platform = "x_ads" as const;

  async fetchMetrics(_connection: Connection, _range: MetricRange): Promise<CanonicalMetric[]> {
    throw new ConnectorNotReadyError(
      this.platform,
      "X Ads reporting uses OAuth 1.0a + elevated access; finalized against a live account",
    );
  }
}

export async function resolveOAuthAccount(
  platform: Exclude<ConnectorPlatform, "apple_search_ads">,
  accessToken: string,
): Promise<AccountSelection> {
  const accounts = await listOAuthAccounts(platform, accessToken);
  const first = accounts[0];
  if (!first) {
    throw new ConnectorNotReadyError(platform, "no accounts available");
  }
  return first;
}

export async function listOAuthAccounts(
  platform: Exclude<ConnectorPlatform, "apple_search_ads">,
  accessToken: string,
): Promise<AccountSelection[]> {
  switch (platform) {
    case "google_ads":
      return listGoogleAdsAccounts(accessToken);
    case "ga4":
      return listGa4Properties(accessToken);
    case "meta_ads":
      return listMetaAdAccounts(accessToken);
    case "linkedin_ads":
      return listLinkedInAdAccounts(accessToken);
    case "tiktok_ads":
      return listTikTokAdvertisers(accessToken);
    case "pinterest_ads":
      return listPinterestAdAccounts(accessToken);
    case "snapchat_ads":
      return listSnapchatAdAccounts(accessToken);
    case "amazon_ads":
      return listAmazonProfiles(accessToken);
    case "search_console":
      return listSearchConsoleSites(accessToken);
    case "microsoft_ads":
    case "reddit_ads":
    case "x_ads":
      // OAuth + token are valid; account-scoped reporting is finalized against a
      // live account. Persist one default selection so the grant is KEPT and the
      // platform shows connected, rather than discarding a valid token.
      return [{ externalAccountId: "default", displayName: `${CONNECTORS[platform].label} account` }];
  }
}

export async function resolveAppleSearchAdsAccount(accessToken: string): Promise<AccountSelection> {
  const res = await fetch(`${APPLE_SEARCH_ADS_API}/acls`, {
    headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" },
  });
  if (!res.ok) throw new ConnectorNotReadyError("apple_search_ads", `Apple ACL API responded ${res.status}`);
  const payload = (await res.json()) as {
    data?: Array<{ orgId?: string | number; orgName?: string; roleNames?: string[] }>;
  };
  const org = payload.data?.find((item) => item.orgId);
  if (!org?.orgId) throw new ConnectorNotReadyError("apple_search_ads", "no Apple Search Ads orgs available");
  return { externalAccountId: String(org.orgId), displayName: org.orgName ?? `Org ${org.orgId}` };
}

async function listGoogleAdsAccounts(accessToken: string): Promise<AccountSelection[]> {
  const res = await fetch(`https://googleads.googleapis.com/${GOOGLE_ADS_API_VERSION}/customers:listAccessibleCustomers`, {
    headers: googleAdsHeaders(accessToken),
  });
  if (!res.ok) throw new ConnectorNotReadyError("google_ads", `Google Ads customers API responded ${res.status}`);
  const payload = (await res.json()) as { resourceNames?: string[] };
  const ids = (payload.resourceNames ?? [])
    .map((resourceName) => resourceName.replace("customers/", ""))
    .filter(Boolean);
  if (ids.length === 0) throw new ConnectorNotReadyError("google_ads", "no accessible Google Ads customers");

  return Promise.all(
    ids.map(async (externalAccountId) => ({
      externalAccountId,
      displayName: await googleAdsCustomerName(accessToken, externalAccountId).catch(
        () => `Customer ${externalAccountId}`,
      ),
    })),
  );
}

async function googleAdsCustomerName(accessToken: string, customerId: string): Promise<string> {
  const res = await fetch(
    `https://googleads.googleapis.com/${GOOGLE_ADS_API_VERSION}/customers/${customerId}/googleAds:searchStream`,
    {
      method: "POST",
      headers: googleAdsHeaders(accessToken),
      body: JSON.stringify({
        query: "SELECT customer.id, customer.descriptive_name FROM customer LIMIT 1",
      }),
    },
  );
  if (!res.ok) return `Customer ${customerId}`;
  const payload = (await res.json()) as GoogleAdsBatch[];
  return payload[0]?.results?.[0]?.customer?.descriptiveName ?? `Customer ${customerId}`;
}

async function listGa4Properties(accessToken: string): Promise<AccountSelection[]> {
  const res = await fetch(GA4_ADMIN_URL, {
    headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" },
  });
  if (!res.ok) throw new ConnectorNotReadyError("ga4", `GA4 Admin API responded ${res.status}`);
  const payload = (await res.json()) as {
    accountSummaries?: Array<{
      displayName?: string;
      propertySummaries?: Array<{ property?: string; displayName?: string }>;
    }>;
  };
  const accounts: AccountSelection[] = [];
  for (const account of payload.accountSummaries ?? []) {
    for (const property of account.propertySummaries ?? []) {
      if (!property.property) continue;
      const id = property.property.replace("properties/", "");
      accounts.push({
        externalAccountId: id,
        displayName: property.displayName ?? `${account.displayName ?? "GA4"} · ${id}`,
      });
    }
  }
  if (accounts.length === 0) throw new ConnectorNotReadyError("ga4", "no GA4 properties available");
  return accounts;
}

async function listMetaAdAccounts(accessToken: string): Promise<AccountSelection[]> {
  const url = new URL(`https://graph.facebook.com/${META_GRAPH_VERSION}/me/adaccounts`);
  url.searchParams.set("fields", "id,account_id,name");
  url.searchParams.set("access_token", accessToken);
  const res = await fetch(url, { headers: { Accept: "application/json" } });
  if (!res.ok) throw new ConnectorNotReadyError("meta_ads", `Meta adaccounts API responded ${res.status}`);
  const payload = (await res.json()) as {
    data?: Array<{ id?: string; account_id?: string; name?: string }>;
  };
  const accounts = (payload.data ?? []).flatMap((account) => {
    const id = account.id ?? (account.account_id ? `act_${account.account_id}` : undefined);
    if (!id) return [];
    return [{ externalAccountId: id.replace(/^act_/, ""), displayName: account.name ?? id }];
  });
  if (accounts.length === 0) throw new ConnectorNotReadyError("meta_ads", "no Meta ad accounts available");
  return accounts;
}

async function listLinkedInAdAccounts(accessToken: string): Promise<AccountSelection[]> {
  const res = await fetch(`${LINKEDIN_API}/adAccountUsers?q=authenticatedUser`, {
    headers: linkedinHeaders(accessToken),
  });
  if (!res.ok) throw new ConnectorNotReadyError("linkedin_ads", `LinkedIn adAccountUsers responded ${res.status}`);
  const payload = (await res.json()) as { elements?: Array<{ account?: string }> };
  const accounts = (payload.elements ?? []).flatMap((entry) => {
    const id = entry.account?.replace("urn:li:sponsoredAccount:", "");
    if (!id) return [];
    return [{ externalAccountId: id, displayName: `LinkedIn Ads ${id}` }];
  });
  if (accounts.length === 0) throw new ConnectorNotReadyError("linkedin_ads", "no LinkedIn ad accounts available");
  return accounts;
}

async function listTikTokAdvertisers(accessToken: string): Promise<AccountSelection[]> {
  const appId = process.env.TIKTOK_APP_ID;
  const secret = process.env.TIKTOK_APP_SECRET;
  if (!appId || !secret) throw new ConnectorNotReadyError("tiktok_ads", "missing TIKTOK_APP_ID / TIKTOK_APP_SECRET");
  const url = new URL(`${TIKTOK_API}/oauth2/advertiser/get/`);
  url.searchParams.set("access_token", accessToken);
  url.searchParams.set("secret", secret);
  url.searchParams.set("app_id", appId);
  const res = await fetch(url, { headers: { Accept: "application/json" } });
  if (!res.ok) throw new ConnectorNotReadyError("tiktok_ads", `TikTok advertiser API responded ${res.status}`);
  const payload = (await res.json()) as {
    data?: { list?: Array<{ advertiser_id?: string; advertiser_name?: string }> };
  };
  const accounts = (payload.data?.list ?? []).flatMap((adv) =>
    adv.advertiser_id
      ? [{ externalAccountId: adv.advertiser_id, displayName: adv.advertiser_name ?? `Advertiser ${adv.advertiser_id}` }]
      : [],
  );
  if (accounts.length === 0) throw new ConnectorNotReadyError("tiktok_ads", "no TikTok advertisers available");
  return accounts;
}

async function listPinterestAdAccounts(accessToken: string): Promise<AccountSelection[]> {
  const res = await fetch(`${PINTEREST_API}/ad_accounts`, {
    headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" },
  });
  if (!res.ok) throw new ConnectorNotReadyError("pinterest_ads", `Pinterest ad_accounts API responded ${res.status}`);
  const payload = (await res.json()) as { items?: Array<{ id?: string; name?: string }> };
  const accounts = (payload.items ?? []).flatMap((acct) =>
    acct.id ? [{ externalAccountId: acct.id, displayName: acct.name ?? `Pinterest ${acct.id}` }] : [],
  );
  if (accounts.length === 0) throw new ConnectorNotReadyError("pinterest_ads", "no Pinterest ad accounts available");
  return accounts;
}

async function listSnapchatAdAccounts(accessToken: string): Promise<AccountSelection[]> {
  const res = await fetch(`${SNAPCHAT_API}/me/organizations?with_ad_accounts=true`, {
    headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" },
  });
  if (!res.ok) throw new ConnectorNotReadyError("snapchat_ads", `Snapchat organizations API responded ${res.status}`);
  const payload = (await res.json()) as {
    organizations?: Array<{ organization?: { ad_accounts?: Array<{ id?: string; name?: string }> } }>;
  };
  const accounts = (payload.organizations ?? []).flatMap((org) =>
    (org.organization?.ad_accounts ?? []).flatMap((acct) =>
      acct.id ? [{ externalAccountId: acct.id, displayName: acct.name ?? `Snapchat ${acct.id}` }] : [],
    ),
  );
  if (accounts.length === 0) throw new ConnectorNotReadyError("snapchat_ads", "no Snapchat ad accounts available");
  return accounts;
}

async function listAmazonProfiles(accessToken: string): Promise<AccountSelection[]> {
  const clientId = process.env.AMAZON_ADS_CLIENT_ID;
  if (!clientId) throw new ConnectorNotReadyError("amazon_ads", "missing AMAZON_ADS_CLIENT_ID");
  const res = await fetch(`${AMAZON_ADS_API}/v2/profiles`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Amazon-Advertising-API-ClientId": clientId,
      Accept: "application/json",
    },
  });
  if (!res.ok) throw new ConnectorNotReadyError("amazon_ads", `Amazon profiles API responded ${res.status}`);
  const payload = (await res.json()) as Array<{ profileId?: number; accountInfo?: { name?: string } }>;
  const accounts = (Array.isArray(payload) ? payload : []).flatMap((profile) =>
    profile.profileId
      ? [
          {
            externalAccountId: String(profile.profileId),
            displayName: profile.accountInfo?.name ?? `Profile ${profile.profileId}`,
          },
        ]
      : [],
  );
  if (accounts.length === 0) throw new ConnectorNotReadyError("amazon_ads", "no Amazon advertising profiles available");
  return accounts;
}

async function listSearchConsoleSites(accessToken: string): Promise<AccountSelection[]> {
  const res = await fetch(`${SEARCH_CONSOLE_API}/sites`, {
    headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" },
  });
  if (!res.ok) throw new ConnectorNotReadyError("search_console", `Search Console sites API responded ${res.status}`);
  const payload = (await res.json()) as { siteEntry?: Array<{ siteUrl?: string }> };
  const accounts = (payload.siteEntry ?? []).flatMap((site) =>
    site.siteUrl ? [{ externalAccountId: site.siteUrl, displayName: site.siteUrl }] : [],
  );
  if (accounts.length === 0) throw new ConnectorNotReadyError("search_console", "no Search Console sites available");
  return accounts;
}

export async function getAppleSearchAdsAccessToken(): Promise<{ accessToken: string; expiresAt?: Date }> {
  const clientId = process.env.APPLE_SEARCH_ADS_CLIENT_ID;
  const teamId = process.env.APPLE_SEARCH_ADS_TEAM_ID;
  const keyId = process.env.APPLE_SEARCH_ADS_KEY_ID;
  const privateKey = process.env.APPLE_SEARCH_ADS_PRIVATE_KEY?.replace(/\\n/g, "\n");
  if (!clientId || !teamId || !keyId || !privateKey) {
    throw new ConnectorNotReadyError("apple_search_ads", "missing Apple Search Ads API credentials");
  }

  const now = Math.floor(Date.now() / 1000);
  const clientSecret = signJwt(
    { alg: "ES256", kid: keyId, typ: "JWT" },
    {
      iss: teamId,
      sub: clientId,
      aud: "https://appleid.apple.com",
      iat: now,
      exp: now + 15 * 60,
    },
    privateKey,
  );

  const form = new URLSearchParams();
  form.set("grant_type", "client_credentials");
  form.set("client_id", clientId);
  form.set("client_secret", clientSecret);
  form.set("scope", "searchadsorg");

  const res = await fetch(APPLE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body: form.toString(),
  });
  const payload = (await res.json()) as { access_token?: string; expires_in?: number; error?: string };
  if (!res.ok || !payload.access_token) {
    throw new ConnectorNotReadyError("apple_search_ads", payload.error ?? `token API responded ${res.status}`);
  }
  return {
    accessToken: payload.access_token,
    expiresAt: payload.expires_in ? new Date(Date.now() + payload.expires_in * 1000) : undefined,
  };
}

function b64url(input: Buffer | string): string {
  return Buffer.from(input).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function signJwt(header: Record<string, unknown>, claims: Record<string, unknown>, privateKey: string): string {
  const signingInput = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(claims))}`;
  const signer = createSign("SHA256");
  signer.update(signingInput);
  signer.end();
  const signature = signer.sign({ key: privateKey, dsaEncoding: "ieee-p1363" });
  return `${signingInput}.${b64url(signature)}`;
}
