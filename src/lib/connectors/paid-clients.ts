import type { Connection } from "@prisma/client";

import { META_GRAPH_VERSION } from "./registry";
import { getConnectionAccessToken } from "./clients";
import { PaidProviderError, providerHttpError, sanitizePaidProviderError } from "./paid-errors";
import {
  boundedPages,
  normalizeCurrency,
  observedRange,
  parseProviderNumber,
  utcDay,
} from "./paid-parsing";
import type {
  AdCreative,
  CampaignConfig,
  CanonicalMetric,
  ConnectorPlatform,
  FetchSnapshot,
  MetricRange,
} from "./types";

export const PAID_SYNC_PLATFORMS = ["google_ads", "meta_ads", "tiktok_ads"] as const;
export type PaidSyncPlatform = (typeof PAID_SYNC_PLATFORMS)[number];

export function isPaidSyncPlatform(value: string): value is PaidSyncPlatform {
  return (PAID_SYNC_PLATFORMS as readonly string[]).includes(value);
}

export interface PaidReadClient {
  readonly platform: PaidSyncPlatform;
  fetchMetricsSnapshot(connection: Connection, range: MetricRange): Promise<FetchSnapshot<CanonicalMetric>>;
  fetchCampaignsSnapshot(connection: Connection): Promise<FetchSnapshot<CampaignConfig>>;
  fetchAdsSnapshot(connection: Connection, range: MetricRange): Promise<FetchSnapshot<AdCreative>>;
}

type FetchLike = typeof fetch;
export type ConnectionTokenProvider = (
  connection: Connection,
  platform: ConnectorPlatform,
) => Promise<string>;

function isoDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function snapshot<T>(input: {
  items: T[];
  currency: string | null;
  timezone: string | null;
  observedFrom?: Date | null;
  observedTo?: Date | null;
}): FetchSnapshot<T> {
  return { complete: true, observedFrom: null, observedTo: null, ...input };
}

type ProviderRecord = Record<string, unknown>;

function invalidResponse(platform: PaidSyncPlatform): never {
  throw new PaidProviderError(platform, "invalid_response", true);
}

function isRecord(value: unknown): value is ProviderRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requiredId(platform: PaidSyncPlatform, value: unknown): string {
  if (typeof value === "string" && value.trim()) return value;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return invalidResponse(platform);
}

function requiredText(platform: PaidSyncPlatform, value: unknown): string {
  if (typeof value === "string" && value.trim()) return value;
  return invalidResponse(platform);
}

function optionalText(platform: PaidSyncPlatform, value: unknown): string | undefined {
  if (value == null) return undefined;
  if (typeof value === "string") return value;
  return invalidResponse(platform);
}

function strictDay(platform: PaidSyncPlatform, value: unknown): Date {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return invalidResponse(platform);
  }
  const date = utcDay(value);
  if (!date || isoDay(date) !== value) return invalidResponse(platform);
  return date;
}

function optionalNumber(platform: PaidSyncPlatform, value: unknown): number | null {
  if (value == null) return null;
  const parsed = parseProviderNumber(value as string | number);
  return parsed == null ? invalidResponse(platform) : parsed;
}

function optionalRecord(platform: PaidSyncPlatform, value: unknown): ProviderRecord | undefined {
  if (value == null) return undefined;
  return isRecord(value) ? value : invalidResponse(platform);
}

function optionalRecordArray(platform: PaidSyncPlatform, value: unknown): ProviderRecord[] | undefined {
  if (value == null) return undefined;
  if (!Array.isArray(value) || !value.every(isRecord)) return invalidResponse(platform);
  return value;
}

export function addMetricRows(input: {
  platform: PaidSyncPlatform;
  date: Date;
  campaignExternalId: string;
  campaignName: string | null;
  spend: number | null;
  revenue: number | null;
  conversions: number | null;
  clicks: number | null;
  impressions: number | null;
}): CanonicalMetric[] {
  const rows: CanonicalMetric[] = [];
  const add = (metric: string, value: number | null) => {
    if (value == null || !Number.isFinite(value)) return;
    rows.push({
      platform: input.platform,
      date: input.date,
      campaignExternalId: input.campaignExternalId,
      campaignName: input.campaignName,
      campaign: input.campaignName ?? input.campaignExternalId,
      metric,
      value,
    });
  };
  add("spend", input.spend);
  add("revenue", input.revenue);
  add("conversions", input.conversions);
  add("clicks", input.clicks);
  add("impressions", input.impressions);
  if (input.spend != null && input.spend > 0 && input.revenue != null) {
    add("roas", input.revenue / input.spend);
  }
  if (input.conversions != null && input.conversions > 0 && input.spend != null) {
    add("cpa", input.spend / input.conversions);
  }
  return rows;
}

async function responseJson<T>(
  platform: PaidSyncPlatform,
  fetchImpl: FetchLike,
  url: string,
  init: RequestInit,
): Promise<T> {
  let response: Response;
  try {
    response = await fetchImpl(url, { ...init, signal: init.signal ?? AbortSignal.timeout(20_000) });
  } catch (error) {
    throw sanitizePaidProviderError(platform, error);
  }
  if (!response.ok) throw providerHttpError(platform, response.status);
  try {
    return (await response.json()) as T;
  } catch {
    throw new PaidProviderError(platform, "invalid_response", true);
  }
}

