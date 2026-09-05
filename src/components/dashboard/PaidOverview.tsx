"use client";

import { useState } from "react";
import { LuArrowUpRight, LuCircleDollarSign, LuEye, LuMousePointer2, LuPercent, LuTarget, LuTrendingUp } from "react-icons/lu";
import { SiGoogleads, SiMeta } from "react-icons/si";
import { MetricTrendChart } from "./MetricTrendChart";
import { COLUMNS, MONEY_METRICS, compact, dailyValue, dayLabel, deltaFor, metricIsUnavailable, money2, type MetricKey, type PaidCampaign, type PaidDashboardData } from "./format";

const METRICS = [
  { key: "spend", label: "Ad spend", icon: LuCircleDollarSign },
  { key: "impressions", label: "Impressions", icon: LuEye },
  { key: "clicks", label: "Clicks", icon: LuMousePointer2 },
  { key: "ctr", label: "Click-through rate", icon: LuPercent },
  { key: "conversions", label: "Conversions", icon: LuTarget },
  { key: "roas", label: "Return on ad spend", icon: LuTrendingUp },
] satisfies { key: MetricKey; label: string; icon: typeof LuEye }[];

export type CampaignStatusFilter = "all" | "active" | "paused" | "other";

export function campaignStatus(value: string | null): Exclude<CampaignStatusFilter, "all"> {
  const status = value?.toLowerCase();
  return status === "active" || status === "enabled" ? "active" : status === "paused" ? "paused" : "other";
}

export function PlatformMark({ platform, size = 16 }: { platform: string; size?: number }): React.JSX.Element {
  return platform === "meta_ads" ? <SiMeta size={size} aria-hidden className="text-[#1877F2]" /> : <SiGoogleads size={size} aria-hidden className="text-[#4285F4]" />;
}

function unavailable(data: PaidDashboardData, key: MetricKey): boolean {
  return metricIsUnavailable(key, data.totals[key], data.currency)
    || (data.mixedCurrency && (MONEY_METRICS.has(key) || key === "roas"));
}

