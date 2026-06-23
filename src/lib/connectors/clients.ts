import { createSign } from "node:crypto";

import type { Connection } from "@prisma/client";

import { prisma } from "@/lib/db";
import { decryptToken, encryptToken, isVaultConfigured, tokenAad } from "@/lib/security/vault";
import { refreshAccessToken } from "@/lib/connectors/oauth";
import {
  ConnectorNotReadyError,
  type CanonicalMetric,
  type ConnectorClient,
  type ConnectorPlatform,
  type MetricRange,
} from "./types";
import { META_GRAPH_VERSION } from "./registry";

const GOOGLE_ADS_API_VERSION = "v24";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GA4_ADMIN_URL = "https://analyticsadmin.googleapis.com/v1beta/accountSummaries";
const APPLE_TOKEN_URL = "https://appleid.apple.com/auth/oauth2/token";
const APPLE_SEARCH_ADS_API = "https://api.searchads.apple.com/api/v5";
const LINKEDIN_API = "https://api.linkedin.com/rest";
const LINKEDIN_VERSION = "202406";

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

  if (platform !== "google_ads" && platform !== "ga4") return null;
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
      const conversions = actionValue(row.actions, [
        "purchase",
        "offsite_conversion.fb_pixel_purchase",
        "onsite_conversion.purchase",
      ]);
      const actionRevenue = actionValue(row.action_values, [
        "purchase",
        "offsite_conversion.fb_pixel_purchase",
        "onsite_conversion.purchase",
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
}

function actionValue(actions: Array<{ action_type?: string; value?: string }> | undefined, names: string[]): number {
  return (actions ?? [])
    .filter((action) => action.action_type && names.includes(action.action_type))
    .reduce((sum, action) => sum + n(action.value), 0);
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
