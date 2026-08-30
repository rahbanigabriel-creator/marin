"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  LuCalendarDays,
  LuChartNoAxesCombined,
  LuCircleAlert,
  LuCircleCheck,
  LuDatabase,
  LuRefreshCw,
  LuSearchCheck,
} from "react-icons/lu";

import type {
  AnalyticsSectionState,
  DistributionAnalyticsResponse,
} from "@/lib/distribution-analytics/types";

const focusRing = "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-plum";
const dateInput = `h-[34px] min-w-0 rounded-[6px] border border-line-1 bg-white px-[9px] text-[12px] text-ink-700 outline-none focus:border-plum-border ${focusRing}`;

function dateLabel(value: string | null): string {
  if (!value) return "Unavailable";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Unavailable";
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeZone: "UTC" }).format(date);
}

function numberLabel(value: number | null): string {
  return value === null ? "Unavailable" : new Intl.NumberFormat().format(value);
}

function moneyLabel(value: number | null, currency: string | null, mixedCurrency: boolean): string {
  if (value === null || currency === null || mixedCurrency) return "Unavailable";
  try {
    return new Intl.NumberFormat(undefined, { style: "currency", currency, maximumFractionDigits: 2 }).format(value);
  } catch {
    return "Unavailable";
  }
}

function ratioLabel(value: number | null, suffix = "×"): string {
  return value === null ? "Unavailable" : `${new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 }).format(value)}${suffix}`;
}

function stateLabel(state: AnalyticsSectionState): string {
  if (state === "available") return "Available";
  if (state === "empty") return "No records";
  if (state === "partial") return "Partial";
  if (state === "stale") return "Stale";
  if (state === "failed") return "Failed";
  return "Unavailable";
}

function StateMark({ state }: { state: AnalyticsSectionState }) {
  const positive = state === "available";
  const Icon = positive ? LuCircleCheck : LuCircleAlert;
  return (
    <span className={`inline-flex items-center gap-[5px] text-[10.5px] font-semibold ${positive ? "text-pos-700" : "text-ink-400"}`}>
      <Icon aria-hidden className="h-[13px] w-[13px]" /> {stateLabel(state)}
    </span>
  );
}

function SectionHeading({
  icon: Icon,
  title,
  description,
  state,
  headingId,
}: {
  icon: typeof LuCalendarDays;
  title: string;
  description: string;
  state: AnalyticsSectionState;
  headingId: string;
}) {
  return (
    <div className="flex min-w-0 flex-wrap items-start justify-between gap-[10px]">
      <div className="flex min-w-0 gap-[9px]">
        <Icon aria-hidden className="mt-[2px] h-[16px] w-[16px] flex-none text-ink-400" />
        <div className="min-w-0">
          <h2 id={headingId} className="m-0 text-[15px] font-semibold text-ink-900">{title}</h2>
          <p className="mb-0 mt-[2px] text-[11.5px] leading-[1.45] text-ink-400">{description}</p>
        </div>
      </div>
      <StateMark state={state} />
    </div>
  );
}

function MetricGrid({ items }: { items: Array<{ label: string; value: string; detail?: string }> }) {
  return (
    <dl className="mt-[13px] grid min-w-0 grid-cols-2 border-y border-line-2 sm:grid-cols-4">
      {items.map((item) => (
        <div key={item.label} className="min-w-0 border-b border-r border-line-4 px-[10px] py-[11px] last:border-r-0 sm:border-b-0">
          <dt className="truncate text-[10px] font-semibold uppercase text-ink-300">{item.label}</dt>
          <dd className="mb-0 mt-[4px] break-words font-mono text-[16px] font-semibold text-ink-800">{item.value}</dd>
          {item.detail ? <dd className="mb-0 mt-[2px] text-[9.5px] text-ink-400">{item.detail}</dd> : null}
        </div>
      ))}
    </dl>
  );
}

interface ApiErrorBody { message?: string; error?: string }