interface GoogleBatch<T> { results?: T[] }

class GooglePaidClient implements PaidReadClient {
  readonly platform = "google_ads" as const;
  private readonly apiVersion = "v24";

  constructor(
    private readonly fetchImpl: FetchLike,
    private readonly tokenProvider: ConnectionTokenProvider,
  ) {}

  private headers(token: string): Record<string, string> {
    const developerToken = process.env.GOOGLE_ADS_DEVELOPER_TOKEN;
    if (!developerToken) throw new PaidProviderError(this.platform, "authentication", false);
    const headers: Record<string, string> = {
      Authorization: `Bearer ${token}`,
      "developer-token": developerToken,
      "Content-Type": "application/json",
    };
    const loginCustomerId = process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID?.replace(/-/g, "");
    if (loginCustomerId) headers["login-customer-id"] = loginCustomerId;
    return headers;
  }

  private async query<T>(connection: Connection, query: string): Promise<T[]> {
    const token = await this.tokenProvider(connection, this.platform);
    const customerId = connection.externalAccountId.replace(/-/g, "");
    if (!customerId) throw new PaidProviderError(this.platform, "authentication", false);
    const url = `https://googleads.googleapis.com/${this.apiVersion}/customers/${customerId}/googleAds:searchStream`;
    let response: Response;
    try {
      response = await this.fetchImpl(url, {
        method: "POST",
        headers: this.headers(token),
        body: JSON.stringify({ query }),
        signal: AbortSignal.timeout(20_000),
      });
    } catch (error) {
      throw sanitizePaidProviderError(this.platform, error);
    }
    if (!response.ok) throw providerHttpError(this.platform, response.status);
    const text = await response.text();
    if (!text.trim()) throw new PaidProviderError(this.platform, "invalid_response", true);
    let batches: GoogleBatch<T>[];
    try {
      const parsed = JSON.parse(text) as unknown;
      if (!Array.isArray(parsed)) {
        throw new PaidProviderError(this.platform, "invalid_response", true);
      }
      if (!parsed.every((batch) => (
        typeof batch === "object"
        && batch !== null
        && Array.isArray((batch as GoogleBatch<T>).results)
        && ((batch as GoogleBatch<T>).results as unknown[]).every(isRecord)
      ))) {
        throw new PaidProviderError(this.platform, "invalid_response", true);
      }
      batches = parsed as GoogleBatch<T>[];
    } catch {
      throw new PaidProviderError(this.platform, "invalid_response", true);
    }
    return batches.flatMap((batch) => batch.results as T[]);
  }

  private async accountMeta(connection: Connection): Promise<{ currency: string | null; timezone: string | null }> {
    const rows = await this.query<{ customer?: { currencyCode?: string; timeZone?: string } }>(
      connection,
      "SELECT customer.currency_code, customer.time_zone FROM customer LIMIT 1",
    );
    for (const row of rows) {
      const customer = optionalRecord(this.platform, row.customer);
      if (!customer) invalidResponse(this.platform);
      optionalText(this.platform, customer.currencyCode);
      optionalText(this.platform, customer.timeZone);
    }
    return {
      currency: normalizeCurrency(rows[0]?.customer?.currencyCode),
      timezone: rows[0]?.customer?.timeZone ?? null,
    };
  }

  async fetchMetricsSnapshot(connection: Connection, range: MetricRange): Promise<FetchSnapshot<CanonicalMetric>> {
    const [meta, raw] = await Promise.all([
      this.accountMeta(connection),
      this.query<{
        campaign?: { id?: string | number; name?: string };
        metrics?: {
          costMicros?: string | number;
          conversions?: string | number;
          conversionsValue?: string | number;
          clicks?: string | number;
          impressions?: string | number;
        };
        segments?: { date?: string };
      }>(connection, [
        "SELECT campaign.id, campaign.name, metrics.cost_micros, metrics.conversions,",
        "metrics.conversions_value, metrics.clicks, metrics.impressions, segments.date",
        "FROM campaign",
        `WHERE segments.date BETWEEN '${isoDay(range.from)}' AND '${isoDay(range.to)}'`,
        "ORDER BY segments.date",
      ].join(" ")),
    ]);
    const items = raw.flatMap((row) => {
      const campaign = optionalRecord(this.platform, row.campaign);
      const metrics = optionalRecord(this.platform, row.metrics);
      const segments = optionalRecord(this.platform, row.segments);
      if (!campaign || !metrics || !segments) invalidResponse(this.platform);
      const id = requiredId(this.platform, campaign.id);
      const date = strictDay(this.platform, segments.date);
      const campaignName = optionalText(this.platform, campaign.name) ?? null;
      const micros = optionalNumber(this.platform, metrics.costMicros);
      return addMetricRows({
        platform: this.platform,
        date,
        campaignExternalId: id,
        campaignName,
        spend: micros == null ? null : micros / 1_000_000,
        revenue: optionalNumber(this.platform, metrics.conversionsValue),
        conversions: optionalNumber(this.platform, metrics.conversions),
        clicks: optionalNumber(this.platform, metrics.clicks),
        impressions: optionalNumber(this.platform, metrics.impressions),
      });
    });
    const coverage = observedRange(items, (item) => item.date);
    return snapshot({ items, ...meta, ...coverage });
  }

