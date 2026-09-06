"use client";

import { useEffect, useRef, useState } from "react";
import { LuChartNoAxesCombined, LuDatabase, LuPlug, LuRefreshCw } from "react-icons/lu";

import { parseAnalyticsRange } from "@/lib/distribution-analytics/validation";
import { MEASUREMENT_SCHEMA_VERSION, type MeasurementAnalyticsResponse } from "@/lib/measurement-analytics/types";
import { control, focusRing, labels, numberLabel, PaidObservations, Sources, timestamp } from "./MeasurementPanels";

export function DistributionAnalytics({ fetcher = globalThis.fetch, initialFrom, initialTo, onOpenConnections }: {
  fetcher?: typeof fetch;
  initialFrom?: string;
  initialTo?: string;
  onOpenConnections?: () => void;
}) {
  const [data, setData] = useState<MeasurementAnalyticsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [rangeError, setRangeError] = useState<string | null>(null);
  const [from, setFrom] = useState(initialFrom ?? "");
  const [to, setTo] = useState(initialTo ?? "");
  const [range, setRange] = useState(initialFrom && initialTo ? { from: initialFrom, to: initialTo } : null);
  const [refresh, setRefresh] = useState(0);
  const [selectedAccount, setSelectedAccount] = useState("");
  const requestId = useRef(0);

  useEffect(() => {
    const controller = new AbortController();
    const id = ++requestId.current;
    setLoading(true);
    setError(null);
    void (async () => {
      try {
        const query = range ? `?${new URLSearchParams(range)}` : "";
        const response = await fetcher(`/api/measurement-analytics${query}`, { cache: "no-store", headers: { Accept: "application/json" }, signal: controller.signal });
        if (controller.signal.aborted || id !== requestId.current) return;
        if ([401, 403].includes(response.status)) setData(null);
        const body = await response.json();
        if (controller.signal.aborted || id !== requestId.current) return;
        if (!response.ok) {
          // Clear saved results when authorization changes, including failures
          // where the server could not establish the current workspace.
          if ([401, 403].includes(response.status) || body.error === "authentication_unavailable") setData(null);
          throw new Error(body.message ?? "Analytics is temporarily unavailable.");
        }
        if (body.schemaVersion !== MEASUREMENT_SCHEMA_VERSION || !body.range || !Array.isArray(body.sources) || !Array.isArray(body.ga4?.observations) || !Array.isArray(body.paid?.accounts)) throw new Error("Analytics returned an unsupported response.");
        setData(body);
        setFrom(body.range.from);
        setTo(body.range.to);
      } catch (cause) {
        if (controller.signal.aborted || id !== requestId.current) return;
        setError(cause instanceof Error ? cause.message : "Analytics is temporarily unavailable.");
      } finally {
        if (!controller.signal.aborted && id === requestId.current) setLoading(false);
      }
    })();
    return () => controller.abort();
  }, [fetcher, range, refresh]);

  const ga4Sources = data?.sources.filter((source) => source.platform === "ga4") ?? [];
  const account = data?.paid.accounts.find((item) => item.sourceId === selectedAccount) ?? data?.paid.accounts[0];
  const paidSource = data?.sources.find((source) => source.id === account?.sourceId);

  return <section aria-labelledby="measurement-analytics-title" aria-busy={loading} className="h-full min-w-0 overflow-y-auto bg-surface-panel px-[14px] py-[16px] sm:px-[22px] sm:py-[20px]">
    <div className="mx-auto w-full min-w-0 max-w-[1180px]">
      <header className="flex min-w-0 flex-wrap items-end justify-between gap-[13px] border-b border-line-2 pb-[15px]">
        <div>
          <h1 id="measurement-analytics-title" className="m-0 text-[20px] font-semibold text-ink-900">Analytics</h1>
          <p className="mb-0 mt-[4px] text-[12px] text-ink-500">GA4 and paid measurement</p>
        </div>
        <div className="flex flex-wrap items-center gap-[7px]">
          {onOpenConnections ? <button type="button" onClick={onOpenConnections} className={`${control} inline-flex items-center gap-[6px]`}><LuPlug aria-hidden />Connections</button> : null}
          <button type="button" aria-label="Refresh analytics" title="Refresh saved measurements" disabled={loading} onClick={() => setRefresh((value) => value + 1)} className={`${control} flex w-[34px] flex-none items-center justify-center p-0 disabled:opacity-45`}><LuRefreshCw aria-hidden className={loading ? "animate-spin" : ""} /></button>
        </div>
      </header>
      <form className="flex min-w-0 flex-wrap items-end gap-[8px] border-b border-line-2 py-[13px]" onSubmit={(event) => {
        event.preventDefault();
        try {
          parseAnalyticsRange(new URLSearchParams({ from, to }));
          setRangeError(null);
          setRange({ from, to });
        } catch (cause) { setRangeError(cause instanceof Error ? cause.message : "Invalid date range."); }
      }}>
        <label className="min-w-0 text-[10px] font-semibold text-ink-500">From<input required type="date" value={from} onChange={(event) => setFrom(event.target.value)} className={`${control} mt-[3px] block w-[142px]`} /></label>
        <label className="min-w-0 text-[10px] font-semibold text-ink-500">To<input required type="date" value={to} onChange={(event) => setTo(event.target.value)} className={`${control} mt-[3px] block w-[142px]`} /></label>
        <button type="submit" disabled={loading || !from || !to} className={`h-[34px] rounded-[6px] bg-ink-900 px-[12px] text-[12px] font-semibold text-white disabled:opacity-45 ${focusRing}`}>Apply</button>
        {data ? <p className="m-0 py-[7px] text-[10.5px] text-ink-500">Showing {data.range.from} to {data.range.to} / stored dates; timestamps UTC</p> : null}
      </form>
      {rangeError ? <p role="alert" className="text-[12px] text-neg-700">{rangeError}</p> : null}
      {error ? <div role="alert" className="border-b border-line-2 py-[16px] text-[12px] text-neg-700">
        {!data ? <h2 className="m-0 text-[16px] font-semibold">Analytics unavailable</h2> : null}
        <p>{error} {data ? "Refresh failed. The previous result and its date range remain displayed." : ""}</p>
        <button type="button" onClick={() => setRefresh((value) => value + 1)} disabled={loading} className={control}>Try again</button>
      </div> : null}
      {loading && !data ? <p role="status" className="flex min-h-[220px] items-center justify-center gap-[8px] text-[12px] text-ink-500"><LuRefreshCw aria-hidden className="animate-spin" />Loading analytics</p> : null}
      {data ? <>
        {data.limited ? <p role="status" className="text-[12px] text-neg-700">Read limit reached. Observations are incomplete; paid totals are withheld. Narrow the date range.</p> : null}
        <section aria-labelledby="ga4-heading" className="border-b border-line-2 py-[20px]">
          <h2 id="ga4-heading" className="m-0 flex items-center gap-[8px] text-[16px] font-semibold text-ink-900"><LuChartNoAxesCombined aria-hidden className="text-ink-500" />Google Analytics 4</h2>
          <p className="mb-0 mt-[5px] text-[11.5px] text-ink-500">{ga4Sources.length ? `${ga4Sources.filter((source) => source.connectionState === "connected").length} of ${ga4Sources.length} properties connected` : "GA4 is not connected."}</p>
          {data.ga4.state === "empty" ? <h3 className="mb-0 mt-[14px] text-[13px] font-semibold text-ink-800">No GA4 measurements in this range</h3> : <p className="mb-0 mt-[12px] text-[12px] text-ink-600">Property totals unavailable for these records.</p>}
          <details className="mt-[10px] text-[11px] text-ink-600">
            <summary className={`w-fit cursor-pointer ${focusRing}`}>Source coverage</summary>
            {ga4Sources.length ? <Sources sources={ga4Sources} /> : null}
            <p className="mb-0 mt-[10px] max-w-[780px] text-[11.5px] leading-[1.6] text-ink-500">Some saved GA4 records do not identify their property, and unnamed campaigns may share a bucket. These are individual observations, not property totals or paid-only traffic. Saved zeros are shown as Unknown because earlier imports could turn missing values into zero. Revenue and ROAS are unavailable.</p>
          </details>
          {data.ga4.observations.length ? <>
            <p className="mb-[7px] mt-[16px] text-[10.5px] text-ink-500">{data.ga4.observationsLimited ? `Latest ${data.ga4.observations.length} stored observations; more records may exist.` : `${data.ga4.observationCount} stored observations.`} Last stored update: {timestamp(data.ga4.lastStoredAt)}</p>
            <div className="max-h-[360px] overflow-auto" role="region" aria-label="GA4 observations" tabIndex={0}>
              <table className="w-full min-w-[590px] border-collapse text-left text-[11px]">
                <caption className="sr-only">GA4 stored observations</caption>
                <thead className="text-[10px] text-ink-500"><tr>{["Date", "Property", "Campaign", "Metric", "Observed value"].map((label) => <th scope="col" key={label} className="border-b border-line-2 px-[6px] py-[8px] font-semibold last:text-right">{label}</th>)}</tr></thead>
                <tbody>{data.ga4.observations.map((row) => <tr key={row.id} className="border-b border-line-4 text-ink-700">
                  <td className="whitespace-nowrap px-[6px] py-[8px]">{row.date}</td><td className="max-w-[210px] break-words px-[6px] py-[8px]">{data.sources.find((source) => source.id === row.sourceId)?.name ?? "Property not recorded"}</td><td className="max-w-[240px] break-words px-[6px] py-[8px]">{row.campaign ?? "Unspecified"}</td><td className="px-[6px] py-[8px]">{row.metric === "sessions" ? "Sessions" : "Conversions"}</td><td className="px-[6px] py-[8px] text-right font-mono">{row.value === null ? "Unknown" : numberLabel(row.value)}</td>
                </tr>)}</tbody>
              </table>
            </div>
          </> : null}
        </section>
        <section aria-labelledby="paid-measurement-heading" className="border-b border-line-2 py-[20px]">
          <div className="flex min-w-0 flex-wrap items-center justify-between gap-[10px]">
            <h2 id="paid-measurement-heading" className="m-0 text-[16px] font-semibold text-ink-900">Paid measurement</h2>
            {account ? <select aria-label="Paid measurement account" value={account.sourceId} onChange={(event) => setSelectedAccount(event.target.value)} className={`${control} w-full sm:w-[300px]`}>{data.paid.accounts.map((item) => {
              const source = data.sources.find((candidate) => candidate.id === item.sourceId);
              return <option key={item.sourceId} value={item.sourceId}>{source ? `${labels[source.platform]} / ${source.name}` : "Account unavailable"}</option>;
            })}</select> : null}
          </div>
          <p className="mb-0 mt-[5px] text-[11.5px] text-ink-500">Provider-reported results, kept separate by account.</p>
          {account && paidSource ? <>
            <details className="mt-[10px] text-[11px] text-ink-600">
              <summary className={`w-fit cursor-pointer ${focusRing}`}>Source coverage</summary>
              <Sources sources={[paidSource]} />
              <p className="mb-0 mt-[9px] text-[11.5px] leading-[1.6] text-ink-500">Conversions may overlap with GA4 or other accounts. Missing days are not zero. Totals include only observed campaign measurements.</p>
            </details>
            <PaidObservations account={account} range={data.range} />
          </> : <p className="mt-[18px] flex items-center gap-[7px] text-[12px] text-ink-500"><LuDatabase aria-hidden />No paid measurement sources connected.</p>}
        </section>
        <section aria-labelledby="appsflyer-heading" className="border-b border-line-2 py-[18px]">
          <h2 id="appsflyer-heading" className="m-0 text-[14px] font-semibold text-ink-800">AppsFlyer</h2><p className="mb-0 mt-[4px] text-[11.5px] text-ink-500">Unavailable. No connector or measurements configured.</p>
        </section>
      </> : null}
    </div>
  </section>;
}