export function DistributionAnalytics({
  fetcher = globalThis.fetch,
  initialFrom,
  initialTo,
}: {
  fetcher?: typeof fetch;
  initialFrom?: string;
  initialTo?: string;
}) {
  const [data, setData] = useState<DistributionAnalyticsResponse | null>(null);
  const [loadState, setLoadState] = useState<"loading" | "ready" | "error">("loading");
  const [error, setError] = useState<string | null>(null);
  const [from, setFrom] = useState(initialFrom ?? "");
  const [to, setTo] = useState(initialTo ?? "");
  const [appliedRange, setAppliedRange] = useState(initialFrom && initialTo ? { from: initialFrom, to: initialTo } : null);

  const load = useCallback(async (signal?: AbortSignal) => {
    setLoadState("loading");
    setError(null);
    try {
      const query = appliedRange ? `?from=${encodeURIComponent(appliedRange.from)}&to=${encodeURIComponent(appliedRange.to)}` : "";
      const response = await fetcher(`/api/analytics${query}`, {
        method: "GET",
        cache: "no-store",
        headers: { Accept: "application/json" },
        signal,
      });
      const body = await response.json().catch(() => ({})) as DistributionAnalyticsResponse & ApiErrorBody;
      if (!response.ok) throw new Error(body.message ?? "Distribution analytics is unavailable right now.");
      setData(body);
      setFrom(body.range.from);
      setTo(body.range.to);
      setLoadState("ready");
    } catch (cause) {
      if (cause instanceof DOMException && cause.name === "AbortError") return;
      setError(cause instanceof Error ? cause.message : "Distribution analytics is unavailable right now.");
      setLoadState("error");
    }
  }, [appliedRange, fetcher]);

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  const activeTimeline = useMemo(
    () => data?.organic.timeline.filter((point) => point.scheduled > 0 || point.userConfirmedExternalHandoffs > 0).slice(-31) ?? [],
    [data],
  );

  if (loadState === "loading" && !data) {
    return (
      <section aria-busy="true" aria-label="Loading distribution analytics" className="grid min-h-[360px] place-items-center px-[18px] text-ink-400">
        <span className="inline-flex items-center gap-[8px] text-[12px]"><LuRefreshCw aria-hidden className="animate-spin" /> Loading analytics</span>
      </section>
    );
  }

  if (loadState === "error" && !data) {
    return (
      <section className="grid min-h-[360px] place-items-center px-[18px] text-center">
        <div>
          <LuCircleAlert aria-hidden className="mx-auto h-[20px] w-[20px] text-neg-700" />
          <h1 className="mb-0 mt-[9px] text-[17px] font-semibold text-ink-900">Analytics unavailable</h1>
          <p role="alert" className="mx-auto mb-0 mt-[5px] max-w-[420px] text-[12px] text-ink-400">{error}</p>
          <button type="button" onClick={() => void load()} className={`mt-[13px] h-[34px] rounded-[6px] border border-line-1 bg-white px-[11px] text-[11.5px] font-semibold text-ink-600 ${focusRing}`}>Try again</button>
        </div>
      </section>
    );
  }

  if (!data) return null;
  const statusCounts = Object.fromEntries(data.seo.byStatus.map((item) => [item.key, item.count]));
  const severityCounts = Object.fromEntries(data.seo.bySeverity.map((item) => [item.key, item.count]));
  const scheduledTotal = data.organic.timeline.reduce((sum, point) => sum + point.scheduled, 0);

  return (
    <section className="h-full min-w-0 overflow-y-auto bg-surface-panel px-[14px] py-[16px] sm:px-[22px] sm:py-[20px]" aria-labelledby="distribution-analytics-title">
      <div className="mx-auto w-full max-w-[1180px] min-w-0">
        <header className="flex min-w-0 flex-col gap-[13px] border-b border-line-2 pb-[15px] md:flex-row md:items-end md:justify-between">
          <div className="min-w-0">
            <p className="m-0 font-mono text-[9.5px] font-semibold uppercase text-ink-300">Workspace · UTC</p>
            <h1 id="distribution-analytics-title" className="mb-0 mt-[3px] text-[20px] font-semibold text-ink-900">Distribution analytics</h1>
            <p className="mb-0 mt-[4px] text-[12px] text-ink-400">Persisted workflow, handoff evidence, and connected provider metrics for {data.range.from} to {data.range.to}.</p>
          </div>
          <form
            className="flex min-w-0 flex-wrap items-end gap-[7px]"
            onSubmit={(event) => {
              event.preventDefault();
              if (from && to) setAppliedRange({ from, to });
            }}
          >
            <label className="min-w-0 text-[9.5px] font-semibold uppercase text-ink-300">From<input required type="date" value={from} onChange={(event) => setFrom(event.target.value)} className={`mt-[3px] block ${dateInput}`} /></label>
            <label className="min-w-0 text-[9.5px] font-semibold uppercase text-ink-300">To<input required type="date" value={to} onChange={(event) => setTo(event.target.value)} className={`mt-[3px] block ${dateInput}`} /></label>
            <button type="submit" disabled={loadState === "loading" || !from || !to} className={`h-[34px] rounded-[6px] bg-ink-900 px-[11px] text-[11.5px] font-semibold text-white disabled:opacity-45 ${focusRing}`}>Apply</button>
            <button type="button" aria-label="Refresh analytics" disabled={loadState === "loading"} onClick={() => void load()} className={`flex h-[34px] w-[34px] items-center justify-center rounded-[6px] border border-line-1 bg-white text-ink-500 disabled:opacity-45 ${focusRing}`}><LuRefreshCw aria-hidden className={loadState === "loading" ? "animate-spin" : ""} /></button>
          </form>
        </header>

        {error ? <p role="status" className="mb-0 mt-[10px] border-l-2 border-neg-700 pl-[9px] text-[11px] text-neg-700">Latest refresh failed. Showing the last loaded result.</p> : null}
        {data.state === "empty" ? (
          <section className="border-b border-line-2 py-[30px] text-center">
            <LuDatabase aria-hidden className="mx-auto h-[19px] w-[19px] text-ink-300" />
            <h2 className="mb-0 mt-[8px] text-[16px] font-semibold text-ink-800">No distribution records in this range</h2>
            <p className="mx-auto mb-0 mt-[4px] max-w-[440px] text-[11.5px] text-ink-400">The overview found no persisted organic publications, SEO tasks, or connected paid observations.</p>
          </section>
        ) : null}

        <section className="border-b border-line-2 py-[18px]" aria-labelledby="organic-operations-heading">
          <SectionHeading headingId="organic-operations-heading" icon={LuCalendarDays} title="Organic workflow and handoffs" description="Persisted calendar activity and user-confirmed external handoffs. These are not audience outcomes or provider-confirmed publication." state={data.organic.state} />
          <MetricGrid items={[
            { label: "Publications", value: numberLabel(data.organic.totalPublications) },
            { label: "Scheduled events", value: numberLabel(scheduledTotal) },
            { label: "User-confirmed handoffs", value: numberLabel(data.organic.userConfirmedExternalHandoffs), detail: "Unverified externally" },
            { label: "Latest update", value: dateLabel(data.organic.coverage.freshnessAt) },
          ]} />
          <div className="mt-[13px] grid min-w-0 gap-[14px] lg:grid-cols-[minmax(0,1fr)_minmax(280px,0.7fr)]">
            <div className="min-w-0 overflow-x-auto">
              <table className="w-full min-w-[420px] border-collapse text-left text-[11px]">
                <caption className="mb-[6px] text-left text-[10px] font-semibold uppercase text-ink-300">Active workflow days · latest 31</caption>
                <thead><tr className="border-b border-line-2 text-[9.5px] uppercase text-ink-300"><th className="py-[6px] font-semibold">UTC date</th><th className="py-[6px] text-right font-semibold">Scheduled</th><th className="py-[6px] text-right font-semibold">User-confirmed handoffs</th></tr></thead>
                <tbody>{activeTimeline.length ? activeTimeline.map((point) => <tr key={point.date} className="border-b border-line-4"><td className="py-[7px] text-ink-600">{point.date}</td><td className="py-[7px] text-right font-mono text-ink-700">{point.scheduled}</td><td className="py-[7px] text-right font-mono text-ink-700">{point.userConfirmedExternalHandoffs}</td></tr>) : <tr><td colSpan={3} className="py-[12px] text-ink-400">No scheduled events or user-confirmed handoffs in this range.</td></tr>}</tbody>
              </table>
            </div>
            <div className="border-l-2 border-line-2 pl-[11px]">
              <p className="m-0 text-[10px] font-semibold uppercase text-ink-300">Organic provider performance</p>
              <p className="mb-0 mt-[5px] text-[12px] font-semibold text-ink-700">Unavailable</p>
              <p className="mb-0 mt-[3px] text-[11px] leading-[1.5] text-ink-400">{data.organic.performance.message}</p>
              <p className="mb-0 mt-[5px] text-[10.5px] text-ink-400">Source: no organic provider metrics connected · freshness: {dateLabel(data.organic.performance.coverage.freshnessAt)}</p>
            </div>
          </div>
        </section>

        <section className="border-b border-line-2 py-[18px]" aria-labelledby="seo-operations-heading">
          <SectionHeading headingId="seo-operations-heading" icon={LuSearchCheck} title="SEO operations" description="Persisted work status and analysis coverage. Completion is operational, not a ranking claim." state={data.seo.state} />
          <MetricGrid items={[
            { label: "Open", value: numberLabel(statusCounts.open ?? 0) },
            { label: "In progress", value: numberLabel(statusCounts.in_progress ?? 0) },
            { label: "Completed", value: numberLabel(statusCounts.completed ?? 0) },
            { label: "Latest analysis", value: dateLabel(data.seo.coverage.latestAnalyzedAt) },
          ]} />
          <div className="mt-[12px] flex min-w-0 flex-wrap gap-x-[18px] gap-y-[7px] text-[10.5px] text-ink-500">
            <span><strong className="font-semibold text-ink-700">Critical</strong> {severityCounts.critical ?? 0}</span>
            <span><strong className="font-semibold text-ink-700">High</strong> {severityCounts.high ?? 0}</span>
            {data.seo.byPriority.map((band) => <span key={band.key}><strong className="font-semibold text-ink-700">{band.key.replace("_", "–").replace("p", "P")}</strong> {band.count}</span>)}
            <span className="sm:ml-auto">Latest update {dateLabel(data.seo.coverage.latestUpdatedAt)}</span>
          </div>
        </section>

        <section className="border-b border-line-2 py-[18px]" aria-labelledby="paid-performance-heading">
          <SectionHeading headingId="paid-performance-heading" icon={LuChartNoAxesCombined} title="Paid performance" description="Measured outcomes from connected Google Ads and Meta Ads accounts." state={data.paid.state} />
          {data.paid.mixedCurrency ? <p role="status" className="mb-0 mt-[9px] border-l-2 border-[#b48621] pl-[9px] text-[10.5px] text-ink-500">Multiple or unknown currencies are present. Blended money totals and ROAS remain unavailable.</p> : null}
          <MetricGrid items={[
            { label: "Spend", value: moneyLabel(data.paid.totals.spend, data.paid.currency, data.paid.mixedCurrency) },
            { label: "Revenue", value: moneyLabel(data.paid.totals.revenue, data.paid.currency, data.paid.mixedCurrency) },
            { label: "ROAS", value: ratioLabel(data.paid.totals.roas) },
            { label: "Conversions", value: numberLabel(data.paid.totals.conversions) },
          ]} />
          <div className="mt-[12px] divide-y divide-line-4">
            {data.paid.platforms.length ? data.paid.platforms.map((platform) => (
              <div key={platform.platform} className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] gap-[12px] py-[9px] text-[11px]">
                <div className="min-w-0"><span className="font-semibold text-ink-700">{platform.label}</span><span className="ml-[7px] text-ink-400">{platform.currency ?? "Currency unavailable"}</span></div>
                <span className="text-right font-mono text-ink-600">{moneyLabel(platform.metrics.spend, platform.currency, platform.mixedCurrency)} spend · {numberLabel(platform.metrics.conversions)} conversions</span>
              </div>
            )) : <p className="mb-0 py-[11px] text-[11px] text-ink-400">No connected paid observations are available for this range.</p>}
          </div>
          <p className="mb-0 mt-[8px] text-[10px] text-ink-400">Requested {dateLabel(data.paid.requestedRange.from)} to {dateLabel(data.paid.requestedRange.to)} · observed {dateLabel(data.paid.observedRange.from)} to {dateLabel(data.paid.observedRange.to)}</p>
        </section>

        <section className="py-[18px]" aria-labelledby="analytics-sources-heading">
          <div className="flex items-center justify-between gap-[10px]"><h2 id="analytics-sources-heading" className="m-0 text-[14px] font-semibold text-ink-900">Sources and coverage</h2><span className="text-[9.5px] uppercase text-ink-300">{data.sources.length} shown</span></div>
          <div className="mt-[8px] divide-y divide-line-4 border-y border-line-2">
            {data.sources.map((source) => (
              <div key={source.id} className="grid min-w-0 gap-[3px] py-[9px] sm:grid-cols-[minmax(160px,1fr)_130px_minmax(200px,1.2fr)] sm:items-center sm:gap-[12px]">
                <div className="min-w-0"><p className="m-0 truncate text-[11.5px] font-semibold text-ink-700">{source.name}</p><p className="mb-0 mt-[1px] text-[9.5px] uppercase text-ink-300">{source.kind === "operational" ? "Operational output" : "Measured outcome"}</p>{source.detail ? <p className="mb-0 mt-[2px] text-[10px] leading-[1.35] text-ink-400">{source.detail}</p> : null}</div>
                <StateMark state={source.state} />
                <p className="m-0 text-[10.5px] leading-[1.45] text-ink-400">Fresh {dateLabel(source.freshnessAt)} · coverage {dateLabel(source.observedFrom)} to {dateLabel(source.observedTo)}</p>
              </div>
            ))}
          </div>
          {data.sourcesTruncated ? <p className="mb-0 mt-[7px] text-[10px] text-ink-400">Additional paid sources exist but are omitted from this bounded overview.</p> : null}
        </section>
      </div>
    </section>
  );
}