  async fetchCampaignsSnapshot(connection: Connection): Promise<FetchSnapshot<CampaignConfig>> {
    const [meta, raw] = await Promise.all([
      this.accountMeta(connection),
      this.query<{
        campaign?: { id?: string | number; name?: string; status?: string; advertisingChannelType?: string };
        campaignBudget?: { amountMicros?: string | number; period?: string };
      }>(connection, [
        "SELECT campaign.id, campaign.name, campaign.status, campaign.advertising_channel_type,",
        "campaign_budget.amount_micros, campaign_budget.period FROM campaign",
        "WHERE campaign.status != 'REMOVED'",
      ].join(" ")),
    ]);
    const items = raw.map((row): CampaignConfig => {
      const campaign = optionalRecord(this.platform, row.campaign);
      if (!campaign) invalidResponse(this.platform);
      const externalId = requiredId(this.platform, campaign.id);
      const name = requiredText(this.platform, campaign.name);
      const budget = optionalRecord(this.platform, row.campaignBudget);
      const micros = optionalNumber(this.platform, budget?.amountMicros);
      const periodValue = optionalText(this.platform, budget?.period);
      const period = periodValue?.toUpperCase() ?? null;
      const budgetType: CampaignConfig["budgetType"] = micros == null
        ? null
        : period?.includes("DAILY") ? "daily" : "lifetime";
      return {
        platform: this.platform,
        externalId,
        name,
        status: normalizeStatus(optionalText(this.platform, campaign.status)),
        objective: prettyToken(optionalText(this.platform, campaign.advertisingChannelType)),
        budget: micros == null ? null : micros / 1_000_000,
        budgetType,
        currency: meta.currency,
      };
    });
    return snapshot({ items, ...meta });
  }

  async fetchAdsSnapshot(connection: Connection, range: MetricRange): Promise<FetchSnapshot<AdCreative>> {
    const [meta, raw] = await Promise.all([
      this.accountMeta(connection),
      this.query<{
        campaign?: { id?: string | number; name?: string };
        adGroup?: { name?: string };
        adGroupAd?: {
          status?: string;
          ad?: {
            id?: string | number;
            name?: string;
            type?: string;
            finalUrls?: string[];
            responsiveSearchAd?: {
              headlines?: Array<{ text?: string }>;
              descriptions?: Array<{ text?: string }>;
            };
          };
        };
        metrics?: {
          costMicros?: string | number;
          conversions?: string | number;
          clicks?: string | number;
          impressions?: string | number;
        };
      }>(connection, [
        "SELECT campaign.id, campaign.name, ad_group.name, ad_group_ad.status,",
        "ad_group_ad.ad.id, ad_group_ad.ad.name, ad_group_ad.ad.type, ad_group_ad.ad.final_urls,",
        "ad_group_ad.ad.responsive_search_ad.headlines,",
        "ad_group_ad.ad.responsive_search_ad.descriptions, metrics.cost_micros,",
        "metrics.conversions, metrics.clicks, metrics.impressions FROM ad_group_ad",
        `WHERE segments.date BETWEEN '${isoDay(range.from)}' AND '${isoDay(range.to)}'`,
      ].join(" ")),
    ]);
    const items = raw.map((row): AdCreative => {
      const campaign = optionalRecord(this.platform, row.campaign);
      const adGroupAd = optionalRecord(this.platform, row.adGroupAd);
      const ad = optionalRecord(this.platform, adGroupAd?.ad);
      const metrics = optionalRecord(this.platform, row.metrics);
      if (!campaign || !adGroupAd || !ad || !metrics) invalidResponse(this.platform);
      const adId = requiredId(this.platform, ad.id);
      const campaignId = requiredId(this.platform, campaign.id);
      const micros = optionalNumber(this.platform, metrics.costMicros);
      const finalUrls = ad.finalUrls == null
        ? undefined
        : Array.isArray(ad.finalUrls) && ad.finalUrls.every((entry) => typeof entry === "string")
          ? ad.finalUrls as string[]
          : invalidResponse(this.platform);
      const responsive = optionalRecord(this.platform, ad.responsiveSearchAd);
      const headlines = optionalRecordArray(this.platform, responsive?.headlines);
      const descriptions = optionalRecordArray(this.platform, responsive?.descriptions);
      return {
        platform: this.platform,
        externalId: adId,
        campaignExternalId: campaignId,
        campaignName: optionalText(this.platform, campaign.name) ?? null,
        adsetName: optionalText(this.platform, optionalRecord(this.platform, row.adGroup)?.name) ?? null,
        name: optionalText(this.platform, ad.name) ?? `Ad ${adId}`,
        status: normalizeStatus(optionalText(this.platform, adGroupAd.status)),
        creativeType: prettyToken(optionalText(this.platform, ad.type))?.toLowerCase() ?? null,
        title: headlines?.map((entry) => optionalText(this.platform, entry.text)).filter(Boolean).join(" | ") || null,
        body: descriptions?.map((entry) => optionalText(this.platform, entry.text)).filter(Boolean).join(" | ") || null,
        linkUrl: finalUrls?.[0] ?? null,
        spend: micros == null ? null : micros / 1_000_000,
        impressions: optionalNumber(this.platform, metrics.impressions),
        clicks: optionalNumber(this.platform, metrics.clicks),
        conversions: optionalNumber(this.platform, metrics.conversions),
        currency: meta.currency,
      };
    });
    return snapshot({
      items,
      ...meta,
      observedFrom: items.length > 0 ? range.from : null,
      observedTo: items.length > 0 ? range.to : null,
    });
  }
}

