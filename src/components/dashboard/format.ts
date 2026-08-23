/**
 * Frontend compatibility types and formatting for the paid command center.
 *
 * The current dashboard API predates account-aware reporting. The normalizer
 * accepts that legacy shape and the richer Sprint 9 shape without inventing
 * identifiers, currencies, coverage, or missing metric values.
 */

export type MetricKey =
  | "spend"
  | "revenue"
  | "roas"
  | "cpa"
  | "conversions"
  | "clicks"
  | "impressions"
  | "ctr"
  | "cpc"
  | "cpm"
  | "cvr"
  | "aov";

export const METRIC_KEYS: MetricKey[] = [
  "spend", "revenue", "roas", "cpa", "conversions", "clicks",
  "impressions", "ctr", "cpc", "cpm", "cvr", "aov",
];

export const MONEY_METRICS = new Set<MetricKey>(["spend", "revenue", "cpa", "cpc", "cpm", "aov"]);

export type MetricRecord = Record<MetricKey, number | null>;
export type PaidSourceState = "available" | "partial" | "failed" | "stale" | "revoked" | "unavailable";

export interface PaidSource {
  key: string;
  id: string;
  accountId: string | null;
  accountName: string;
  platform: string;
  platformLabel: string;
  currency: string | null;
  timezone: string | null;
  currencyUnsafe: boolean;
  state: PaidSourceState;
  detail: string | null;
  requestedFrom: string | null;
  requestedTo: string | null;
  observedFrom: string | null;
  observedTo: string | null;
  lastSyncedAt: string | null;
}

export type PaidDailyPoint = { date: string } & MetricRecord;

export type PaidAd = {
  externalId: string;
  name: string;
  status: string | null;
  creativeType: string | null;
  thumbnailUrl: string | null;
  title: string | null;
  body: string | null;
  callToAction: string | null;
  linkUrl: string | null;
  currency: string | null;
  timezone: string | null;
  metricsFrom: string | null;
  metricsTo: string | null;
} & MetricRecord;

export type PaidCampaign = {
  identity: string;
  accountKey: string;
  accountId: string | null;
  accountName: string;
  externalId: string | null;
  platform: string;
  label: string;
  campaign: string;
  currency: string | null;
  timezone: string | null;
  currencyUnsafe: boolean;
  sourceState: PaidSourceState;
  observedFrom: string | null;
  observedTo: string | null;
  status: string | null;
  objective: string | null;
  budget: number | null;
  budgetType: string | null;
  series: PaidDailyPoint[];
  ads: PaidAd[];
} & MetricRecord;

export type PaidPlatform = {
  platform: string;
  label: string;
  currency: string | null;
  mixedCurrency: boolean;
} & MetricRecord;

export interface PaidRange {
  from: string;
  to: string;
  days: number;
}

export interface PaidDashboardData {
  totals: MetricRecord;
  previous: MetricRecord;
  series: PaidDailyPoint[];
  platforms: PaidPlatform[];
  campaigns: PaidCampaign[];
  range: PaidRange;
  sources: PaidSource[];
  currency: string | null;
  currencies: string[];
  mixedCurrency: boolean;
  observedFrom: string | null;
  observedTo: string | null;
  state: PaidSourceState;
  stateDetail: string | null;
}

type UnknownRecord = Record<string, unknown>;

const PLATFORM_LABEL: Record<string, string> = {
  google_ads: "Google Ads",
  meta_ads: "Meta Ads",
  tiktok_ads: "TikTok Ads",
};

function record(value: unknown): UnknownRecord {
  return value != null && typeof value === "object" && !Array.isArray(value) ? value as UnknownRecord : {};
}

