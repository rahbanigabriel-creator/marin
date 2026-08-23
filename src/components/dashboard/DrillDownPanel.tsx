"use client";

import { useEffect, useId, useRef, useState } from "react";
import { MetricTrendChart } from "./MetricTrendChart";
import {
  campaignValue,
  COLUMN_ORDER,
  COLUMNS,
  compact,
  coverageLabel,
  metricIsUnavailable,
  money0,
  pct,
  resultLabel,
  roasColor,
  sourceStateColor,
  sourceStateLabel,
  type MetricKey,
  type PaidAd,
  type PaidCampaign,
} from "./format";

export interface DrillDownPanelProps {
  campaign: PaidCampaign | null;
  onClose: () => void;
}

const DRILL_METRICS: MetricKey[] = ["spend", "revenue", "roas", "conversions", "clicks", "cpa"];
const FOCUSABLE = [
  "button:not([disabled])",
  "a[href]",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "summary",
  "[tabindex]:not([tabindex='-1'])",
].join(",");

function statusStyle(status: string): React.CSSProperties {
  const value = status.toLowerCase();
  if (value === "active" || value === "enabled") return { background: "#E7EEE0", color: "#4C6B40" };
  if (value === "paused") return { background: "#EFEBE4", color: "#6B6359" };
  return { background: "#EFEEE7", color: "#6B6359" };
}