function normalizeStatus(value: string | undefined): string | null {
  if (!value) return null;
  const status = value.toLowerCase();
  if (status === "enabled") return "active";
  return status.replaceAll("_", " ");
}

function prettyToken(value: string | undefined): string | null {
  if (!value) return null;
  return value.replace(/^OUTCOME_/, "").replaceAll("_", " ").toLowerCase().replace(/\b\w/g, (letter) => letter.toUpperCase());
}

interface MetaPage<T> { data?: T[]; paging?: { next?: string } }

function metaActions(platform: PaidSyncPlatform, value: unknown): MetaAction[] | undefined {
  const rows = optionalRecordArray(platform, value);
  if (!rows) return undefined;
  return rows.map((row) => ({
    action_type: requiredText(platform, row.action_type),
    value: String(optionalNumber(platform, row.value) ?? invalidResponse(platform)),
  }));
}

class MetaPaidClient implements PaidReadClient {
  readonly platform = "meta_ads" as const;

  constructor(
    private readonly fetchImpl: FetchLike,
    private readonly tokenProvider: ConnectionTokenProvider,
  ) {}

  private accountId(connection: Connection): string {
    return connection.externalAccountId.startsWith("act_")
      ? connection.externalAccountId
      : `act_${connection.externalAccountId}`;
  }

  private async get<T>(token: string, url: URL): Promise<T> {
    return responseJson<T>(this.platform, this.fetchImpl, url.toString(), {
      headers: { Accept: "application/json", Authorization: `Bearer ${token}` },
    });
  }

  private pageUrl(raw: string): URL {
    if (!raw.startsWith("https://graph.facebook.com/")) invalidResponse(this.platform);
    let url: URL;
    try {
      url = new URL(raw);
    } catch {
      return invalidResponse(this.platform);
    }
    if (
      url.protocol !== "https:"
      || url.hostname !== "graph.facebook.com"
      || url.origin !== "https://graph.facebook.com"
      || url.username
      || url.password
      || url.port
      || url.hash
      || !url.pathname.startsWith(`/${META_GRAPH_VERSION}/`)
    ) {
      return invalidResponse(this.platform);
    }
    return url;
  }

  private async accountMeta(connection: Connection, token: string): Promise<{ currency: string | null; timezone: string | null }> {
    const url = new URL(`https://graph.facebook.com/${META_GRAPH_VERSION}/${this.accountId(connection)}`);
    url.searchParams.set("fields", "currency,timezone_name");
    const data = await this.get<{ currency?: string; timezone_name?: string }>(token, url);
    if (!isRecord(data)) invalidResponse(this.platform);
    const currency = optionalText(this.platform, data.currency);
    const timezone = optionalText(this.platform, data.timezone_name);
    return { currency: normalizeCurrency(currency), timezone: timezone ?? null };
  }

  private async pages<T>(token: string, first: URL): Promise<T[]> {
    return boundedPages({
      platform: this.platform,
      first: first.toString(),
      fetchPage: async (url) => {
        const page = await this.get<MetaPage<T>>(token, this.pageUrl(url));
        if (!isRecord(page) || !Array.isArray(page.data) || !page.data.every(isRecord)) {
          throw new PaidProviderError(this.platform, "invalid_response", true);
        }
        const paging = optionalRecord(this.platform, page.paging);
        const next = optionalText(this.platform, paging?.next) ?? null;
        if (next) this.pageUrl(next);
        return { items: page.data as T[], next };
      },
    });
  }

  async fetchMetricsSnapshot(connection: Connection, range: MetricRange): Promise<FetchSnapshot<CanonicalMetric>> {
    const token = await this.tokenProvider(connection, this.platform);
    const url = new URL(`https://graph.facebook.com/${META_GRAPH_VERSION}/${this.accountId(connection)}/insights`);
    url.searchParams.set("level", "campaign");
    url.searchParams.set("fields", "campaign_id,campaign_name,objective,spend,impressions,clicks,actions,action_values,purchase_roas,date_start");
    url.searchParams.set("time_increment", "1");
    url.searchParams.set("limit", "500");
    url.searchParams.set("time_range", JSON.stringify({ since: isoDay(range.from), until: isoDay(range.to) }));
    const [meta, raw] = await Promise.all([
      this.accountMeta(connection, token),
      this.pages<MetaInsight>(token, url),
    ]);
    const items = raw.flatMap((row) => {
      const campaignId = requiredId(this.platform, row.campaign_id);
      const date = strictDay(this.platform, row.date_start);
      const spend = optionalNumber(this.platform, row.spend);
      const actions = metaActions(this.platform, row.actions);
      const actionValues = metaActions(this.platform, row.action_values);
      const purchaseRoasRows = optionalRecordArray(this.platform, row.purchase_roas);
      const purchaseRoas = purchaseRoasRows?.map((entry) => optionalNumber(this.platform, entry.value)) ?? [];
      const actionRevenue = metaActionValue(actionValues, [
        "purchase", "offsite_conversion.fb_pixel_purchase", "onsite_conversion.purchase", "omni_purchase",
      ]);
      const objective = optionalText(this.platform, row.objective);
      const revenue = actionRevenue ?? (spend != null && purchaseRoas[0] != null ? spend * purchaseRoas[0] : null);
      return addMetricRows({
        platform: this.platform,
        date,
        campaignExternalId: campaignId,
        campaignName: optionalText(this.platform, row.campaign_name) ?? null,
        spend,
        revenue,
        conversions: metaConversionsForObjective(actions, objective),
        clicks: optionalNumber(this.platform, row.clicks),
        impressions: optionalNumber(this.platform, row.impressions),
      });
    });
    return snapshot({ items, ...meta, ...observedRange(items, (item) => item.date) });
  }

