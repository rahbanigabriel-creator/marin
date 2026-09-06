import { LuCircleAlert, LuCircleCheck } from "react-icons/lu";
import type { MeasurementAnalyticsResponse, MeasurementSource, PaidMeasurementAccount } from "@/lib/measurement-analytics/types";

export const focusRing = "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-plum";
export const control = `h-[34px] min-w-0 max-w-full rounded-[6px] border border-line-1 bg-white px-[9px] text-[12px] text-ink-700 ${focusRing}`;
export const labels = { ga4: "Google Analytics 4", google_ads: "Google Ads", meta_ads: "Meta Ads" };

export function numberLabel(value: number | null): string {
  return value === null ? "Unavailable" : new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 }).format(value);
}

function moneyLabel(value: number | null, currency: string | null): string {
  if (value === null || !currency) return "Unavailable";
  try {
    return new Intl.NumberFormat(undefined, { style: "currency", currency, currencyDisplay: "code", maximumFractionDigits: 2 }).format(value);
  } catch { return "Unavailable"; }
}

export function timestamp(value: string | null): string {
  if (!value) return "Not recorded";
  return `${new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" }).format(new Date(value))} UTC`;
}

export function Sources({ sources }: { sources: MeasurementSource[] }) {
  return <div className="mt-[12px] divide-y divide-line-4 border-y border-line-2">
    {sources.map((source) => {
      const connected = source.connectionState === "connected";
      const Icon = connected ? LuCircleCheck : LuCircleAlert;
      const label = { connected: "Connected", error: "Connection error", revoked: "Disconnected", unknown: "Status unknown" }[source.connectionState];
      return <div key={source.id} className="grid min-w-0 gap-[7px] py-[12px] sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <div className="min-w-0">
          <p className="m-0 break-words text-[12px] font-semibold text-ink-800">{source.name}</p>
          <p className="mb-[5px] mt-[2px] break-words font-mono text-[10px] text-ink-500">{labels[source.platform]} / {source.accountId}</p>
          <span className={`inline-flex items-center gap-[5px] text-[11px] font-semibold ${connected ? "text-pos-700" : "text-ink-500"}`}><Icon aria-hidden />{label}</span>
        </div>
        <dl className="m-0 grid grid-cols-[auto_minmax(0,1fr)] gap-x-[10px] gap-y-[3px] text-[10.5px] text-ink-500">
          <dt>Last successful sync</dt><dd className="m-0">{timestamp(source.lastSuccessfulSyncAt)}</dd>
          <dt>Last stored update</dt><dd className="m-0">{timestamp(source.lastStoredAt)}</dd>
          <dt>Observed dates</dt><dd className="m-0">{source.observedFrom ? `${source.observedFrom} to ${source.observedTo}` : "No property/account-linked observations in range"}</dd>
        </dl>
      </div>;
    })}
  </div>;
}

export function PaidObservations({ account, range }: { account: PaidMeasurementAccount; range: MeasurementAnalyticsResponse["range"] }) {
  const hasClicks = account.series.some((point) => point.clicks !== null);
  const byDate = new Map(account.series.map((point) => [point.date, point.clicks]));
  const maxClicks = Math.max(1, ...account.series.map((point) => point.clicks ?? 0));
  const axis = Array.from({ length: range.days }, (_, index) => {
    const day = new Date(`${range.from}T00:00:00Z`);
    day.setUTCDate(day.getUTCDate() + index);
    const date = day.toISOString().slice(0, 10);
    return { date, clicks: byDate.get(date) ?? null };
  });
  const items = [
    { key: "spend" as const, label: "Spend", value: moneyLabel(account.metrics.spend, account.currency) },
    { key: "clicks" as const, label: "Clicks", value: numberLabel(account.metrics.clicks) },
    { key: "impressions" as const, label: "Impressions", value: numberLabel(account.metrics.impressions) },
    { key: "conversions" as const, label: "Provider conversions", value: numberLabel(account.metrics.conversions) },
  ];
  return <>
    <dl className="mt-[14px] grid min-w-0 grid-cols-2 border-y border-line-2 sm:grid-cols-4">
      {items.map((item) => <div key={item.key} className="min-w-0 px-[8px] py-[12px]">
        <dt className="text-[10px] font-semibold text-ink-500">{item.label}</dt>
        <dd className="mb-0 ml-0 mt-[4px] break-words font-mono text-[16px] font-semibold text-ink-800">{item.value}</dd>
        <dd className="mb-0 ml-0 mt-[3px] text-[10px] text-ink-500">{account.observedDays[item.key]} observed days / {range.days}</dd>
      </div>)}
    </dl>
    {Object.values(account.metrics).every((value) => value === null) ? <p className="text-[12px] text-ink-500">No usable paid measurements in this range.</p> : null}
    {account.notices.map((notice) => <p key={notice} className="text-[11px] text-ink-500">{notice}</p>)}
    {hasClicks ? <figure className="mx-0 mb-0 mt-[18px]" aria-label="Daily paid clicks">
      <figcaption className="text-[12px] font-semibold text-ink-700">Daily clicks</figcaption>
      <div role="img" aria-label={`Persisted daily clicks from ${range.from} to ${range.to}; ${account.observedDays.clicks} observed days. Missing days are not zero.`} className="mt-[10px] flex h-[130px] items-end border-b border-line-1" style={{ gap: range.days > 90 ? 0 : 1 }}>
        {axis.map((point) => <div key={point.date} title={`${point.date}: ${point.clicks === null ? "No observation" : `${numberLabel(point.clicks)} clicks`}`} className="flex h-full min-w-0 flex-1 items-end">
          {point.clicks !== null ? <div className="w-full bg-plum" style={{ height: point.clicks === 0 ? "2px" : `${Math.max(2, point.clicks / maxClicks * 100)}%` }} /> : null}
        </div>)}
      </div>
      <div className="mt-[5px] flex justify-between font-mono text-[10px] text-ink-500"><span>{range.from}</span><span>{range.to}</span></div>
      <details className="mt-[10px] text-[11px] text-ink-600">
        <summary className={`w-fit cursor-pointer ${focusRing}`}>Daily observations</summary>
        <div className="mt-[7px] max-h-[220px] overflow-y-auto" tabIndex={0} role="region" aria-label="Daily paid observations"><table className="w-full text-left"><thead><tr><th scope="col">Stored date</th><th scope="col" className="text-right">Clicks</th></tr></thead><tbody>
          {account.series.filter((point) => point.clicks !== null).map((point) => <tr key={point.date}><td className="py-[4px]">{point.date}</td><td className="text-right font-mono">{numberLabel(point.clicks)}</td></tr>)}
        </tbody></table></div>
      </details>
    </figure> : null}
  </>;
}
