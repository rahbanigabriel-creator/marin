"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { LuFileText, LuPlug, LuRefreshCw, LuLayoutGrid, LuList, LuSearch, LuX } from "react-icons/lu";
import { DateRangePicker } from "@/components/dashboard/DateRangePicker";
import { ColumnChooser } from "@/components/dashboard/ColumnChooser";
import { CampaignsTable } from "@/components/dashboard/CampaignsTable";
import { DrillDownPanel } from "@/components/dashboard/DrillDownPanel";
import { PaidOverview, PlatformMark, campaignStatus, type CampaignStatusFilter } from "@/components/dashboard/PaidOverview";
import { PaidCreativeGallery } from "@/components/dashboard/PaidCreativeGallery";
import { PaidDraftWorkspace } from "@/components/paid/PaidDraftWorkspace";
import {
  DEFAULT_COLUMNS,
  coverageLabel,
  emptyPaidDashboard,
  normalizePaidDashboard,
  normalizeSourceState,
  sourceStateColor,
  sourceStateLabel,
  type MetricKey,
  type MetricRecord,
  type PaidCampaign,
  type PaidDailyPoint,
  type PaidDashboardData,
  type PaidPlatform,
  type PaidSource,
  type PaidSourceState,
} from "@/components/dashboard/format";

type ScreenMode = "live" | "sample" | "empty" | "loading" | "failed";
type NoticeTone = "success" | "warning" | "error";

interface Notice {
  tone: NoticeTone;
  text: string;
}

const ADDITIVE: MetricKey[] = ["spend", "revenue", "conversions", "clicks", "impressions"];
const CACHED_SOURCE_STATES = new Set<PaidSourceState>(["failed", "revoked", "stale"]);

export function isCachedPaidSourceState(state: PaidSourceState): boolean {
  return CACHED_SOURCE_STATES.has(state);
}

function withCachedPrefix(value: string): string {
  return value.startsWith("Cached · ") ? value : `Cached · ${value}`;
}

/** Keep saved observations visible while making their non-current status impossible to miss. */
export function campaignWithIntegrityLabel(
  campaign: PaidCampaign,
  sources: PaidSource[],
  dashboardState: PaidSourceState,
): PaidCampaign {
  const source = sources.find((candidate) => candidate.key === campaign.accountKey);
  let effectiveState = campaign.sourceState;
  if (source && isCachedPaidSourceState(source.state)) effectiveState = source.state;
  else if (!isCachedPaidSourceState(effectiveState) && !source && sources.length === 0 && isCachedPaidSourceState(dashboardState)) {
    effectiveState = dashboardState;
  }

  if (!isCachedPaidSourceState(effectiveState)) return campaign;

  const observedFrom = campaign.observedFrom ?? source?.observedFrom ?? null;
  const observedTo = campaign.observedTo ?? source?.observedTo ?? null;
  const timezone = campaign.timezone ?? source?.timezone ?? null;
  return {
    ...campaign,
    campaign: withCachedPrefix(campaign.campaign),
    sourceState: effectiveState,
    observedFrom,
    observedTo,
    timezone,
    ads: campaign.ads.map((ad) => ({
      ...ad,
      name: withCachedPrefix(ad.name),
      metricsFrom: ad.metricsFrom ?? observedFrom,
      metricsTo: ad.metricsTo ?? observedTo,
      timezone: ad.timezone ?? timezone,
    })),
  };
}

function defaultRange(): { from: string; to: string } {
  const to = new Date();
  to.setUTCHours(0, 0, 0, 0);
  const from = new Date(to);
  from.setUTCDate(from.getUTCDate() - 29);
  return { from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10) };
}

function blankMetrics(): MetricRecord {
  return {
    spend: null,
    revenue: null,
    roas: null,
    cpa: null,
    conversions: null,
    clicks: null,
    impressions: null,
    ctr: null,
    cpc: null,
    cpm: null,
    cvr: null,
    aov: null,
  };
}

function ratio(numerator: number | null, denominator: number | null, multiplier = 1): number | null {
  if (numerator == null || denominator == null || denominator <= 0) return null;
  return (numerator / denominator) * multiplier;
}