  async fetchCampaignsSnapshot(connection: Connection): Promise<FetchSnapshot<CampaignConfig>> {
    const token = await this.tokenProvider(connection, this.platform);
    const url = new URL(`https://graph.facebook.com/${META_GRAPH_VERSION}/${this.accountId(connection)}/campaigns`);
    url.searchParams.set("fields", "id,name,status,effective_status,objective,daily_budget,lifetime_budget");
    url.searchParams.set("limit", "500");
    const [meta, raw] = await Promise.all([
      this.accountMeta(connection, token),
      this.pages<MetaCampaign>(token, url),
    ]);
    const divisor = minorUnitDivisor(meta.currency);
    const items = raw.map((campaign): CampaignConfig => {
      const id = requiredId(this.platform, campaign.id);
      const name = requiredText(this.platform, campaign.name);
      const daily = optionalNumber(this.platform, campaign.daily_budget);
      const lifetime = optionalNumber(this.platform, campaign.lifetime_budget);
      const hasDaily = daily != null;
      return {
        platform: this.platform,
        externalId: id,
        name,
        status: normalizeStatus(optionalText(this.platform, campaign.effective_status) ?? optionalText(this.platform, campaign.status)),
        objective: prettyToken(optionalText(this.platform, campaign.objective)),
        budget: hasDaily ? daily / divisor : lifetime == null ? null : lifetime / divisor,
        budgetType: hasDaily ? "daily" : lifetime == null ? null : "lifetime",
        currency: meta.currency,
      };
    });
    return snapshot({ items, ...meta });
  }

  async fetchAdsSnapshot(connection: Connection, range: MetricRange): Promise<FetchSnapshot<AdCreative>> {
    const token = await this.tokenProvider(connection, this.platform);
    const insightsUrl = new URL(`https://graph.facebook.com/${META_GRAPH_VERSION}/${this.accountId(connection)}/insights`);
    insightsUrl.searchParams.set("level", "ad");
    insightsUrl.searchParams.set("fields", "ad_id,spend,impressions,clicks,actions");
    insightsUrl.searchParams.set("limit", "500");
    insightsUrl.searchParams.set("time_range", JSON.stringify({ since: isoDay(range.from), until: isoDay(range.to) }));
    const adsUrl = new URL(`https://graph.facebook.com/${META_GRAPH_VERSION}/${this.accountId(connection)}/ads`);
    adsUrl.searchParams.set("fields", "id,name,status,effective_status,campaign_id,campaign{name,objective},adset{name},creative{thumbnail_url,image_url,title,body,object_type,call_to_action_type,object_story_spec{link_data{message,name,link,call_to_action{type}},video_data{message,title,call_to_action{type}}}}");
    adsUrl.searchParams.set("limit", "500");
    const [meta, performance, rawAds] = await Promise.all([
      this.accountMeta(connection, token),
      this.pages<MetaAdInsight>(token, insightsUrl),
      this.pages<MetaAd>(token, adsUrl),
    ]);
    const performanceById = new Map(performance.map((row) => {
      const id = requiredId(this.platform, row.ad_id);
      optionalNumber(this.platform, row.spend);
      optionalNumber(this.platform, row.impressions);
      optionalNumber(this.platform, row.clicks);
      metaActions(this.platform, row.actions);
      return [id, row] as const;
    }));
    const items = rawAds.map((ad): AdCreative => {
      const id = requiredId(this.platform, ad.id);
      const name = requiredText(this.platform, ad.name);
      const campaignId = ad.campaign_id == null ? null : requiredId(this.platform, ad.campaign_id);
      const campaign = optionalRecord(this.platform, ad.campaign);
      const adset = optionalRecord(this.platform, ad.adset);
      const creativeRecord = optionalRecord(this.platform, ad.creative);
      const perf = performanceById.get(id);
      const objective = optionalText(this.platform, campaign?.objective);
      const creative = metaCreative(creativeRecord);
      return {
        platform: this.platform,
        externalId: id,
        campaignExternalId: campaignId,
        campaignName: optionalText(this.platform, campaign?.name) ?? null,
        adsetName: optionalText(this.platform, adset?.name) ?? null,
        name,
        status: normalizeStatus(optionalText(this.platform, ad.effective_status) ?? optionalText(this.platform, ad.status)),
        ...creative,
        spend: optionalNumber(this.platform, perf?.spend),
        impressions: optionalNumber(this.platform, perf?.impressions),
        clicks: optionalNumber(this.platform, perf?.clicks),
        conversions: metaConversionsForObjective(metaActions(this.platform, perf?.actions), objective),
        currency: meta.currency,
      };
    });
    return snapshot({
      items,
      ...meta,
      observedFrom: performance.length > 0 ? range.from : null,
      observedTo: performance.length > 0 ? range.to : null,
    });
  }
}

