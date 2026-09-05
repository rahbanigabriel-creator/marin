"use client";

import { useState } from "react";
import {
  LuActivity,
  LuArrowUpRight,
  LuChartNoAxesCombined,
  LuCircleAlert,
  LuCircleCheck,
  LuEye,
  LuPause,
  LuPlay,
} from "react-icons/lu";
import {
  compact,
  coverageLabel,
  metricIsUnavailable,
  money0,
  pct,
  sourceStateColor,
  sourceStateLabel,
  type MetricKey,
  type PaidCampaign,
  type PaidDashboardData,
} from "./format";

const REPORTING_METRICS: MetricKey[] = ["spend", "revenue", "roas", "conversions", "clicks", "ctr"];

function sourceTimezone(data: PaidDashboardData): string | null {
  const zones = [...new Set(data.sources.map((source) => source.timezone).filter((value): value is string => !!value))];
  return zones.length === 1 ? zones[0] : zones.length > 1 ? "multiple source timezones" : null;
}

function campaignStatus(value: string | null): "active" | "paused" | "other" {
  const status = value?.toLowerCase();
  if (status === "active" || status === "enabled") return "active";
  if (status === "paused") return "paused";
  return "other";
}

function statusStyle(status: "active" | "paused" | "other"): React.CSSProperties {
  if (status === "active") return { background: "#E7EEE0", color: "#4C6B40" };
  if (status === "paused") return { background: "#EFEBE4", color: "#6B6359" };
  return { background: "#F2E2EA", color: "#7E2F50" };
}

function statusLabel(status: "active" | "paused" | "other"): string {
  if (status === "active") return "active";
  if (status === "paused") return "paused";
  return "other status";
}

function sourceStateMessage(data: PaidDashboardData): string {
  if (data.state === "available") return "Connected sources are available for sync.";
  if (data.state === "partial") return "Some requested metrics were not returned by the connected source.";
  if (data.state === "stale") return "This view contains saved observations that may no longer be current.";
  if (data.state === "failed") return "Saved observations remain visible, but the most recent source refresh failed.";
  if (data.state === "revoked") return "One or more accounts need to be reconnected before their data can refresh.";
  return "Source health is currently unavailable.";
}

function CampaignVisual({ campaign }: { campaign: PaidCampaign }): React.JSX.Element {
  const [imageAvailable, setImageAvailable] = useState(true);
  const thumbnail = campaign.ads.find((ad) => !!ad.thumbnailUrl)?.thumbnailUrl;
  const hasThumbnail = !!thumbnail && imageAvailable;
  const status = campaignStatus(campaign.status);

  return (
    <div className="relative flex h-[116px] w-full overflow-hidden rounded-[8px] border border-line-3 bg-[#F4F1EB] sm:h-[132px]" aria-hidden>
      {hasThumbnail ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={thumbnail as string} alt="" referrerPolicy="no-referrer" onError={() => setImageAvailable(false)} className="h-full w-full object-cover" />
      ) : (
        <>
          <div className="absolute inset-y-0 left-0 w-[34%] bg-plum-soft" />
          <div className="absolute left-[12%] top-[18px] h-[52px] w-[52px] rounded-[8px] border border-plum-border bg-white sm:h-[58px] sm:w-[58px]" />
          <div className="absolute left-[12%] top-[80px] h-[7px] w-[46%] rounded-full bg-plum-muted/70 sm:top-[89px]" />
          <div className="absolute left-[12%] top-[94px] h-[6px] w-[35%] rounded-full bg-[#C9C4BA] sm:top-[103px]" />
          <div className="absolute right-[13px] top-[16px] flex h-[28px] w-[28px] items-center justify-center rounded-[7px] border border-line-3 bg-white text-plum">
            <LuActivity size={15} />
          </div>
          <div className="absolute bottom-[15px] right-[14px] font-mono text-[9px] font-semibold uppercase tracking-[0.08em] text-ink-300">{campaign.label}</div>
        </>
      )}
      <span className="absolute left-[10px] top-[10px] rounded-pill font-mono text-[9px] font-semibold" style={{ padding: "2px 7px", ...statusStyle(status) }}>
        {statusLabel(status)}
      </span>
    </div>
  );
}