function list(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function firstString(source: UnknownRecord, ...keys: string[]): string | null {
  for (const key of keys) {
    const value = source[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

function finiteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function trueFlag(source: UnknownRecord, ...keys: string[]): boolean {
  return keys.some((key) => source[key] === true);
}

function normalCurrency(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const currency = value.trim().toUpperCase();
  return /^[A-Z]{3}$/.test(currency) ? currency : null;
}

function platformName(platform: string): string {
  return PLATFORM_LABEL[platform] ?? platform.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export function normalizeSourceState(value: unknown, fallback: PaidSourceState = "unavailable"): PaidSourceState {
  if (typeof value !== "string") return fallback;
  const state = value.trim().toLowerCase();
  if (["ok", "healthy", "success", "succeeded", "synced", "live", "available", "complete", "completed"].includes(state)) return "available";
  if (["partial", "partially_synced", "completed_with_errors", "warning"].includes(state)) return "partial";
  if (["error", "failed", "failure"].includes(state)) return "failed";
  if (["stale", "outdated"].includes(state)) return "stale";
  if (["revoked", "expired", "reauthorize", "reauthorization_required", "disconnected"].includes(state)) return "revoked";
  if (["unavailable", "pending", "never_synced", "unknown"].includes(state)) return "unavailable";
  return fallback;
}

function accountKey(platform: string, accountId: string | null): string {
  return `${platform}:${accountId ?? "legacy"}`;
}

interface MetricRead {
  present: boolean;
  value: number | null;
}

function readMetric(source: UnknownRecord, key: MetricKey): MetricRead {
  const availability = record(source.metricAvailability ?? source.metric_availability ?? source.availability);
  if (Object.prototype.hasOwnProperty.call(availability, key) && availability[key] === false) {
    return { present: true, value: null };
  }

  const availableMetrics = source.availableMetrics ?? source.available_metrics;
  if (Array.isArray(availableMetrics) && !availableMetrics.includes(key)) {
    return { present: true, value: null };
  }

  const metrics = record(source.metrics);
  if (Object.prototype.hasOwnProperty.call(metrics, key)) {
    return { present: true, value: finiteNumber(metrics[key]) };
  }
  if (Object.prototype.hasOwnProperty.call(source, key)) {
    return { present: true, value: finiteNumber(source[key]) };
  }
  return { present: false, value: null };
}

function ratio(numerator: number | null, denominator: number | null, multiplier = 1): number | null {
  if (numerator == null || denominator == null || denominator <= 0) return null;
  return (numerator / denominator) * multiplier;
}

function normalizeMetrics(sourceValue: unknown): MetricRecord {
  const source = record(sourceValue);
  const reads = Object.fromEntries(METRIC_KEYS.map((key) => [key, readMetric(source, key)])) as Record<MetricKey, MetricRead>;
  const result = Object.fromEntries(METRIC_KEYS.map((key) => [key, reads[key].value])) as MetricRecord;

  if (!reads.roas.present) result.roas = ratio(result.revenue, result.spend);
  if (!reads.cpa.present) result.cpa = ratio(result.spend, result.conversions);
  if (!reads.ctr.present) result.ctr = ratio(result.clicks, result.impressions, 100);
  if (!reads.cpc.present) result.cpc = ratio(result.spend, result.clicks);
  if (!reads.cpm.present) result.cpm = ratio(result.spend, result.impressions, 1000);
  if (!reads.cvr.present) result.cvr = ratio(result.conversions, result.clicks, 100);
  if (!reads.aov.present) result.aov = ratio(result.revenue, result.conversions);
  return result;
}

function normalizePoint(value: unknown): PaidDailyPoint | null {
  const source = record(value);
  const date = firstString(source, "date", "day");
  if (!date) return null;
  return { date, ...normalizeMetrics(source) };
}

function sourceFrom(value: unknown, fallbackState: PaidSourceState): PaidSource | null {
  const source = record(value);
  const platform = firstString(source, "platform", "platformId", "source") ?? "unknown";
  const accountId = firstString(source, "accountId", "account_id", "externalAccountId", "externalId", "id");
  const name = firstString(source, "accountName", "accountLabel", "name", "label") ?? accountId ?? platformName(platform);
  return {
    key: accountKey(platform, accountId),
    id: firstString(source, "id") ?? accountId ?? accountKey(platform, accountId),
    accountId,
    accountName: name,
    platform,
    platformLabel: firstString(source, "platformLabel", "sourceLabel") ?? platformName(platform),
    currency: normalCurrency(source.currency ?? source.currencyCode),
    timezone: firstString(source, "timezone", "timeZone"),
    currencyUnsafe: trueFlag(source, "mixedCurrency", "currencyUnsafe", "unsafeCurrency"),
    state: normalizeSourceState(source.state ?? source.status ?? source.syncStatus, fallbackState),
    detail: firstString(source, "detail", "message", "error"),
    requestedFrom: firstString(source, "requestedFrom", "requestFrom"),
    requestedTo: firstString(source, "requestedTo", "requestTo"),
    observedFrom: firstString(source, "observedFrom", "dataFrom", "coverageFrom", "from"),
    observedTo: firstString(source, "observedTo", "dataTo", "coverageTo", "to"),
    lastSyncedAt: firstString(source, "lastSyncedAt", "syncedAt", "updatedAt"),
  };
}

function sourceSeverity(state: PaidSourceState): number {
  return { available: 0, unavailable: 1, stale: 2, partial: 3, failed: 4, revoked: 5 }[state];
}

function overallSourceState(sources: PaidSource[], explicit: unknown): PaidSourceState {
  const explicitState = normalizeSourceState(explicit, "unavailable");
  if (typeof explicit === "string" && explicitState !== "unavailable") return explicitState;
  return sources.reduce<PaidSourceState>(
    (worst, source) => sourceSeverity(source.state) > sourceSeverity(worst) ? source.state : worst,
    sources.length > 0 ? "available" : "unavailable",
  );
}

function normalizeAd(value: unknown, fallbackCurrency: string | null, fallbackTimezone: string | null): PaidAd {
  const source = record(value);
  return {
    externalId: firstString(source, "externalId", "adExternalId", "id") ?? "unknown-ad",
    name: firstString(source, "name", "adName") ?? "Unnamed ad",
    status: firstString(source, "status"),
    creativeType: firstString(source, "creativeType", "type"),
    thumbnailUrl: firstString(source, "thumbnailUrl", "imageUrl"),
    title: firstString(source, "title", "headline"),
    body: firstString(source, "body", "copy"),
    callToAction: firstString(source, "callToAction", "cta"),
    linkUrl: firstString(source, "linkUrl", "destinationUrl"),
    currency: normalCurrency(source.currency ?? source.currencyCode) ?? fallbackCurrency,
    timezone: firstString(source, "timezone", "timeZone") ?? fallbackTimezone,
    metricsFrom: firstString(source, "metricsFrom", "observedFrom", "dataFrom"),
    metricsTo: firstString(source, "metricsTo", "observedTo", "dataTo"),
    ...normalizeMetrics(source),
  };
}

function normalizeRange(value: unknown): PaidRange {
  const source = record(value);
  const from = firstString(source, "from") ?? "";
  const to = firstString(source, "to") ?? "";
  const suppliedDays = finiteNumber(source.days);
  return { from, to, days: suppliedDays == null ? 0 : Math.max(0, Math.round(suppliedDays)) };
}

function minDate(values: Array<string | null>): string | null {
  const present = values.filter((value): value is string => !!value).sort();
  return present[0] ?? null;
}

function maxDate(values: Array<string | null>): string | null {
  const present = values.filter((value): value is string => !!value).sort();
  return present[present.length - 1] ?? null;
}

export function emptyPaidDashboard(): PaidDashboardData {
  const empty = normalizeMetrics({});
  return {
    totals: { ...empty },
    previous: { ...empty },
    series: [],
    platforms: [],
    campaigns: [],
    range: { from: "", to: "", days: 0 },
    sources: [],
    currency: null,
    currencies: [],
    mixedCurrency: false,
    observedFrom: null,
    observedTo: null,
    state: "unavailable",
    stateDetail: null,
  };
}

/** Normalize legacy and enhanced `/api/dashboard` data into one truthful UI shape. */
export function normalizePaidDashboard(rawValue: unknown, envelopeValue?: unknown): PaidDashboardData {
  const raw = record(rawValue);
  const envelope = record(envelopeValue);
  const envelopeMode = envelope.mode ?? envelope.state ?? envelope.status;
  const fallbackState: PaidSourceState = envelopeMode === "live" || envelopeMode === "sample" ? "available" : "unavailable";
  const rawSources = [...list(raw.accounts), ...list(raw.sources), ...list(envelope.accounts), ...list(envelope.sources)];
  const sourceMap = new Map<string, PaidSource>();
  for (const candidate of rawSources) {
    const source = sourceFrom(candidate, fallbackState);
    if (!source) continue;
    const previous = sourceMap.get(source.key);
    if (!previous || sourceSeverity(source.state) >= sourceSeverity(previous.state)) sourceMap.set(source.key, source);
  }

  const topCurrency = normalCurrency(raw.currency ?? raw.currencyCode ?? envelope.currency ?? envelope.currencyCode);
  const seenIdentities = new Set<string>();
  const campaigns = list(raw.campaigns).map((value, index): PaidCampaign => {
    const source = record(value);
    const platform = firstString(source, "platform", "platformId", "source") ?? "unknown";
    const accountId = firstString(source, "accountId", "account_id", "externalAccountId");
    const matchedSource = sourceMap.get(accountKey(platform, accountId))
      ?? [...sourceMap.values()].find((entry) => entry.platform === platform && (!accountId || entry.accountId === accountId));
    const externalId = firstString(source, "externalId", "campaignExternalId", "campaignId", "id");
    const campaign = firstString(source, "campaign", "name", "campaignName") ?? externalId ?? "Unnamed campaign";
    const resolvedAccountId = accountId ?? matchedSource?.accountId ?? null;
    const resolvedAccountKey = accountKey(platform, resolvedAccountId);
    const baseIdentity = resolvedAccountId && externalId
      ? `${resolvedAccountId}:${externalId}`
      : externalId
        ? `${platform}:${externalId}`
        : `${resolvedAccountKey}:${campaign}:${index}`;
    let identity = baseIdentity;
    let suffix = 1;
    while (seenIdentities.has(identity)) identity = `${baseIdentity}:${suffix++}`;
    seenIdentities.add(identity);
    const currency = normalCurrency(source.currency ?? source.currencyCode) ?? matchedSource?.currency ?? topCurrency;
    const timezone = firstString(source, "timezone", "timeZone") ?? matchedSource?.timezone ?? null;
    const sourceState = normalizeSourceState(source.sourceState ?? source.syncState ?? source.state, matchedSource?.state ?? fallbackState);
    return {
      identity,
      accountKey: resolvedAccountKey,
      accountId: resolvedAccountId,
      accountName: firstString(source, "accountName", "accountLabel") ?? matchedSource?.accountName ?? platformName(platform),
      externalId,
      platform,
      label: firstString(source, "label", "platformLabel") ?? matchedSource?.platformLabel ?? platformName(platform),
      campaign,
      currency,
      timezone,
      currencyUnsafe: trueFlag(source, "mixedCurrency", "currencyUnsafe", "unsafeCurrency"),
      sourceState,
      observedFrom: firstString(source, "observedFrom", "dataFrom", "coverageFrom") ?? matchedSource?.observedFrom ?? null,
      observedTo: firstString(source, "observedTo", "dataTo", "coverageTo") ?? matchedSource?.observedTo ?? null,
      status: firstString(source, "status"),
      objective: firstString(source, "objective"),
      budget: finiteNumber(source.budget),
      budgetType: firstString(source, "budgetType"),
      series: list(source.series).map(normalizePoint).filter((point): point is PaidDailyPoint => point != null),
      ads: list(source.ads).map((ad) => normalizeAd(ad, currency, timezone)),
      ...normalizeMetrics(source),
    };
  });

  if (sourceMap.size === 0) {
    for (const campaign of campaigns) {
      if (sourceMap.has(campaign.accountKey)) continue;
      sourceMap.set(campaign.accountKey, {
        key: campaign.accountKey,
        id: campaign.accountId ?? campaign.accountKey,
        accountId: campaign.accountId,
        accountName: campaign.accountName,
        platform: campaign.platform,
        platformLabel: campaign.label,
        currency: campaign.currency,
        timezone: campaign.timezone,
        currencyUnsafe: campaign.currencyUnsafe,
        state: campaign.sourceState,
        detail: campaign.accountId ? null : "Account details are not included in this response.",
        requestedFrom: null,
        requestedTo: null,
        observedFrom: campaign.observedFrom,
        observedTo: campaign.observedTo,
        lastSyncedAt: null,
      });
    }
  }

  const sources = [...sourceMap.values()];
  const currencySet = new Set<string>();
  if (topCurrency) currencySet.add(topCurrency);
  for (const source of sources) if (source.currency) currencySet.add(source.currency);
  for (const campaign of campaigns) if (campaign.currency) currencySet.add(campaign.currency);
  const currencies = [...currencySet].sort();
  const backendCurrencyUnsafe = trueFlag(raw, "mixedCurrency", "currencyUnsafe", "unsafeCurrency")
    || trueFlag(envelope, "mixedCurrency", "currencyUnsafe", "unsafeCurrency");
  const mixedCurrency = backendCurrencyUnsafe
    || currencies.length > 1
    || sources.some((source) => source.currencyUnsafe)
    || campaigns.some((campaign) => campaign.currencyUnsafe);
  if (mixedCurrency) {
    for (const source of sources) {
      if (!source.currency) source.currencyUnsafe = true;
    }
    for (const campaign of campaigns) {
      if (!campaign.currency) campaign.currencyUnsafe = true;
    }
  }
  const singleCurrency = currencies.length === 1 ? currencies[0] : null;

  const platforms = list(raw.platforms).map((value): PaidPlatform => {
    const source = record(value);
    const platform = firstString(source, "platform", "platformId") ?? "unknown";
    const childCurrencies = new Set(
      campaigns.filter((campaign) => campaign.platform === platform).map((campaign) => campaign.currency).filter((currency): currency is string => !!currency),
    );
    return {
      platform,
      label: firstString(source, "label", "platformLabel") ?? platformName(platform),
      currency: normalCurrency(source.currency ?? source.currencyCode)
        ?? (childCurrencies.size === 1 ? [...childCurrencies][0] : singleCurrency),
      mixedCurrency: childCurrencies.size > 1,
      ...normalizeMetrics(source),
    };
  });

  const coverage = record(raw.coverage ?? envelope.coverage);
  const observedFrom = firstString(raw, "observedFrom", "dataFrom", "coverageFrom")
    ?? firstString(coverage, "observedFrom", "from")
    ?? minDate(sources.map((source) => source.observedFrom));
  const observedTo = firstString(raw, "observedTo", "dataTo", "coverageTo")
    ?? firstString(coverage, "observedTo", "to")
    ?? maxDate(sources.map((source) => source.observedTo));

  return {
    totals: normalizeMetrics(raw.totals),
    previous: normalizeMetrics(raw.previous),
    series: list(raw.series).map(normalizePoint).filter((point): point is PaidDailyPoint => point != null),
    platforms,
    campaigns,
    range: normalizeRange(raw.range),
    sources,
    currency: singleCurrency,
    currencies,
    mixedCurrency,
    observedFrom,
    observedTo,
    state: overallSourceState(sources, raw.state ?? raw.status ?? envelope.state ?? envelope.status),
    stateDetail: firstString(raw, "stateDetail", "detail", "message") ?? firstString(envelope, "stateDetail", "detail", "message"),
  };
}

function money(n: number | null, currency: string | null | undefined, digits: number): string {
  if (n == null || !currency) return "—";
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency,
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    }).format(n);
  } catch {
    return "—";
  }
}

export function money0(n: number | null, currency?: string | null): string {
  return money(n, currency, 0);
}

export function money2(n: number | null, currency?: string | null): string {
  return money(n, currency, 2);
}

export function num0(n: number | null): string {
  return n == null ? "—" : Math.round(n).toLocaleString("en-US");
}

export function compact(n: number | null): string {
  if (n == null) return "—";
  const abs = Math.abs(n);
  if (abs >= 1_000_000) return (n / 1_000_000).toFixed(n % 1_000_000 === 0 ? 0 : 1) + "M";
  if (abs >= 1_000) return (n / 1_000).toFixed(n % 1_000 === 0 ? 0 : 1) + "k";
  return String(Math.round(n));
}

export function moneyCompact(n: number | null, currency?: string | null): string {
  if (n == null || !currency) return "—";
  try {
    const symbol = new Intl.NumberFormat("en-US", { style: "currency", currency, currencyDisplay: "narrowSymbol" })
      .formatToParts(0).find((part) => part.type === "currency")?.value ?? currency;
    return `${symbol}${compact(n)}`;
  } catch {
    return "—";
  }
}

export function roasX(n: number | null): string {
  return n == null ? "—" : `${Number(n.toFixed(2))}×`;
}

export function pct(n: number | null): string {
  return n == null ? "—" : `${Number(n.toFixed(2))}%`;
}

export function roasColor(roas: number | null): string {
  if (roas == null) return "#8B8478";
  if (roas >= 3) return "#4C6B40";
  if (roas >= 1.5) return "#6B6359";
  return "#B23A4B";
}

export interface ColumnDef {
  key: MetricKey;
  label: string;
  full: string;
  betterWhen: "up" | "down" | "flat";
  fmt: (value: number | null, currency?: string | null) => string;
  axisFmt: (value: number | null, currency?: string | null) => string;
  roasColored?: boolean;
}

export const COLUMNS: Record<MetricKey, ColumnDef> = {
  spend: { key: "spend", label: "Spend", full: "Spend", betterWhen: "flat", fmt: money0, axisFmt: moneyCompact },
  revenue: { key: "revenue", label: "Revenue", full: "Revenue", betterWhen: "up", fmt: money0, axisFmt: moneyCompact },
  roas: { key: "roas", label: "ROAS", full: "ROAS (revenue ÷ spend)", betterWhen: "up", fmt: roasX, axisFmt: roasX, roasColored: true },
  cpa: { key: "cpa", label: "CPA", full: "Cost per acquisition", betterWhen: "down", fmt: money2, axisFmt: moneyCompact },
  conversions: { key: "conversions", label: "Results", full: "Results (conversions)", betterWhen: "up", fmt: num0, axisFmt: compact },
  clicks: { key: "clicks", label: "Clicks", full: "Clicks", betterWhen: "up", fmt: num0, axisFmt: compact },
  impressions: { key: "impressions", label: "Impr.", full: "Impressions", betterWhen: "up", fmt: num0, axisFmt: compact },
  ctr: { key: "ctr", label: "CTR", full: "Click-through rate", betterWhen: "up", fmt: pct, axisFmt: pct },
  cpc: { key: "cpc", label: "CPC", full: "Cost per click", betterWhen: "down", fmt: money2, axisFmt: moneyCompact },
  cpm: { key: "cpm", label: "CPM", full: "Cost per 1,000 impressions", betterWhen: "down", fmt: money2, axisFmt: moneyCompact },
  cvr: { key: "cvr", label: "CVR", full: "Conversion rate", betterWhen: "up", fmt: pct, axisFmt: pct },
  aov: { key: "aov", label: "AOV", full: "Average order value", betterWhen: "up", fmt: money2, axisFmt: moneyCompact },
};

export const COLUMN_ORDER: MetricKey[] = [
  "spend", "revenue", "roas", "cpa", "conversions",
  "clicks", "impressions", "ctr", "cpc", "cpm", "cvr", "aov",
];

export const DEFAULT_COLUMNS: MetricKey[] = ["spend", "revenue", "roas", "cpa", "conversions"];

export function metricIsUnavailable(key: MetricKey, value: number | null, currency?: string | null): boolean {
  return value == null || (MONEY_METRICS.has(key) && !currency);
}

export function dailyValue(point: PaidDailyPoint, key: MetricKey): number | null {
  return point[key];
}

export function campaignValue(campaign: PaidCampaign, key: MetricKey): number | null {
  return campaign[key];
}

export function totalValue(totals: MetricRecord, key: MetricKey): number | null {
  return totals[key];
}

export type Tone = "good" | "bad" | "neutral";

export interface Delta {
  label: string;
  tone: Tone;
}

export function deltaFor(key: MetricKey, curr: number | null, prev: number | null): Delta {
  if (curr == null || prev == null || prev === 0 || !Number.isFinite(prev)) return { label: "—", tone: "neutral" };
  const change = (curr - prev) / prev;
  if (!Number.isFinite(change)) return { label: "—", tone: "neutral" };
  const sign = change > 0 ? "+" : change < 0 ? "−" : "";
  const label = `${sign}${Math.abs(change * 100).toFixed(1)}%`;
  const better = COLUMNS[key].betterWhen;
  let tone: Tone = "neutral";
  if (better !== "flat" && Math.abs(change) >= 0.0005) {
    const improved = better === "up" ? change > 0 : change < 0;
    tone = improved ? "good" : "bad";
  }
  return { label, tone };
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function dayLabel(iso: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!match) return iso;
  return `${MONTHS[Number(match[2]) - 1]} ${Number(match[3])}`;
}

export function coverageLabel(from: string | null, to: string | null, timezone?: string | null): string {
  const zone = timezone?.trim() || "timezone unavailable";
  if (!from && !to) return `Coverage unavailable (${zone})`;
  if (from && to) return `${dayLabel(from)} – ${dayLabel(to)} (${zone})`;
  return `${dayLabel(from ?? to ?? "")} (${zone})`;
}

export function sourceStateLabel(state: PaidSourceState): string {
  return {
    available: "Available",
    partial: "Partial",
    failed: "Failed",
    stale: "Stale",
    revoked: "Reconnect",
    unavailable: "Unavailable",
  }[state];
}

export function sourceStateColor(state: PaidSourceState): string {
  if (state === "available") return "#4C6B40";
  if (state === "partial" || state === "stale") return "#9A6A16";
  if (state === "failed" || state === "revoked") return "#B23A4B";
  return "#8B8478";
}

export function resultLabel(objective: string | null | undefined): string {
  if (!objective) return "Conversions";
  const value = objective.toLowerCase();
  if (value.includes("install") || value.includes("app promotion")) return "Installs";
  if (value.includes("lead")) return "Leads";
  if (value.includes("registration") || value.includes("sign")) return "Sign-ups";
  if (value.includes("subscrib")) return "Subscriptions";
  if (value.includes("cart")) return "Adds to cart";
  if (value.includes("sale") || value.includes("purchase") || value.includes("catalog") || value.includes("commerce")) return "Purchases";
  if (value.includes("traffic") || value.includes("link click")) return "Link clicks";
  if (value.includes("engagement") || value.includes("post")) return "Engagements";
  if (value.includes("awareness") || value.includes("reach") || value.includes("brand")) return "Reach";
  if (value.includes("video")) return "Video views";
  if (value.includes("message") || value.includes("conversation")) return "Conversations";
  return "Conversions";
}