interface MetaAction { action_type?: string; value?: string }
interface MetaInsight {
  campaign_id?: string; campaign_name?: string; objective?: string; spend?: string; impressions?: string; clicks?: string;
  actions?: MetaAction[]; action_values?: MetaAction[]; purchase_roas?: Array<{ value?: string }>; date_start?: string;
}
interface MetaCampaign {
  id?: string; name?: string; status?: string; effective_status?: string; objective?: string;
  daily_budget?: string; lifetime_budget?: string;
}
interface MetaAdInsight { ad_id?: string; spend?: string; impressions?: string; clicks?: string; actions?: MetaAction[] }
interface MetaAd {
  id?: string; name?: string; status?: string; effective_status?: string; campaign_id?: string;
  campaign?: unknown; adset?: unknown; creative?: unknown;
}

function metaActionValue(actions: MetaAction[] | undefined, names: string[]): number | null {
  if (!actions) return null;
  const values = actions
    .filter((action) => action.action_type && names.includes(action.action_type))
    .map((action) => parseProviderNumber(action.value))
    .filter((value): value is number => value != null);
  const distinct = [...new Set(values)];
  return distinct.length === 1 ? distinct[0] : null;
}

const META_PURCHASE_ACTIONS = [
  "purchase", "offsite_conversion.fb_pixel_purchase", "onsite_conversion.purchase", "omni_purchase",
];
const META_INSTALL_ACTIONS = ["mobile_app_install", "app_install", "omni_app_install"];
const META_LEAD_ACTIONS = [
  "lead", "offsite_conversion.fb_pixel_lead", "onsite_conversion.lead_grouped", "omni_lead",
];
const META_REGISTRATION_ACTIONS = [
  "complete_registration", "offsite_conversion.fb_pixel_complete_registration", "omni_complete_registration",
];

function metaActionsForObjective(objective: string | undefined): string[] | null {
  const value = objective?.toUpperCase();
  if (!value) return null;
  if (["OUTCOME_SALES", "CONVERSIONS", "PRODUCT_CATALOG_SALES"].includes(value)) return META_PURCHASE_ACTIONS;
  if (["OUTCOME_APP_PROMOTION", "APP_INSTALLS"].includes(value)) return META_INSTALL_ACTIONS;
  if (["OUTCOME_LEADS", "LEAD_GENERATION"].includes(value)) return META_LEAD_ACTIONS;
  if (value.includes("REGISTRATION")) return META_REGISTRATION_ACTIONS;
  return null;
}

function metaConversionsForObjective(actions: MetaAction[] | undefined, objective: string | undefined): number | null {
  const actionTypes = metaActionsForObjective(objective);
  return actionTypes ? metaActionValue(actions, actionTypes) : null;
}

function minorUnitDivisor(currency: string | null): number {
  if (currency && ["JPY", "KRW", "VND", "CLP", "ISK", "UGX", "PYG", "GNF", "RWF", "VUV"].includes(currency)) return 1;
  if (currency && ["BHD", "IQD", "JOD", "KWD", "LYD", "OMR", "TND"].includes(currency)) return 1000;
  return 100;
}

function metaCreative(creative: ProviderRecord | undefined): Pick<AdCreative, "creativeType" | "thumbnailUrl" | "title" | "body" | "callToAction" | "linkUrl"> {
  const platform = "meta_ads";
  const story = optionalRecord(platform, creative?.object_story_spec);
  const link = optionalRecord(platform, story?.link_data);
  const video = optionalRecord(platform, story?.video_data);
  const linkCallToAction = optionalRecord(platform, link?.call_to_action);
  const videoCallToAction = optionalRecord(platform, video?.call_to_action);
  const thumbnailUrl = optionalText(platform, creative?.thumbnail_url)
    ?? optionalText(platform, creative?.image_url);
  const objectType = optionalText(platform, creative?.object_type);
  return {
    creativeType: video || objectType?.toUpperCase().includes("VIDEO")
      ? "video"
      : thumbnailUrl
        ? "image"
        : null,
    thumbnailUrl: thumbnailUrl ?? null,
    title: optionalText(platform, creative?.title)
      ?? optionalText(platform, link?.name)
      ?? optionalText(platform, video?.title)
      ?? null,
    body: optionalText(platform, creative?.body)
      ?? optionalText(platform, link?.message)
      ?? optionalText(platform, video?.message)
      ?? null,
    callToAction: prettyToken(
      optionalText(platform, creative?.call_to_action_type)
      ?? optionalText(platform, linkCallToAction?.type)
      ?? optionalText(platform, videoCallToAction?.type),
    ),
    linkUrl: optionalText(platform, link?.link) ?? null,
  };
}