export function PaidOverview({ data, campaigns, statusFilter, onStatusFilter, onOpenDrafts, onSelectCampaign }: {
  data: PaidDashboardData;
  campaigns: PaidCampaign[];
  statusFilter: CampaignStatusFilter;
  onStatusFilter: (status: CampaignStatusFilter) => void;
  onOpenDrafts: () => void;
  onSelectCampaign: (campaign: PaidCampaign) => void;
}): React.JSX.Element {
  const [metric, setMetric] = useState<MetricKey>("spend");
  const [failedPreviews, setFailedPreviews] = useState<Set<string>>(() => new Set());
  const featured = campaigns.find((campaign) => campaign.ads.some((ad) => !!ad.thumbnailUrl && !failedPreviews.has(ad.thumbnailUrl)));
  const featuredAd = featured?.ads.find((ad) => !!ad.thumbnailUrl && !failedPreviews.has(ad.thumbnailUrl));
  const [chartScope, setChartScope] = useState<"requested" | "observed">("requested");
  const missing = unavailable(data, metric);
  const knownDays = data.series.filter((point) => dailyValue(point, metric) != null);
  const first = knownDays[0]?.date;
  const last = knownDays.at(-1)?.date;
  // Trim only the outside of the reporting window; preserve every internal gap.
  const chartSeries = chartScope === "observed" && first && last
    ? data.series.filter((point) => point.date >= first && point.date <= last)
    : data.series;
  const counts = { active: 0, paused: 0, other: 0 };
  campaigns.forEach((campaign) => counts[campaignStatus(campaign.status)]++);
  const segments = [
    { key: "active" as const, label: "Active", count: counts.active, color: "#BFD6AF" },
    { key: "paused" as const, label: "Paused", count: counts.paused, color: "#D998B4" },
    { key: "other" as const, label: "Other", count: counts.other, color: "#DED8D0" },
  ];
  let offset = 0;

  return (
    <section aria-label="Paid campaign overview" data-testid="paid-overview" className="mb-7 min-w-0">
      <div className="grid grid-cols-2 overflow-hidden rounded-[8px] border border-line-3 bg-white md:grid-cols-3 xl:grid-cols-6" aria-label="Performance metrics">
        {METRICS.map(({ key, label, icon: Icon }) => {
          const isMissing = unavailable(data, key);
          const selected = metric === key;
          const delta = isMissing ? null : deltaFor(key, data.totals[key], data.previous[key]);
          return (
            <button key={key} type="button" aria-label={`Chart ${label}`} aria-pressed={selected} onClick={() => setMetric(key)}
              className={`relative min-w-0 border-b border-r border-line-3 px-4 py-4 text-left transition-colors focus-visible:z-10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-plum sm:px-5 ${selected ? "bg-plum-soft/70" : "hover:bg-surface-chip"}`}>
              <span className={`absolute inset-x-0 top-0 h-[3px] ${selected ? "bg-plum" : "bg-transparent"}`} />
              <span className="flex items-center justify-between gap-2 text-[11px] font-medium text-ink-400"><span>{label}</span><Icon size={15} aria-hidden className={selected ? "flex-none text-plum" : "flex-none text-ink-300/70"} /></span>
              <span data-testid="kpi-value" className={`mt-3 block max-w-full break-words font-sans font-semibold leading-tight tabular-nums ${isMissing ? "text-[17px] text-ink-300" : "text-[25px] text-ink-900"}`}>
                {isMissing ? "Unavailable" : MONEY_METRICS.has(key) ? money2(data.totals[key], data.currency) : COLUMNS[key].fmt(data.totals[key], data.currency)}
              </span>
              <span className={`mt-2 block text-[10px] ${delta?.tone === "good" ? "text-pos-500" : delta?.tone === "bad" ? "text-[#B23A4B]" : "text-ink-300"}`}>
                {isMissing ? (data.mixedCurrency && (MONEY_METRICS.has(key) || key === "roas") ? "Select one currency" : "Not reported") : delta && delta.label !== "—" ? `${delta.label} vs previous period` : "Observed in this period"}
              </span>
            </button>
          );
        })}
      </div>

      <div className="mt-4 grid min-w-0 gap-4 lg:grid-cols-[minmax(0,1fr)_280px] xl:grid-cols-[minmax(0,1fr)_300px]">
        <div className="min-w-0 rounded-[8px] border border-line-3 bg-white p-4 sm:p-5" role="group" aria-label="Paid performance trend">
          <MetricTrendChart embedded series={chartSeries} metric={metric} currency={data.currency} height={190} title={`${COLUMNS[metric].full} over time`}
            unavailableReason={data.mixedCurrency && (MONEY_METRICS.has(metric) || metric === "roas") ? "Select an account to view this metric in its source currency." : null} />
          <div className="mt-2 flex flex-wrap items-center justify-between gap-2 border-t border-line-3 pt-3 text-[10px] text-ink-400">
            <span><span className="mr-1.5 inline-block h-1.5 w-1.5 rounded-full bg-plum" />{missing ? "No comparable observations" : `${knownDays.length} reported ${knownDays.length === 1 ? "day" : "days"}`}{chartScope === "observed" && first && last && !missing ? ` · ${dayLabel(first)} – ${dayLabel(last)}` : ""}</span>
            {knownDays.length > 0 && knownDays.length < data.series.length && !missing ? <div className="flex gap-1" role="group" aria-label="Chart date coverage">{(["requested", "observed"] as const).map((scope) => <button type="button" key={scope} aria-pressed={scope === chartScope} onClick={() => setChartScope(scope)} className={`rounded-[4px] px-2 py-1 text-[10px] font-medium ${scope === chartScope ? "bg-surface-sidebar text-ink-900" : "text-ink-400 hover:bg-surface-chip"}`}>{scope === "requested" ? "Full period" : "Reported days"}</button>)}</div> : <span>Missing data is not zero</span>}
          </div>
        </div>

        <aside className="flex min-w-0 flex-col overflow-hidden rounded-[8px] bg-[#412333] p-5 text-white" aria-label="Campaign activity">
          <div className="flex items-center justify-between"><h2 className="text-[14px] font-semibold">Campaign activity</h2><span className="text-[10px] text-[#D9C7D1]">Source status</span></div>
          {featured && featuredAd?.thumbnailUrl ? <button type="button" onClick={() => onSelectCampaign(featured)} aria-label={`Open featured creative for ${featured.campaign}`} className="relative mt-3 block h-[125px] w-full overflow-hidden rounded-[5px] bg-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-white">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={featuredAd.thumbnailUrl} alt={featuredAd.title ?? featuredAd.name} referrerPolicy="no-referrer" onError={() => setFailedPreviews((previous) => new Set([...previous, featuredAd.thumbnailUrl as string]))} className="h-full w-full object-contain" />
            <span className="absolute bottom-0 left-0 right-0 flex items-center justify-between gap-2 bg-[#412333]/90 px-2 py-1 text-[10px] text-white"><span className="truncate">{featured.campaign}</span><LuArrowUpRight size={12} aria-hidden /></span>
          </button> : null}
          <div className={featuredAd ? "mt-2 flex items-center" : ""}>
          <div className="my-2 flex items-center justify-center">
            <svg viewBox="0 0 180 180" className={featuredAd ? "h-[100px] w-[100px] flex-none" : "h-[150px] w-[150px] flex-none"} role="img" aria-label={`${counts.active} active, ${counts.paused} paused, ${counts.other} other campaigns`}>
              <circle cx="90" cy="90" r="70" fill="none" stroke="#634151" strokeWidth="10" />
              {segments.filter((segment) => segment.count > 0).map((segment) => {
                const share = segment.count / campaigns.length * 100;
                const start = offset;
                offset += share;
                return <circle key={segment.key} cx="90" cy="90" r="70" pathLength="100" fill="none" stroke={segment.color} strokeWidth="10" strokeDasharray={`${Math.max(share - (share < 100 ? 1.5 : 0), 0)} ${100 - Math.max(share - (share < 100 ? 1.5 : 0), 0)}`} strokeDashoffset={-start} transform="rotate(-90 90 90)" />;
              })}
              <text x="90" y="91" textAnchor="middle" fill="white" fontSize="42" fontWeight="500" className="font-sans">{campaigns.length}</text>
              <text x="90" y="112" textAnchor="middle" fill="#D9C7D1" fontSize="11" className="font-sans">campaigns</text>
            </svg>
          </div>
          <div className="grid flex-1 grid-cols-3 gap-1" role="group" aria-label="Filter campaign status">
            {segments.map((segment) => <button type="button" key={segment.key} onClick={() => onStatusFilter(statusFilter === segment.key ? "all" : segment.key)} aria-pressed={statusFilter === segment.key} aria-label={`Show ${segment.label.toLowerCase()} campaigns`} className={`min-w-0 rounded-[6px] py-2 text-center transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-white ${statusFilter === segment.key ? "bg-white/15" : "hover:bg-white/10"}`}><span className="block text-[20px] font-medium tabular-nums">{segment.count}</span><span className="mt-0.5 block text-[10px] text-[#D9C7D1]"><i className="mr-1 inline-block h-1.5 w-1.5 rounded-full" style={{ background: segment.color }} />{segment.label}</span></button>)}
          </div>
          </div>
          <button type="button" onClick={onOpenDrafts} className="mt-auto flex w-full items-center justify-between gap-2 border-t border-white/15 pt-4 text-left text-[12px] font-medium text-white hover:text-[#D998B4] focus-visible:outline focus-visible:outline-2 focus-visible:outline-white">Campaign drafts <LuArrowUpRight size={16} aria-hidden /></button>
        </aside>
      </div>

      {data.platforms.length > 0 ? <div className="mt-4 grid gap-x-7 gap-y-3 border-b border-line-3 pb-4 sm:grid-cols-2" aria-label="Platform spend">
        {data.platforms.map((platform) => {
          const missingSpend = platform.mixedCurrency || metricIsUnavailable("spend", platform.spend, platform.currency);
          const total = data.totals.spend;
          const share = !data.mixedCurrency && !missingSpend && total != null && total > 0 && platform.spend != null ? Math.min(100, platform.spend / total * 100) : null;
          return <div key={platform.platform} className="flex min-w-0 items-center gap-3"><PlatformMark platform={platform.platform} size={19} /><div className="min-w-0 flex-1"><div className="flex items-center justify-between gap-3 text-[11px]"><span className="font-medium text-ink-800">{platform.label}</span><span className="font-mono text-ink-600">{missingSpend ? "Spend unavailable" : money2(platform.spend, platform.currency)}</span></div>{share != null ? <div className="mt-2 h-1 overflow-hidden rounded-full bg-line-3" aria-label={`${platform.label}: ${Math.round(share)}% of spend`}><div className="h-full bg-plum" style={{ width: `${share}%` }} /></div> : null}</div><span className="w-12 text-right text-[10px] text-ink-300">{share == null ? "" : `${compact(share)}%`}</span></div>;
        })}
      </div> : null}
    </section>
  );
}
