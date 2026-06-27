"use client";

import { useEffect, useState } from "react";
import type { DashAd, DashCampaign } from "@/lib/metrics/dashboard";
import { MetricTrendChart } from "./MetricTrendChart";
import {
  campaignValue,
  COLUMN_ORDER,
  COLUMNS,
  compact,
  euro0,
  pct,
  resultLabel,
  roasColor,
  type MetricKey,
} from "./format";

/**
 * Right-anchored slide-over showing one campaign's detail: its own daily trend
 * (re-using MetricTrendChart) and a full stat grid of every derived metric, plus
 * any config (status / budget / objective) the Phase-3 sync has populated.
 */

export interface DrillDownPanelProps {
  campaign: DashCampaign | null;
  onClose: () => void;
}

const DRILL_METRICS: MetricKey[] = ["spend", "revenue", "roas", "conversions", "clicks", "cpa"];

function statusStyle(status: string): React.CSSProperties {
  const s = status.toLowerCase();
  if (s === "active" || s === "enabled") return { background: "#E7EEE0", color: "#4C6B40" };
  if (s === "paused") return { background: "#EFEBE4", color: "#6B6359" };
  return { background: "#EFEEE7", color: "#6B6359" };
}

export function DrillDownPanel({ campaign, onClose }: DrillDownPanelProps): React.JSX.Element | null {
  const [metric, setMetric] = useState<MetricKey>("spend");

  useEffect(() => {
    if (!campaign) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [campaign, onClose]);

  if (!campaign) return null;

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div
        className="absolute inset-0 bg-black/20"
        onClick={onClose}
        aria-hidden
      />
      <div className="relative h-full w-[min(560px,92vw)] animate-riseIn overflow-y-auto bg-surface-page shadow-modal">
        <div className="flex items-start justify-between gap-[12px] border-b border-line-3 bg-surface-card p-[20px_22px]">
          <div className="min-w-0">
            <div className="truncate font-serif text-[20px] font-medium text-ink-900">{campaign.campaign}</div>
            <div className="mt-[2px] flex flex-wrap items-center gap-[8px]">
              <span className="font-mono text-[11px] text-ink-300">{campaign.label}</span>
              {campaign.status ? (
                <span className="rounded-pill font-mono text-[10px] font-semibold" style={{ padding: "2px 8px", ...statusStyle(campaign.status) }}>
                  {campaign.status}
                </span>
              ) : null}
              {campaign.objective ? (
                <span className="rounded-pill font-sans text-[11px] text-ink-400" style={{ background: "#F9F9F4", padding: "2px 8px", border: "1px solid #E5E3DB" }}>
                  {campaign.objective}
                </span>
              ) : null}
              {campaign.budget != null ? (
                <span className="font-mono text-[11px] text-ink-300">
                  {euro0(campaign.budget)}{campaign.budgetType ? ` / ${campaign.budgetType}` : ""}
                </span>
              ) : null}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="cursor-pointer rounded-[8px] font-sans text-[18px] leading-none text-ink-400"
            style={{ border: "1px solid #E5E3DB", background: "#fff", padding: "5px 10px" }}
          >
            ×
          </button>
        </div>

        <div className="flex flex-col gap-[16px] p-[20px_22px]">
          <MetricTrendChart
            series={campaign.series}
            metric={metric}
            metricOptions={DRILL_METRICS}
            onMetricChange={setMetric}
            title="Daily trend"
            height={200}
          />

          <div>
            <div className="mb-[10px] font-mono text-[10px] font-semibold uppercase tracking-[0.08em] text-ink-300">
              All metrics
            </div>
            <div className="grid gap-[10px]" style={{ gridTemplateColumns: "repeat(auto-fit,minmax(120px,1fr))" }}>
              {COLUMN_ORDER.map((key) => {
                const col = COLUMNS[key];
                const v = campaignValue(campaign, key);
                const label = key === "conversions" ? resultLabel(campaign.objective) : col.label;
                return (
                  <div key={key} className="rounded-[11px] border border-line-3 bg-surface-card p-[11px_13px]">
                    <div
                      className="font-mono text-[15px] font-semibold text-ink-900"
                      style={col.roasColored ? { color: roasColor(v) } : undefined}
                    >
                      {col.fmt(v)}
                    </div>
                    <div className="mt-[2px] font-sans text-[11px] text-ink-400">{label}</div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Ads & creatives */}
          {campaign.ads.length > 0 ? (
            <div>
              <div className="mb-[10px] flex items-baseline justify-between">
                <div className="font-mono text-[10px] font-semibold uppercase tracking-[0.08em] text-ink-300">
                  Ads &amp; creatives
                </div>
                <div className="font-mono text-[10px] text-ink-300">{campaign.ads.length} · last-30d snapshot</div>
              </div>
              <div className="flex flex-col gap-[10px]">
                {campaign.ads.map((ad) => (
                  <CreativeCard key={ad.externalId} ad={ad} resultNoun={resultLabel(campaign.objective)} />
                ))}
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function CreativeCard({ ad, resultNoun }: { ad: DashAd; resultNoun: string }) {
  const [imgOk, setImgOk] = useState(true);
  const showImg = ad.thumbnailUrl && imgOk;
  return (
    <div className="flex gap-[12px] rounded-card border border-line-3 bg-surface-card p-[12px]">
      <div className="relative flex h-[64px] w-[64px] flex-shrink-0 items-center justify-center overflow-hidden rounded-[10px] bg-[#F1EFE9]">
        {showImg ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={ad.thumbnailUrl as string}
            alt=""
            referrerPolicy="no-referrer"
            onError={() => setImgOk(false)}
            className="h-full w-full object-cover"
          />
        ) : (
          <span className="font-mono text-[9px] uppercase tracking-wide text-ink-300">
            {ad.creativeType === "video" ? "▶ Video" : "Image"}
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
        <div className="mt-[7px] flex flex-wrap items-center gap-x-[12px] gap-y-[3px] font-mono text-[10.5px] text-ink-300">
          <span>{euro0(ad.spend)}</span>
          <span>{compact(ad.impressions)} impr</span>
          <span>{compact(ad.clicks)} clicks</span>
          <span>{pct(ad.ctr)} CTR</span>
          {ad.conversions > 0 ? (
            <span className="text-ink-400">{compact(ad.conversions)} {resultNoun.toLowerCase()}</span>
          ) : null}
          {ad.callToAction ? (
            <span className="rounded-pill text-ink-400" style={{ background: "#F9F9F4", padding: "1px 7px", border: "1px solid #E5E3DB" }}>
              {ad.callToAction}
            </span>
          ) : null}
        </div>
      </div>
    </div>
  );
}