function aggregateMetrics(rows: MetricRecord[], mixedCurrency: boolean): MetricRecord {
  const result = blankMetrics();
  if (rows.length === 0) return result;
  for (const key of ADDITIVE) {
    result[key] = rows.every((row) => row[key] != null)
      ? rows.reduce((sum, row) => sum + (row[key] ?? 0), 0)
      : null;
  }
  result.roas = mixedCurrency ? null : ratio(result.revenue, result.spend);
  result.cpa = mixedCurrency ? null : ratio(result.spend, result.conversions);
  result.ctr = ratio(result.clicks, result.impressions, 100);
  result.cpc = mixedCurrency ? null : ratio(result.spend, result.clicks);
  result.cpm = mixedCurrency ? null : ratio(result.spend, result.impressions, 1000);
  result.cvr = ratio(result.conversions, result.clicks, 100);
  result.aov = mixedCurrency ? null : ratio(result.revenue, result.conversions);
  return result;
}

function campaignCurrencies(campaigns: PaidCampaign[], sources: PaidSource[] = []): string[] {
  const values = new Set<string>();
  for (const campaign of campaigns) if (campaign.currency) values.add(campaign.currency);
  for (const source of sources) if (source.currency) values.add(source.currency);
  return [...values].sort();
}

function aggregateSeries(campaigns: PaidCampaign[], mixedCurrency: boolean): PaidDailyPoint[] {
  const dates = [...new Set(campaigns.flatMap((campaign) => campaign.series.map((point) => point.date)))].sort();
  const byCampaign = campaigns.map((campaign) => new Map(campaign.series.map((point) => [point.date, point])));
  return dates.map((date) => {
    const rows = byCampaign.map((points) => points.get(date) ?? blankMetrics());
    return { date, ...aggregateMetrics(rows, mixedCurrency) };
  });
}

function aggregatePlatforms(campaigns: PaidCampaign[]): PaidPlatform[] {
  const groups = new Map<string, PaidCampaign[]>();
  for (const campaign of campaigns) groups.set(campaign.platform, [...(groups.get(campaign.platform) ?? []), campaign]);
  return [...groups.entries()].map(([platform, rows]) => {
    const currencies = campaignCurrencies(rows);
    const mixedCurrency = currencies.length > 1 || rows.some((campaign) => campaign.currencyUnsafe);
    return {
      platform,
      label: rows[0]?.label ?? platform,
      currency: currencies.length === 1 ? currencies[0] : null,
      mixedCurrency,
      ...aggregateMetrics(rows, mixedCurrency),
    };
  }).sort((a, b) => {
    if (a.spend == null && b.spend == null) return a.label.localeCompare(b.label);
    if (a.spend == null) return 1;
    if (b.spend == null) return -1;
    return b.spend - a.spend;
  });
}

function minDate(values: Array<string | null>): string | null {
  return values.filter((value): value is string => !!value).sort()[0] ?? null;
}

function maxDate(values: Array<string | null>): string | null {
  const dates = values.filter((value): value is string => !!value).sort();
  return dates[dates.length - 1] ?? null;
}

function scopedDashboard(data: PaidDashboardData, campaigns: PaidCampaign[], sources: PaidSource[]): PaidDashboardData {
  const currencies = campaignCurrencies(campaigns, sources);
  const preservesWholeResponse = campaigns.length === data.campaigns.length && sources.length === data.sources.length;
  const mixedCurrency = currencies.length > 1
    || campaigns.some((campaign) => campaign.currencyUnsafe)
    || sources.some((source) => source.currencyUnsafe)
    || (preservesWholeResponse && data.mixedCurrency);
  return {
    ...data,
    campaigns,
    totals: aggregateMetrics(campaigns, mixedCurrency),
    previous: blankMetrics(),
    series: aggregateSeries(campaigns, mixedCurrency),
    platforms: aggregatePlatforms(campaigns),
    sources,
    currencies,
    currency: currencies.length === 1 ? currencies[0] : null,
    mixedCurrency,
    observedFrom: minDate(sources.map((source) => source.observedFrom)),
    observedTo: maxDate(sources.map((source) => source.observedTo)),
  };
}

function coverageTimezone(sources: PaidSource[]): string | null {
  const zones = [...new Set(sources.map((source) => source.timezone).filter((zone): zone is string => !!zone))];
  if (zones.length === 1) return zones[0];
  if (zones.length > 1) return "multiple source timezones";
  return null;
}

function currencySafetyLabel(data: PaidDashboardData): string {
  if (data.currencies.length === 0) return "Currency-safe totals unavailable because source currency is unknown.";
  const known = data.currencies.join(", ");
  const includesUnknown = data.sources.some((source) => !source.currency || source.currencyUnsafe)
    || data.campaigns.some((campaign) => !campaign.currency || campaign.currencyUnsafe);
  return includesUnknown
    ? `Currency-safe totals unavailable (${known} + unknown currency).`
    : `Multiple currencies selected (${known}).`;
}