function CampaignFocusCard({ campaign, maxSpend, onSelect }: { campaign: PaidCampaign; maxSpend: number; onSelect: (campaign: PaidCampaign) => void }): React.JSX.Element {
  const spendUnavailable = metricIsUnavailable("spend", campaign.spend, campaign.currency);
  const barWidth = spendUnavailable || campaign.spend == null ? 0 : Math.max(8, Math.round((campaign.spend / maxSpend) * 100));
  const status = campaignStatus(campaign.status);

  return (
    <button
      type="button"
      onClick={() => onSelect(campaign)}
      className="group w-full min-w-0 cursor-pointer text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-plum"
      aria-label={`Open details for ${campaign.campaign}`}
    >
      <CampaignVisual campaign={campaign} />
      <div className="pt-[10px]">
        <div className="flex min-w-0 items-start justify-between gap-[8px]">
          <div className="min-w-0">
            <p className="truncate font-sans text-[13px] font-semibold text-ink-900 group-hover:text-plum">{campaign.campaign}</p>
            <p className="mt-[2px] truncate font-mono text-[9.5px] text-ink-300">{campaign.accountName} · {campaign.objective ?? "Objective unavailable"}</p>
          </div>
          <LuArrowUpRight className="mt-[1px] flex-none text-ink-300 group-hover:text-plum" aria-hidden size={15} />
        </div>
        <div className="mt-[10px] flex items-baseline justify-between gap-[8px]">
          <span className="font-mono text-[16px] font-semibold text-ink-900">{spendUnavailable ? "—" : money0(campaign.spend, campaign.currency)}</span>
          <span className="font-mono text-[10.5px] text-ink-300">{campaign.ctr == null ? "CTR unavailable" : `${pct(campaign.ctr)} CTR`}</span>
        </div>
        <div className="mt-[6px] h-[4px] overflow-hidden rounded-full bg-track-1" aria-hidden>
          <div className="h-full rounded-full bg-plum" style={{ width: `${barWidth}%` }} />
        </div>
      </div>
    </button>
  );
}