export function DrillDownPanel({ campaign, onClose }: DrillDownPanelProps): React.JSX.Element | null {
  const [metric, setMetric] = useState<MetricKey>("spend");
  const panelRef = useRef<HTMLDivElement | null>(null);
  const closeRef = useRef<HTMLButtonElement | null>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const titleId = useId();
  const campaignIdentity = campaign?.identity ?? null;

  useEffect(() => {
    if (!campaignIdentity) return;
    returnFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const frame = window.requestAnimationFrame(() => closeRef.current?.focus());
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = [...(panelRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? [])]
        .filter((element) => element.getAttribute("aria-hidden") !== "true" && element.offsetParent !== null);
      if (focusable.length === 0) {
        event.preventDefault();
        panelRef.current?.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      window.cancelAnimationFrame(frame);
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
      const target = returnFocusRef.current;
      window.requestAnimationFrame(() => target?.isConnected && target.focus());
    };
  }, [campaignIdentity, onClose]);

  useEffect(() => setMetric("spend"), [campaignIdentity]);

  if (!campaign) return null;

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-black/20" onMouseDown={onClose} aria-hidden="true" />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className="relative h-full w-[min(560px,100vw)] animate-riseIn overflow-y-auto bg-surface-page shadow-modal outline-none sm:w-[min(560px,92vw)]"
      >
        <header className="flex items-start justify-between gap-[12px] border-b border-line-3 bg-surface-card p-[18px_18px] sm:p-[20px_22px]">
          <div className="min-w-0">
            <div id={titleId} className="break-words font-serif text-[20px] font-medium text-ink-900">{campaign.campaign}</div>
            <div className="mt-[3px] flex flex-wrap items-center gap-x-[8px] gap-y-[4px]">
              <span className="font-mono text-[11px] text-ink-300">{campaign.label}</span>
              <span className="font-sans text-[11px] text-ink-400">{campaign.accountName}</span>
              {campaign.status ? (
                <span className="rounded-pill font-mono text-[10px] font-semibold" style={{ padding: "2px 8px", ...statusStyle(campaign.status) }}>
                  {campaign.status}
                </span>
              ) : null}
              {campaign.objective ? (
                <span className="rounded-pill border border-line-3 bg-[#F9F9F4] px-[8px] py-[2px] font-sans text-[11px] text-ink-400">
                  {campaign.objective}
                </span>
              ) : null}
              {campaign.budget != null ? (
                <span className="font-mono text-[11px] text-ink-300">
                  {campaign.currency ? money0(campaign.budget, campaign.currency) : "Budget unavailable"}
                  {campaign.currency && campaign.budgetType ? ` / ${campaign.budgetType}` : ""}
                </span>
              ) : null}
            </div>
            <div className="mt-[6px] flex flex-wrap items-center gap-x-[10px] gap-y-[3px] font-mono text-[9.5px] text-ink-300">
              <span style={{ color: sourceStateColor(campaign.sourceState) }}>{sourceStateLabel(campaign.sourceState)}</span>
              <span>Observed {coverageLabel(campaign.observedFrom, campaign.observedTo, campaign.timezone)}</span>
              {campaign.currency ? <span>{campaign.currency}</span> : <span>Currency unavailable</span>}
            </div>
          </div>
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            aria-label="Close campaign details"
            className="flex h-[34px] w-[34px] flex-shrink-0 cursor-pointer items-center justify-center rounded-[8px] border border-line-3 bg-white font-sans text-[20px] leading-none text-ink-400 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-plum"
          >
            <span aria-hidden>×</span>
          </button>
        </header>

        <div className="flex flex-col gap-[18px] p-[16px_14px] sm:p-[20px_22px]">
          <MetricTrendChart
            series={campaign.series}
            metric={metric}
            metricOptions={DRILL_METRICS}
            onMetricChange={setMetric}
            title="Daily trend"
            height={200}
            currency={campaign.currency}
          />

          <section aria-labelledby={`${titleId}-metrics`}>
            <div id={`${titleId}-metrics`} className="mb-[10px] font-mono text-[10px] font-semibold uppercase tracking-[0.08em] text-ink-300">
              All metrics
            </div>
            <dl className="grid grid-cols-2 gap-[8px] sm:grid-cols-[repeat(auto-fit,minmax(120px,1fr))] sm:gap-[10px]">
              {COLUMN_ORDER.map((key) => {
                const column = COLUMNS[key];
                const value = campaignValue(campaign, key);
                const unavailable = metricIsUnavailable(key, value, campaign.currency);
                return (
                  <div key={key} className="rounded-[8px] border border-line-3 bg-surface-card p-[10px_11px] sm:p-[11px_13px]">
                    <dd
                      className="font-mono text-[15px] font-semibold"
                      style={column.roasColored ? { color: roasColor(value) } : { color: unavailable ? "#A8A296" : "#2B2722" }}
                    >
                      {unavailable ? "Unavailable" : column.fmt(value, campaign.currency)}
                    </dd>
                    <dt className="mt-[2px] font-sans text-[11px] text-ink-400">
                      {key === "conversions" ? resultLabel(campaign.objective) : column.label}
                    </dt>
                  </div>
                );
              })}
            </dl>
          </section>

          <section aria-labelledby={`${titleId}-ads`}>
            <div className="mb-[10px] flex flex-wrap items-baseline justify-between gap-[5px]">
              <div id={`${titleId}-ads`} className="font-mono text-[10px] font-semibold uppercase tracking-[0.08em] text-ink-300">
                Ads &amp; creatives
              </div>
              <div className="font-mono text-[10px] text-ink-300">
                {campaign.ads.length > 0 ? `${campaign.ads.length} · coverage shown per ad` : "No ad-level snapshot"}
              </div>
            </div>
            {campaign.ads.length > 0 ? (
              <div className="flex flex-col gap-[10px]">
                {campaign.ads.map((ad, index) => (
                  <CreativeCard key={`${ad.externalId}:${index}`} ad={ad} resultNoun={resultLabel(campaign.objective)} />
                ))}
              </div>
            ) : (
              <p className="border-y border-line-3 py-[14px] font-sans text-[12.5px] leading-[1.5] text-ink-400">
                Ad-level performance is unavailable from this source. Campaign totals above are unchanged.
              </p>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}

function CreativeCard({ ad, resultNoun }: { ad: PaidAd; resultNoun: string }): React.JSX.Element {
  const [imageAvailable, setImageAvailable] = useState(true);
  const showImage = !!ad.thumbnailUrl && imageAvailable;
  const spendUnavailable = metricIsUnavailable("spend", ad.spend, ad.currency);
  return (
    <article className="flex min-w-0 gap-[10px] rounded-card border border-line-3 bg-surface-card p-[10px] sm:gap-[12px] sm:p-[12px]">
      <div className="relative flex h-[56px] w-[56px] flex-shrink-0 items-center justify-center overflow-hidden rounded-[8px] bg-[#F1EFE9] sm:h-[64px] sm:w-[64px]">
        {showImage ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={ad.thumbnailUrl as string}
            alt=""
            referrerPolicy="no-referrer"
            onError={() => setImageAvailable(false)}
            className="h-full w-full object-cover"
          />
        ) : (
          <span className="font-mono text-[9px] uppercase tracking-wide text-ink-300">
            {ad.creativeType === "video" ? "Video" : "Image"}
          </span>
        )}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center gap-[7px]">
          <span className="min-w-0 truncate font-sans text-[13px] font-medium text-ink-900">{ad.name}</span>
          {ad.status ? (
            <span className="flex-shrink-0 whitespace-nowrap rounded-pill font-mono text-[9px] font-semibold" style={{ padding: "1px 6px", ...statusStyle(ad.status) }}>
              {ad.status}
            </span>
          ) : null}
        </div>
        {ad.title ? <div className="mt-[2px] truncate font-sans text-[12px] text-ink-800">{ad.title}</div> : null}
        {ad.body ? <div className="mt-[1px] line-clamp-2 font-sans text-[11.5px] leading-[1.4] text-ink-400">{ad.body}</div> : null}
        <div className="mt-[7px] flex flex-wrap items-center gap-x-[10px] gap-y-[3px] font-mono text-[10.5px] text-ink-300">
          <span>{spendUnavailable ? "Spend unavailable" : money0(ad.spend, ad.currency)}</span>
          <span>{ad.impressions == null ? "Impressions unavailable" : `${compact(ad.impressions)} impr`}</span>
          <span>{ad.clicks == null ? "Clicks unavailable" : `${compact(ad.clicks)} clicks`}</span>
          <span>{ad.ctr == null ? "CTR unavailable" : `${pct(ad.ctr)} CTR`}</span>
          {ad.conversions != null ? <span className="text-ink-400">{compact(ad.conversions)} {resultNoun.toLowerCase()}</span> : null}
          {ad.callToAction ? (
            <span className="rounded-pill border border-line-3 bg-[#F9F9F4] px-[7px] py-[1px] text-ink-400">{ad.callToAction}</span>
          ) : null}
        </div>
        <div className="mt-[5px] font-mono text-[9.5px] text-ink-300">
          Ad metrics {coverageLabel(ad.metricsFrom, ad.metricsTo, ad.timezone)}
        </div>
      </div>
    </article>
  );
}