function statusCopy(state: PaidSourceState): string {
  if (state === "partial") return "Some accounts returned partial data. Only supplied metrics and observed dates are shown.";
  if (state === "failed") return "At least one account failed to sync. Existing observations remain visible and are not presented as fresh.";
  if (state === "stale") return "This view contains stale observations. Check each account's coverage before acting on it.";
  if (state === "revoked") return "At least one account needs to be reconnected. Cached observations may be stale.";
  if (state === "unavailable") return "Account health or source coverage is unavailable for this response.";
  return "";
}

function screenMode(value: unknown): ScreenMode {
  if (value === "sample" || value === "empty") return value;
  return "live";
}

function syncResultList(payload: Record<string, unknown>): Record<string, unknown>[] {
  const candidate = payload.results ?? payload.accounts ?? payload.sources ?? payload.outcomes;
  return Array.isArray(candidate)
    ? candidate.filter((entry): entry is Record<string, unknown> => entry != null && typeof entry === "object" && !Array.isArray(entry))
    : [];
}

function syncNotice(payloadValue: unknown, responseOk: boolean): Notice {
  const payload = payloadValue != null && typeof payloadValue === "object" && !Array.isArray(payloadValue)
    ? payloadValue as Record<string, unknown>
    : {};
  const results = syncResultList(payload);
  const failed = results.filter((result) => {
    const state = normalizeSourceState(result.state ?? result.status ?? (result.ok === false ? "failed" : undefined), result.ok === false ? "failed" : "available");
    return state === "failed" || state === "revoked";
  });
  const partial = results.filter((result) => normalizeSourceState(result.state ?? result.status) === "partial");
  const errors = Array.isArray(payload.errors) ? payload.errors : [];
  const topState = normalizeSourceState(payload.state ?? payload.status, payload.ok === false || !responseOk ? "failed" : "available");
  const accountName = (result: Record<string, unknown>) => {
    const value = result.accountName ?? result.accountLabel ?? result.accountId ?? result.platform;
    return typeof value === "string" ? value : null;
  };
  const failedNames = failed.map(accountName).filter((value): value is string => !!value).slice(0, 3);

  if (!responseOk || payload.ok === false || topState === "failed" || topState === "revoked" || failed.length > 0 || errors.length > 0) {
    const total = results.length;
    const count = Math.max(failed.length, errors.length, 1);
    const scope = total > 0 ? `${count} of ${total} account${total === 1 ? "" : "s"} failed` : "the sync failed";
    const names = failedNames.length > 0 ? ` (${failedNames.join(", ")})` : "";
    const error = typeof payload.error === "string" ? `: ${payload.error}` : "";
    return { tone: "error", text: `Sync finished with issues: ${scope}${names}${error}.` };
  }
  if (topState === "partial" || partial.length > 0) {
    return { tone: "warning", text: `Sync partially completed for ${results.length || "the connected"} account${results.length === 1 ? "" : "s"}. Review account status below.` };
  }
  if (results.length > 0) {
    return { tone: "success", text: `Synced ${results.length} account${results.length === 1 ? "" : "s"}; all reported successful.` };
  }
  const connections = typeof payload.connections === "number" ? payload.connections : 0;
  const metrics = typeof payload.metrics === "number" ? payload.metrics : 0;
  return metrics > 0
    ? { tone: "success", text: `Synced ${connections} source${connections === 1 ? "" : "s"}; ${metrics} observations returned.` }
    : { tone: "warning", text: "Sync completed, but the source returned no new observations." };
}

function StatusBadge({ mode, state }: { mode: ScreenMode; state: PaidSourceState }): React.JSX.Element {
  if (mode === "sample") {
    return <span className="font-mono text-[10px] font-semibold text-ink-400">Sample data</span>;
  }
  const color = sourceStateColor(state);
  const label = state === "available" ? "Sources current" : sourceStateLabel(state);
  return (
    <span className="inline-flex items-center gap-[6px] font-mono text-[10px] font-semibold" style={{ color }}>
      <span className="h-[7px] w-[7px] rounded-full" style={{ background: color }} aria-hidden />
      {label}
    </span>
  );
}