interface TikTokEnvelope<T> {
  code?: number;
  data?: { list?: T[]; page_info?: { page?: number; total_page?: number; total_number?: number } };
}

class TikTokPaidClient implements PaidReadClient {
  readonly platform = "tiktok_ads" as const;
  private readonly root = "https://business-api.tiktok.com/open_api/v1.3";

  constructor(
    private readonly fetchImpl: FetchLike,
    private readonly tokenProvider: ConnectionTokenProvider,
  ) {}

  private async page<T>(token: string, path: string, params: Record<string, string>, page: number): Promise<TikTokEnvelope<T>> {
    const url = new URL(`${this.root}${path}`);
    for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
    url.searchParams.set("page", String(page));
    url.searchParams.set("page_size", "1000");
    const payload = await responseJson<TikTokEnvelope<T>>(this.platform, this.fetchImpl, url.toString(), {
      headers: { Accept: "application/json", "Access-Token": token },
    });
    if (!isRecord(payload)) invalidResponse(this.platform);
    if (payload.code !== 0) throw new PaidProviderError(this.platform, "provider", true);
    const data = optionalRecord(this.platform, payload.data);
    if (!data || !Array.isArray(data.list) || !data.list.every(isRecord)) {
      throw new PaidProviderError(this.platform, "invalid_response", true);
    }
    const pageInfo = optionalRecord(this.platform, data.page_info);
    for (const value of [pageInfo?.page, pageInfo?.total_page, pageInfo?.total_number]) {
      if (value != null && (!Number.isInteger(value) || Number(value) < 0)) invalidResponse(this.platform);
    }
    return payload;
  }

  private async pages<T>(token: string, path: string, params: Record<string, string>): Promise<T[]> {
    const out: T[] = [];
    for (let page = 1; page <= 100; page += 1) {
      const payload = await this.page<T>(token, path, params, page);
      const rows = payload.data?.list as T[];
      out.push(...rows);
      const totalPage = payload.data?.page_info?.total_page ?? page;
      if (page >= totalPage) return out;
      if (page === 100) throw new PaidProviderError(this.platform, "pagination_incomplete", true);
    }
    throw new PaidProviderError(this.platform, "pagination_incomplete", true);
  }

  private async accountMeta(connection: Connection, token: string): Promise<{ currency: string | null; timezone: string | null }> {
    const rows = await this.pages<{ currency?: string; timezone?: string }>(token, "/advertiser/info/", {
      advertiser_ids: JSON.stringify([connection.externalAccountId]),
      fields: JSON.stringify(["currency", "timezone"]),
    });
    for (const row of rows) {
      requiredText(this.platform, row.currency);
      requiredText(this.platform, row.timezone);
    }
    return { currency: normalizeCurrency(rows[0]?.currency), timezone: rows[0]?.timezone ?? null };
  }

  async fetchMetricsSnapshot(connection: Connection, range: MetricRange): Promise<FetchSnapshot<CanonicalMetric>> {
    const token = await this.tokenProvider(connection, this.platform);
    const params = {
      advertiser_id: connection.externalAccountId,
      report_type: "BASIC",
      data_level: "AUCTION_CAMPAIGN",
      dimensions: JSON.stringify(["campaign_id", "stat_time_day"]),
      metrics: JSON.stringify(["campaign_name", "spend", "impressions", "clicks", "conversion", "total_purchase_value"]),
      start_date: isoDay(range.from),
      end_date: isoDay(range.to),
    };
    const [meta, raw] = await Promise.all([
      this.accountMeta(connection, token),
      this.pages<TikTokReportRow>(token, "/report/integrated/get/", params),
    ]);
    const items = raw.flatMap((row) => {
      const dimensions = optionalRecord(this.platform, row.dimensions);
      const metrics = optionalRecord(this.platform, row.metrics);
      if (!dimensions || !metrics) invalidResponse(this.platform);
      const id = requiredId(this.platform, dimensions.campaign_id);
      const date = strictDay(this.platform, dimensions.stat_time_day);
      return addMetricRows({
        platform: this.platform,
        date,
        campaignExternalId: id,
        campaignName: optionalText(this.platform, metrics.campaign_name) ?? null,
        spend: optionalNumber(this.platform, metrics.spend),
        revenue: optionalNumber(this.platform, metrics.total_purchase_value),
        conversions: optionalNumber(this.platform, metrics.conversion),
        clicks: optionalNumber(this.platform, metrics.clicks),
        impressions: optionalNumber(this.platform, metrics.impressions),
      });
    });
    return snapshot({ items, ...meta, ...observedRange(items, (item) => item.date) });
  }

  async fetchCampaignsSnapshot(connection: Connection): Promise<FetchSnapshot<CampaignConfig>> {
    const token = await this.tokenProvider(connection, this.platform);
    const [meta, raw] = await Promise.all([
      this.accountMeta(connection, token),
      this.pages<TikTokCampaign>(token, "/campaign/get/", {
        advertiser_id: connection.externalAccountId,
        fields: JSON.stringify(["campaign_id", "campaign_name", "operation_status", "objective_type", "budget", "budget_mode"]),
      }),
    ]);
    const items = raw.map((campaign): CampaignConfig => {
      const id = requiredId(this.platform, campaign.campaign_id);
      const name = requiredText(this.platform, campaign.campaign_name);
      const budget = optionalNumber(this.platform, campaign.budget);
      const budgetMode = optionalText(this.platform, campaign.budget_mode);
      const budgetType: CampaignConfig["budgetType"] = budget == null
        ? null
        : budgetMode?.toUpperCase().includes("TOTAL") ? "lifetime" : "daily";
      return {
        platform: this.platform,
        externalId: id,
        name,
        status: normalizeStatus(optionalText(this.platform, campaign.operation_status)),
        objective: prettyToken(optionalText(this.platform, campaign.objective_type)),
        budget,
        budgetType,
        currency: meta.currency,
      };
    });
    return snapshot({ items, ...meta });
  }