export function PaidOverview({
  data,
  campaigns,
  onSelectCampaign,
  onOpenDrafts,
}: {
  data: PaidDashboardData;
  campaigns: PaidCampaign[];
  onSelectCampaign: (campaign: PaidCampaign) => void;
  onOpenDrafts: () => void;
}): React.JSX.Element {
  const timezone = sourceTimezone(data);
  const coverage = coverageLabel(data.observedFrom, data.observedTo, timezone);
  const spendUnavailable = metricIsUnavailable("spend", data.totals.spend, data.currency);
  const activeCount = campaigns.filter((campaign) => campaignStatus(campaign.status) === "active").length;
  const pausedCount = campaigns.filter((campaign) => campaignStatus(campaign.status) === "paused").length;
  const otherCount = Math.max(0, campaigns.length - activeCount - pausedCount);
  const availableMetrics = REPORTING_METRICS.filter((key) => !metricIsUnavailable(key, data.totals[key], data.currency));
  const unavailableMetrics = REPORTING_METRICS.filter((key) => metricIsUnavailable(key, data.totals[key], data.currency));
  const focusCampaigns = [...campaigns]
    .sort((left, right) => (right.spend ?? -1) - (left.spend ?? -1) || left.campaign.localeCompare(right.campaign))
    .slice(0, 3);
  const maxSpend = Math.max(...focusCampaigns.map((campaign) => campaign.spend ?? 0), 1);
  const sourceTone = sourceStateColor(data.state);
  const postureLabel = campaigns.length === 0
    ? "No campaign snapshots"
    : activeCount === 0 && pausedCount === campaigns.length
      ? `All ${campaigns.length} campaigns are paused`
      : `${activeCount} active · ${pausedCount} paused${otherCount > 0 ? ` · ${otherCount} other` : ""}`;
  const postureIcon = activeCount > 0 ? <LuPlay size={15} aria-hidden /> : <LuPause size={15} aria-hidden />;

  return (
    <section aria-label="Paid campaign overview" className="mb-[18px]" data-testid="paid-overview">
      <div className="grid gap-[10px] lg:grid-cols-[minmax(0,1.18fr)_minmax(270px,0.82fr)]">
        <article className="relative min-w-0 overflow-hidden rounded-card border border-line-3 bg-surface-card p-[18px] sm:p-[20px]">
          <div className="absolute right-[18px] top-[18px] flex h-[34px] w-[34px] items-center justify-center rounded-[8px] bg-plum-soft text-plum" aria-hidden>
            <LuChartNoAxesCombined size={18} />
          </div>
          <div className="pr-[52px]">
            <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.1em] text-ink-300">Performance snapshot</p>
            <h2 className="mt-[8px] font-serif text-[27px] font-medium leading-[1] text-ink-900 sm:text-[32px]">
              {spendUnavailable ? "Spend unavailable" : money0(data.totals.spend, data.currency)}
            </h2>
            <p className="mt-[6px] font-sans text-[12px] text-ink-400">Observed spend · {coverage}</p>
          </div>

          <div className="mt-[22px] grid grid-cols-2 gap-[8px] sm:grid-cols-3">
            <div className="border-l-2 border-plum pl-[9px]">
              <p className="font-mono text-[10px] text-ink-300">CTR</p>
              <p className="mt-[2px] font-mono text-[16px] font-semibold text-ink-900">{data.totals.ctr == null ? "—" : pct(data.totals.ctr)}</p>
            </div>
            <div className="border-l-2 border-[#C7C2B8] pl-[9px]">
              <p className="font-mono text-[10px] text-ink-300">Clicks</p>
              <p className="mt-[2px] font-mono text-[16px] font-semibold text-ink-900">{data.totals.clicks == null ? "—" : compact(data.totals.clicks)}</p>
            </div>
            <div className="col-span-2 border-l-2 border-[#C7C2B8] pl-[9px] sm:col-span-1">
              <p className="font-mono text-[10px] text-ink-300">Results</p>
              <p className="mt-[2px] font-mono text-[16px] font-semibold text-ink-900">{data.totals.conversions == null ? "—" : compact(data.totals.conversions)}</p>
            </div>
          </div>
        </article>

        <article className="min-w-0 rounded-card border border-line-3 bg-surface-card p-[18px] sm:p-[20px]">
          <div className="flex items-start justify-between gap-[12px]">
            <div>
              <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.1em] text-ink-300">Campaign posture</p>
              <h2 className="mt-[8px] font-sans text-[16px] font-semibold text-ink-900">{postureLabel}</h2>
            </div>
            <span className="flex h-[32px] w-[32px] flex-none items-center justify-center rounded-[8px]" style={activeCount > 0 ? { background: "#E7EEE0", color: "#4C6B40" } : { background: "#EFEBE4", color: "#6B6359" }}>
              {postureIcon}
            </span>
          </div>
          {campaigns.length > 0 ? (
            <div className="mt-[22px] flex h-[10px] overflow-hidden rounded-full bg-track-1" aria-label={`${activeCount} active, ${pausedCount} paused, ${otherCount} other campaign statuses`}>
              {activeCount > 0 ? <span style={{ width: `${(activeCount / campaigns.length) * 100}%`, background: "#5E7B52" }} /> : null}
              {pausedCount > 0 ? <span style={{ width: `${(pausedCount / campaigns.length) * 100}%`, background: "#C7C2B8" }} /> : null}
              {otherCount > 0 ? <span style={{ width: `${(otherCount / campaigns.length) * 100}%`, background: "#9A3D63" }} /> : null}
            </div>
          ) : null}
          <div className="mt-[10px] flex flex-wrap gap-x-[12px] gap-y-[5px] font-mono text-[10px] text-ink-300">
            <span><i className="mr-[5px] inline-block h-[6px] w-[6px] rounded-full bg-pos-500" />{activeCount} active</span>
            <span><i className="mr-[5px] inline-block h-[6px] w-[6px] rounded-full bg-[#C7C2B8]" />{pausedCount} paused</span>
            {otherCount > 0 ? <span><i className="mr-[5px] inline-block h-[6px] w-[6px] rounded-full bg-plum" />{otherCount} other</span> : null}
          </div>
          {activeCount === 0 && campaigns.length > 0 ? (
            <button type="button" onClick={onOpenDrafts} className="mt-[17px] inline-flex items-center gap-[6px] font-sans text-[12px] font-semibold text-plum hover:text-plum-deep focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-plum">
              Review campaign drafts <LuArrowUpRight aria-hidden size={14} />
            </button>
          ) : null}
        </article>
      </div>

      <div className="mt-[10px] grid gap-[10px] lg:grid-cols-[minmax(0,1.18fr)_minmax(270px,0.82fr)]">
        <article className="flex min-w-0 items-start gap-[10px] rounded-[8px] border border-line-3 bg-surface-rec px-[13px] py-[12px]">
          <span className="mt-[1px] flex h-[25px] w-[25px] flex-none items-center justify-center rounded-[6px]" style={{ background: `${sourceTone}1A`, color: sourceTone }}>
            {data.state === "available" ? <LuCircleCheck size={14} aria-hidden /> : <LuCircleAlert size={14} aria-hidden />}
          </span>
          <div className="min-w-0">
            <p className="font-sans text-[12px] font-semibold text-ink-800">{sourceStateLabel(data.state)} source data</p>
            <p className="mt-[2px] font-sans text-[11.5px] leading-[1.45] text-ink-400">{sourceStateMessage(data)}</p>
          </div>
        </article>
        <article className="flex min-w-0 items-start gap-[10px] rounded-[8px] border border-line-3 bg-surface-rec px-[13px] py-[12px]">
          <span className="mt-[1px] flex h-[25px] w-[25px] flex-none items-center justify-center rounded-[6px] bg-plum-soft text-plum"><LuEye size={14} aria-hidden /></span>
          <div className="min-w-0">
            <p className="font-sans text-[12px] font-semibold text-ink-800">What the source reported</p>
            <p className="mt-[2px] font-sans text-[11.5px] leading-[1.45] text-ink-400">
              {availableMetrics.length > 0 ? `Available: ${availableMetrics.map((key) => key === "ctr" ? "CTR" : key[0].toUpperCase() + key.slice(1)).join(", ")}. ` : "No summary metrics were returned. "}
              {unavailableMetrics.length > 0 ? `Not reported: ${unavailableMetrics.map((key) => key === "roas" ? "ROAS" : key === "ctr" ? "CTR" : key[0].toUpperCase() + key.slice(1)).join(", ")}.` : ""}
            </p>
          </div>
        </article>
      </div>

      {focusCampaigns.length > 0 ? (
        <section className="mt-[18px]" aria-labelledby="campaign-focus-heading" data-testid="paid-campaign-focus-grid">
          <div className="mb-[10px] flex flex-wrap items-end justify-between gap-[8px]">
            <div>
              <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.1em] text-ink-300">Campaign focus</p>
              <h2 id="campaign-focus-heading" className="mt-[3px] font-serif text-[22px] font-medium text-ink-900">Highest observed spend</h2>
            </div>
            <p className="font-sans text-[11.5px] text-ink-400">Open a campaign for its creative and daily detail.</p>
          </div>
          <div className="grid gap-x-[14px] gap-y-[18px] sm:grid-cols-2 xl:grid-cols-3">
            {focusCampaigns.map((campaign) => <CampaignFocusCard key={campaign.identity} campaign={campaign} maxSpend={maxSpend} onSelect={onSelectCampaign} />)}
          </div>
        </section>
      ) : null}
    </section>
  );
}