export function PaidSyncButton({
  canManage,
  accessLoading = false,
  syncing,
  loading = false,
  onSync,
  className,
}: {
  canManage: boolean;
  accessLoading?: boolean;
  syncing: boolean;
  loading?: boolean;
  onSync: () => void;
  className: string;
}): React.JSX.Element {
  const readOnlyExplanation = "Only workspace owners and admins can sync ad accounts. You can still view and filter saved campaign data.";
  const unavailableExplanation = accessLoading ? "Checking workspace access." : readOnlyExplanation;
  return (
    <button
      type="button"
      onClick={canManage ? onSync : undefined}
      disabled={!canManage || syncing || loading}
      aria-label={canManage ? undefined : accessLoading ? "Checking workspace access" : `Sync unavailable. ${readOnlyExplanation}`}
      title={canManage ? undefined : unavailableExplanation}
      className={className}
    >
      <LuRefreshCw aria-hidden className={syncing && canManage ? "animate-spin" : ""} />
      {canManage ? (syncing ? "Syncing" : "Sync now") : accessLoading ? "Checking access" : "Sync unavailable"}
    </button>
  );
}

export function CampaignsScreen({
  onOpenConnections,
  canManage,
  accessLoading = false,
}: {
  onOpenConnections: () => void;
  canManage: boolean;
  accessLoading?: boolean;
}): React.JSX.Element {
  const [workspaceView, setWorkspaceView] = useState<"performance" | "drafts">("performance");
  const [data, setData] = useState<PaidDashboardData>(() => emptyPaidDashboard());
  const [mode, setMode] = useState<ScreenMode>("loading");
  const [range, setRange] = useState(defaultRange);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [columns, setColumns] = useState<MetricKey[]>(DEFAULT_COLUMNS);
  const [campaignView, setCampaignView] = useState<"creatives" | "table">("creatives");
  const [statusFilter, setStatusFilter] = useState<CampaignStatusFilter>("all");
  const [platformFilter, setPlatformFilter] = useState<Set<string>>(new Set());
  const [accountFilter, setAccountFilter] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState("");
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const loadSequence = useRef(0);

  const load = useCallback(async (from: string, to: string, initial = false) => {
    const sequence = ++loadSequence.current;
    if (initial) setMode("loading");
    setLoading(true);
    setLoadError(null);
    try {
      const response = await fetch(`/api/dashboard?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`, { cache: "no-store" });
      const payload = await response.json() as Record<string, unknown>;
      if (!response.ok) throw new Error(typeof payload.error === "string" ? payload.error : `Dashboard request failed (${response.status})`);
      if (sequence !== loadSequence.current) return;
      const normalized = normalizePaidDashboard(payload.data, payload);
      setData(normalized);
      setMode(screenMode(payload.mode));
    } catch (error) {
      if (sequence !== loadSequence.current) return;
      setMode("failed");
      setLoadError(error instanceof Error ? error.message : "Campaign data could not be loaded.");
    } finally {
      if (sequence === loadSequence.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(range.from, range.to, true);
  }, [load, range.from, range.to]);

  useEffect(() => {
    if (new URL(window.location.href).searchParams.get("paidView") === "drafts") {
      setWorkspaceView("drafts");
    }
  }, []);

  const sync = useCallback(async () => {
    setSyncing(true);
    setNotice(null);
    try {
      const response = await fetch("/api/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ from: range.from, to: range.to }),
      });
      const payload = await response.json() as unknown;
      const nextNotice = syncNotice(payload, response.ok);
      setNotice(nextNotice);
      if (nextNotice.tone !== "error" || syncResultList(payload as Record<string, unknown>).length > 0) {
        await load(range.from, range.to);
      }
    } catch {
      setNotice({ tone: "error", text: "Sync failed before account results were returned. Please try again." });
    } finally {
      setSyncing(false);
    }
  }, [load, range.from, range.to]);

  const toggleSetValue = (setter: React.Dispatch<React.SetStateAction<Set<string>>>, value: string) => {
    setter((previous) => {
      const next = new Set(previous);
      if (next.has(value)) next.delete(value);
      else next.add(value);
      return next;
    });
  };

  const sourceScopedCampaigns = useMemo(() => data.campaigns.filter((campaign) =>
    (accountFilter.size === 0 || accountFilter.has(campaign.accountKey))
    && (platformFilter.size === 0 || platformFilter.has(campaign.platform))),
  [data.campaigns, accountFilter, platformFilter]);

  const scopedSources = useMemo(() => data.sources.filter((source) =>
    (accountFilter.size === 0 || accountFilter.has(source.key))
    && (platformFilter.size === 0 || platformFilter.has(source.platform))),
  [data.sources, accountFilter, platformFilter]);

  const hasSourceFilter = accountFilter.size > 0 || platformFilter.size > 0;
  const viewData = useMemo(
    () => hasSourceFilter && (sourceScopedCampaigns.length !== data.campaigns.length || scopedSources.length !== data.sources.length)
      ? scopedDashboard(data, sourceScopedCampaigns, scopedSources)
      : data,
    [data, hasSourceFilter, sourceScopedCampaigns, scopedSources],
  );

  const tableCampaigns = useMemo(() => {
    const query = search.trim().toLowerCase();
    const statusScoped = sourceScopedCampaigns.filter((campaign) => statusFilter === "all" || campaignStatus(campaign.status) === statusFilter);
    const matching = !query ? statusScoped : statusScoped.filter((campaign) =>
      campaign.campaign.toLowerCase().includes(query)
      || campaign.label.toLowerCase().includes(query)
      || campaign.accountName.toLowerCase().includes(query)
      || (campaign.externalId?.toLowerCase().includes(query) ?? false));
    return matching.map((campaign) => campaignWithIntegrityLabel(campaign, data.sources, data.state));
  }, [sourceScopedCampaigns, statusFilter, search, data.sources, data.state]);

  const overviewCampaigns = useMemo(
    () => sourceScopedCampaigns.map((campaign) => campaignWithIntegrityLabel(campaign, data.sources, data.state)),
    [sourceScopedCampaigns, data.sources, data.state],
  );

  const cachedViewCampaigns = useMemo(
    () => sourceScopedCampaigns
      .map((campaign) => campaignWithIntegrityLabel(campaign, data.sources, data.state))
      .filter((campaign) => isCachedPaidSourceState(campaign.sourceState)),
    [sourceScopedCampaigns, data.sources, data.state],
  );
  const cachedViewSources = useMemo(
    () => scopedSources.filter((source) => isCachedPaidSourceState(source.state)),
    [scopedSources],
  );
  const hasCachedPerformance = cachedViewCampaigns.length > 0
    || cachedViewSources.length > 0
    || (scopedSources.length === 0 && isCachedPaidSourceState(viewData.state));
  const cachedIntegrityCopy = useMemo(() => {
    if (!hasCachedPerformance) return null;
    const names = [...new Set([
      ...cachedViewSources.map((source) => source.accountName),
      ...cachedViewCampaigns.map((campaign) => campaign.accountName),
    ])];
    const states = [...new Set([
      ...cachedViewSources.map((source) => source.state),
      ...cachedViewCampaigns.map((campaign) => campaign.sourceState),
      ...(cachedViewSources.length === 0 && cachedViewCampaigns.length === 0 ? [viewData.state] : []),
    ])].map(sourceStateLabel);
    const observedFrom = minDate([
      ...cachedViewSources.map((source) => source.observedFrom),
      ...cachedViewCampaigns.map((campaign) => campaign.observedFrom),
    ]);
    const observedTo = maxDate([
      ...cachedViewSources.map((source) => source.observedTo),
      ...cachedViewCampaigns.map((campaign) => campaign.observedTo),
    ]);
    const timezones = [...new Set([
      ...cachedViewSources.map((source) => source.timezone),
      ...cachedViewCampaigns.map((campaign) => campaign.timezone),
    ].filter((timezone): timezone is string => !!timezone))];
    const timezone = timezones.length === 1 ? timezones[0] : timezones.length > 1 ? "multiple source timezones" : null;
    const accountScope = names.length > 0 ? ` for ${names.slice(0, 3).join(", ")}${names.length > 3 ? ` and ${names.length - 3} more` : ""}` : "";
    const rowScope = cachedViewCampaigns.length > 0
      ? `${cachedViewCampaigns.length} campaign${cachedViewCampaigns.length === 1 ? "" : "s"}${accountScope}`
      : `saved account observations${accountScope}`;
    return `${rowScope} use cached metrics because the source state is ${states.join(" / ").toLowerCase()}. Observation coverage: ${coverageLabel(observedFrom, observedTo, timezone)}. Keep them for context, but do not treat them as current until an owner or admin reconnects and syncs the source.`;
  }, [cachedViewCampaigns, cachedViewSources, hasCachedPerformance, viewData.state]);

  const selected = useMemo(
    () => {
      if (!selectedKey) return null;
      const campaign = data.campaigns.find((candidate) => candidate.identity === selectedKey);
      return campaign ? campaignWithIntegrityLabel(campaign, data.sources, data.state) : null;
    },
    [selectedKey, data.campaigns, data.sources, data.state],
  );
  const closeDrillDown = useCallback(() => setSelectedKey(null), []);
  const showWorkspaceView = useCallback((next: "performance" | "drafts") => {
    setWorkspaceView(next);
    const url = new URL(window.location.href);
    if (next === "drafts") url.searchParams.set("paidView", "drafts");
    else url.searchParams.delete("paidView");
    window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
  }, []);

  if (workspaceView === "drafts") {
    return (
      <PaidDraftWorkspace
        onShowPerformance={() => showWorkspaceView("performance")}
        onOpenConnections={onOpenConnections}
        canManage={canManage}
      />
    );
  }

  if (mode === "loading") {
    return (
      <div className="flex flex-1 items-center justify-center font-sans text-[13px] text-ink-300" role="status" aria-live="polite">
        Loading campaign sources…
      </div>
    );
  }

  const genuinelyEmpty = mode === "empty" || (data.platforms.length === 0 && data.campaigns.length === 0);
  const sourceWarning = statusCopy(data.state);

  return (
    <section className="min-h-0 min-w-0 w-full max-w-full flex-1 overflow-y-auto overflow-x-hidden bg-surface-page p-4 sm:p-6 lg:p-7">
      <div className="mx-auto w-full min-w-0 max-w-[1440px]">
        <div className="mb-5 flex flex-wrap items-center justify-between gap-4">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-3"><h1 className="font-serif text-[28px] font-medium leading-tight text-ink-900 sm:text-[30px]">Paid command center</h1><StatusBadge mode={mode} state={data.state} /></div>
            {!canManage && !accessLoading ? <p className="mt-1 text-[11px] text-ink-400">Read-only access. Only owners and admins can sync accounts.</p> : null}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <PaidSyncButton canManage={canManage} accessLoading={accessLoading} syncing={syncing} loading={loading} onSync={sync}
              className="inline-flex items-center gap-2 rounded-[6px] border border-line-3 bg-white px-3 py-2 text-[12px] font-medium text-ink-600 disabled:cursor-not-allowed disabled:opacity-60" />
            <button type="button" onClick={() => showWorkspaceView("drafts")} className="inline-flex items-center gap-2 rounded-[6px] border border-plum bg-plum px-3 py-2 text-[12px] font-semibold text-white hover:bg-plum-deep focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-plum"><LuFileText aria-hidden /> Campaign drafts</button>
          </div>
        </div>
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3 border-b border-line-3 pb-4">
          <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Filter by ad platform">
            <button type="button" aria-pressed={platformFilter.size === 0} onClick={() => setPlatformFilter(new Set())} className={`rounded-[5px] px-3 py-2 text-[12px] font-medium ${platformFilter.size === 0 ? "bg-ink-900 text-white" : "text-ink-600 hover:bg-white"}`}>All platforms</button>
            {data.platforms.map((platform) => <button key={platform.platform} type="button" aria-pressed={platformFilter.has(platform.platform)} onClick={() => toggleSetValue(setPlatformFilter, platform.platform)} className={`inline-flex items-center gap-2 rounded-[5px] border px-3 py-2 text-[12px] font-medium ${platformFilter.has(platform.platform) ? "border-plum-border bg-plum-soft text-plum-deep" : "border-transparent text-ink-600 hover:bg-white"}`}><PlatformMark platform={platform.platform} size={15} />{platform.label}</button>)}
          </div>
          <DateRangePicker range={data.range.days > 0 ? data.range : { ...range, days: 0 }} disabled={loading} onChange={(from, to) => setRange({ from, to })} />
        </div>
        {loadError ? (
          <div role="alert" className="mb-[14px] border-l-[3px] border-[#B23A4B] bg-[#FBF0F1] px-[12px] py-[10px] font-sans text-[12.5px] text-[#7F2837]">
            Campaign data could not be loaded: {loadError}
          </div>
        ) : null}
        {notice ? (
          <div
            role={notice.tone === "error" ? "alert" : "status"}
            aria-live="polite"
            className="mb-[14px] border-l-[3px] px-[12px] py-[10px] font-sans text-[12.5px]"
            style={notice.tone === "error"
              ? { borderColor: "#B23A4B", background: "#FBF0F1", color: "#7F2837" }
              : notice.tone === "warning"
                ? { borderColor: "#B88824", background: "#FBF6E8", color: "#745616" }
                : { borderColor: "#4C6B40", background: "#F0F5EC", color: "#3F5936" }}
          >
            {notice.text}
          </div>
        ) : null}
        {cachedIntegrityCopy ? (
          <div
            id="paid-cached-performance-notice"
            role="status"
            className="mb-[14px] border-l-[3px] border-[#B88824] bg-[#FBF6E8] px-[12px] py-[10px] font-sans text-[12px] leading-[1.55] text-[#745616]"
          >
            <strong className="mr-[5px] font-semibold">Cached performance snapshot.</strong>
            {cachedIntegrityCopy}
          </div>
        ) : null}

        <div className="mb-5 flex flex-wrap items-center justify-between gap-x-4 gap-y-3">
          {data.sources.length > 0 ? (
            <section aria-label="Connected ad accounts" className="min-w-0">
              <div className="flex max-w-full flex-wrap items-center gap-1.5" role="group" aria-label="Filter by ad account">
                <button type="button" aria-pressed={accountFilter.size === 0} onClick={() => setAccountFilter(new Set())} className={`rounded-[5px] border px-2.5 py-1.5 text-[11px] font-medium ${accountFilter.size === 0 ? "border-ink-300 bg-white text-ink-900" : "border-transparent text-ink-400"}`}>All accounts <span className="ml-1 text-ink-300">{data.sources.length}</span></button>
                {data.sources.map((source) => <button key={source.key} type="button" aria-pressed={accountFilter.has(source.key)} onClick={() => toggleSetValue(setAccountFilter, source.key)} title={`${source.platformLabel} · ${source.currency ?? "Unknown currency"} · ${sourceStateLabel(source.state)} · ${coverageLabel(source.observedFrom, source.observedTo, source.timezone)}${source.detail ? " · " + source.detail : ""}`} className={`inline-flex max-w-full items-center gap-1.5 rounded-[5px] border px-2.5 py-1.5 text-[11px] font-medium ${accountFilter.has(source.key) ? "border-plum-border bg-plum-soft text-plum-deep" : "border-line-3 bg-white text-ink-600 hover:border-ink-300"}`}><span className="h-1.5 w-1.5 flex-none rounded-full" style={{ background: sourceStateColor(source.state) }} aria-hidden /><span className="max-w-[180px] truncate">{source.accountName}</span><span className="text-[9px] opacity-70">{source.currency ?? "?"}</span></button>)}
                <button type="button" onClick={onOpenConnections} aria-label="Manage connections" title="Manage connections" className="flex h-8 w-8 items-center justify-center rounded-[5px] text-ink-400 hover:bg-white hover:text-plum"><LuPlug size={15} aria-hidden /></button>
              </div>
            </section>
          ) : null}
          <details className="group min-w-0 max-w-full text-[11px] text-ink-400">
            <summary className="cursor-pointer select-none marker:text-plum">Data coverage <span className="ml-1 text-ink-300">{sourceStateLabel(data.state)}</span></summary>
            <div className="mt-2 max-w-[540px] border-l-2 border-plum-border pl-3 text-[11px] leading-relaxed">
              <p>Requested {coverageLabel(data.range.from || range.from, data.range.to || range.to, coverageTimezone(data.sources))}</p>
              <p>Observed {coverageLabel(data.observedFrom, data.observedTo, coverageTimezone(data.sources))}</p>
              {sourceWarning ? <p className="mt-1">{sourceWarning}{data.stateDetail ? ` ${data.stateDetail}` : ""}</p> : null}
            </div>
          </details>
        </div>

        {genuinelyEmpty ? (
          <section className="flex flex-col items-center justify-center border-y border-line-3 py-[48px] text-center">
            <h2 className="font-serif text-[22px] font-medium text-ink-900">
              {mode === "failed" ? "Campaign data is unavailable" : "No paid campaign data yet"}
            </h2>
            <p className="mx-auto mt-[10px] max-w-[460px] font-sans text-[14px] leading-[1.6] text-ink-400">
              {mode === "failed"
                ? "The dashboard request failed, so Marpin cannot confirm whether connected accounts have data."
                : "Connect Google Ads or Meta Ads, then sync to pull observed campaign performance."}
            </p>
            <div className="mt-[18px] flex flex-wrap justify-center gap-[10px]">
              <PaidSyncButton
                canManage={canManage}
                syncing={syncing}
                onSync={sync}
                className="inline-flex cursor-pointer items-center gap-[6px] rounded-[8px] border border-line-3 bg-white px-[14px] py-[9px] font-sans text-[13px] font-semibold text-ink-600 disabled:cursor-not-allowed disabled:opacity-60"
              />
              <button type="button" onClick={onOpenConnections} className="inline-flex cursor-pointer items-center gap-[6px] rounded-[8px] border-0 bg-plum px-[14px] py-[9px] font-sans text-[13px] font-semibold text-white">
                <LuPlug aria-hidden /> Manage connections
              </button>
              <button type="button" onClick={() => showWorkspaceView("drafts")} className="inline-flex cursor-pointer items-center gap-[6px] rounded-[8px] border border-line-3 bg-white px-[14px] py-[9px] font-sans text-[13px] font-semibold text-ink-600">
                <LuFileText aria-hidden /> Create campaign draft
              </button>
            </div>
          </section>
        ) : (
          <>
            {viewData.mixedCurrency ? (
              <div role="status" className="mb-[12px] font-sans text-[11.5px] text-ink-400">
                {currencySafetyLabel(viewData)} Money totals, blended ROAS, and cross-currency spend bars are unavailable; row values remain in each known source currency.
              </div>
            ) : null}

            <div role="group" aria-label={hasCachedPerformance ? "Cached paid performance summary" : "Paid performance summary"} aria-describedby={hasCachedPerformance ? "paid-cached-performance-notice" : undefined}>
              <PaidOverview data={viewData} campaigns={overviewCampaigns} statusFilter={statusFilter} onStatusFilter={setStatusFilter} onOpenDrafts={() => showWorkspaceView("drafts")} onSelectCampaign={(campaign) => setSelectedKey(campaign.identity)} />
            </div>

            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-3"><h2 className="font-sans text-[18px] font-semibold text-ink-900">Campaigns</h2><span className="font-mono text-[11px] text-ink-400">{tableCampaigns.length}</span>
                {cachedViewCampaigns.length > 0 ? <span className="rounded-[4px] bg-[#FBF6E8] px-2 py-1 text-[10px] text-[#745616]">{cachedViewCampaigns.length} cached</span> : null}
                {statusFilter !== "all" ? <button type="button" onClick={() => setStatusFilter("all")} aria-label="Clear campaign status filter" className="inline-flex items-center gap-1 rounded-[4px] bg-plum-soft px-2 py-1 text-[10px] font-medium text-plum">{statusFilter}<LuX size={12} aria-hidden /></button> : null}
              </div>
              <div className="flex items-center rounded-[6px] border border-line-3 bg-white p-0.5" role="group" aria-label="Campaign view">
                <button type="button" aria-pressed={campaignView === "creatives"} onClick={() => setCampaignView("creatives")} className={`inline-flex items-center gap-1.5 rounded-[4px] px-3 py-1.5 text-[11px] font-medium ${campaignView === "creatives" ? "bg-ink-900 text-white" : "text-ink-400"}`}><LuLayoutGrid size={13} aria-hidden />Creatives</button>
                <button type="button" aria-pressed={campaignView === "table"} onClick={() => setCampaignView("table")} className={`inline-flex items-center gap-1.5 rounded-[4px] px-3 py-1.5 text-[11px] font-medium ${campaignView === "table" ? "bg-ink-900 text-white" : "text-ink-400"}`}><LuList size={14} aria-hidden />Table</button>
              </div>
            </div>
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <div className="relative min-w-0 flex-1 sm:max-w-[300px]"><LuSearch size={14} aria-hidden className="absolute left-3 top-2.5 text-ink-300" /><label htmlFor="campaign-search" className="sr-only">Search campaigns or accounts</label><input id="campaign-search" type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search campaigns or accounts" className="w-full min-w-0 rounded-[6px] border border-line-3 bg-white py-2 pl-9 pr-3 text-[12px] text-ink-800 outline-none focus:border-plum" /></div>
              {campaignView === "table" ? <ColumnChooser visible={columns} onChange={setColumns} /> : <span className="hidden text-[10px] text-ink-400 sm:block">Source creatives · Campaign-level metrics</span>}
            </div>
            <div
              role="region"
              aria-label={cachedViewCampaigns.length > 0 ? "Campaign performance with cached rows" : "Campaign performance"}
              aria-describedby={hasCachedPerformance ? "paid-cached-performance-notice" : undefined}
            >
              {campaignView === "table" ? <CampaignsTable campaigns={tableCampaigns} columns={columns} onRowClick={(campaign) => setSelectedKey(campaign.identity)} /> : <PaidCreativeGallery campaigns={tableCampaigns} onSelect={(campaign) => setSelectedKey(campaign.identity)} />}
            </div>
          </>
        )}
      </div>

      <DrillDownPanel campaign={selected} onClose={closeDrillDown} />
    </section>
  );
}