  async fetchAdsSnapshot(connection: Connection, range: MetricRange): Promise<FetchSnapshot<AdCreative>> {
    const token = await this.tokenProvider(connection, this.platform);
    const perfParams = {
      advertiser_id: connection.externalAccountId,
      report_type: "BASIC",
      data_level: "AUCTION_AD",
      dimensions: JSON.stringify(["ad_id"]),
      metrics: JSON.stringify(["spend", "impressions", "clicks", "conversion"]),
      start_date: isoDay(range.from),
      end_date: isoDay(range.to),
    };
    const [meta, rawAds, performance] = await Promise.all([
      this.accountMeta(connection, token),
      this.pages<TikTokAd>(token, "/ad/get/", {
        advertiser_id: connection.externalAccountId,
        fields: JSON.stringify(["ad_id", "ad_name", "campaign_id", "campaign_name", "adgroup_name", "operation_status", "ad_text", "landing_page_url", "call_to_action", "image_ids", "video_id"]),
      }),
      this.pages<TikTokReportRow>(token, "/report/integrated/get/", perfParams),
    ]);
    const perfById = new Map(performance.map((row) => {
      const dimensions = optionalRecord(this.platform, row.dimensions);
      const metrics = optionalRecord(this.platform, row.metrics);
      if (!dimensions || !metrics) invalidResponse(this.platform);
      return [requiredId(this.platform, dimensions.ad_id), metrics] as const;
    }));
    const items = rawAds.map((ad): AdCreative => {
      const id = requiredId(this.platform, ad.ad_id);
      const name = requiredText(this.platform, ad.ad_name);
      const perf = perfById.get(id);
      const imageIds = ad.image_ids == null
        ? undefined
        : Array.isArray(ad.image_ids) && ad.image_ids.every((entry) => typeof entry === "string")
          ? ad.image_ids
          : invalidResponse(this.platform);
      return {
        platform: this.platform,
        externalId: id,
        campaignExternalId: ad.campaign_id == null ? null : requiredId(this.platform, ad.campaign_id),
        campaignName: optionalText(this.platform, ad.campaign_name) ?? null,
        adsetName: optionalText(this.platform, ad.adgroup_name) ?? null,
        name,
        status: normalizeStatus(optionalText(this.platform, ad.operation_status)),
        creativeType: optionalText(this.platform, ad.video_id) ? "video" : imageIds?.length ? "image" : null,
        body: optionalText(this.platform, ad.ad_text) ?? null,
        callToAction: prettyToken(optionalText(this.platform, ad.call_to_action)),
        linkUrl: optionalText(this.platform, ad.landing_page_url) ?? null,
        spend: optionalNumber(this.platform, perf?.spend),
        impressions: optionalNumber(this.platform, perf?.impressions),
        clicks: optionalNumber(this.platform, perf?.clicks),
        conversions: optionalNumber(this.platform, perf?.conversion),
        currency: meta.currency,
      };
    });
    return snapshot({
      items,
      ...meta,
      observedFrom: performance.length > 0 ? range.from : null,
      observedTo: performance.length > 0 ? range.to : null,
    });
  }
}

interface TikTokReportRow {
  dimensions?: Record<string, string | number>;
  metrics?: Record<string, string | number>;
}
interface TikTokCampaign {
  campaign_id?: string | number; campaign_name?: string; operation_status?: string;
  objective_type?: string; budget?: string | number; budget_mode?: string;
}
interface TikTokAd {
  ad_id?: string | number; ad_name?: string; campaign_id?: string | number; campaign_name?: string;
  adgroup_name?: string; operation_status?: string; ad_text?: string; landing_page_url?: string;
  call_to_action?: string; image_ids?: string[]; video_id?: string;
}

export function createPaidReadClient(
  platform: PaidSyncPlatform,
  fetchImpl: FetchLike = fetch,
  tokenProvider: ConnectionTokenProvider = getConnectionAccessToken,
): PaidReadClient {
  if (platform === "google_ads") return new GooglePaidClient(fetchImpl, tokenProvider);
  if (platform === "meta_ads") return new MetaPaidClient(fetchImpl, tokenProvider);
  return new TikTokPaidClient(fetchImpl, tokenProvider);
}

export function safePaidClient(
  platform: ConnectorPlatform,
  fetchImpl: FetchLike = fetch,
  tokenProvider: ConnectionTokenProvider = getConnectionAccessToken,
): PaidReadClient {
  if (!isPaidSyncPlatform(platform)) throw new PaidProviderError(platform, "not_supported", false);
  return createPaidReadClient(platform, fetchImpl, tokenProvider);
}
