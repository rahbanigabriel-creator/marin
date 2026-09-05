"use client";

import { useState } from "react";
import { LuArrowUpRight, LuImage, LuLayers, LuVideo } from "react-icons/lu";
import { PlatformMark, campaignStatus } from "./PaidOverview";
import { metricIsUnavailable, money2, pct, type PaidCampaign } from "./format";

function CampaignCreative({ campaign, onSelect }: { campaign: PaidCampaign; onSelect: (campaign: PaidCampaign) => void }): React.JSX.Element {
  const [failedImage, setFailedImage] = useState<string | null>(null);
  const [selectedAdId, setSelectedAdId] = useState<string | null>(null);
  const ad = campaign.ads.find((item) => item.externalId === selectedAdId)
    ?? campaign.ads.find((item) => !!item.thumbnailUrl)
    ?? campaign.ads[0];
  const thumbnail = ad?.thumbnailUrl;
  const previewAvailable = thumbnail && thumbnail !== failedImage;
  const status = campaignStatus(campaign.status);
  return (
    <article className="group min-w-0 overflow-hidden rounded-[8px] border border-line-3 bg-white" aria-label={`${campaign.campaign}, ${campaign.accountName}`}>
      <div className="flex items-center gap-2 px-3.5 py-3"><PlatformMark platform={campaign.platform} /><span className="min-w-0 flex-1 truncate text-[11px] font-medium text-ink-600">{campaign.accountName}</span><span className={`flex items-center gap-1.5 text-[10px] ${status === "active" ? "text-pos-500" : "text-ink-400"}`}><i className={`h-1.5 w-1.5 rounded-full ${status === "active" ? "bg-pos-500" : "bg-ink-300/50"}`} />{status === "other" ? campaign.status ?? "Unknown" : status}</span></div>
      <button type="button" onClick={() => onSelect(campaign)} aria-label={`Open creative details for ${campaign.campaign} in ${campaign.accountName}`} className="relative block aspect-[4/3] w-full overflow-hidden border-y border-line-3 bg-surface-panel focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-plum">
        {previewAvailable ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={thumbnail} alt={ad.title ?? ad.name} loading="lazy" referrerPolicy="no-referrer" onError={() => setFailedImage(thumbnail)} className="h-full w-full object-contain transition-transform duration-300 motion-safe:group-hover:scale-[1.025]" />
        ) : <div className="flex h-full flex-col items-center justify-center gap-3 px-5 text-ink-300"><LuImage size={26} strokeWidth={1} aria-hidden /><span className="text-[11px]">{thumbnail ? "Preview unavailable" : "No preview supplied"}</span>{ad?.title ? <span className="line-clamp-2 max-w-full text-[15px] font-medium text-ink-600">{ad.title}</span> : null}</div>}
        <span className="absolute bottom-2.5 left-2.5 inline-flex items-center gap-1.5 rounded-[4px] bg-white/95 px-2 py-1 text-[10px] font-medium text-ink-800">{ad?.creativeType === "video" ? <LuVideo size={12} aria-hidden /> : <LuLayers size={12} aria-hidden />}{ad?.creativeType ?? "Creative"}</span>
        <span className="absolute right-2.5 top-2.5 flex h-7 w-7 items-center justify-center rounded-full bg-white/95 text-ink-800"><LuArrowUpRight size={15} aria-hidden /></span>
      </button>
      <div className="px-3.5 py-3">
        <button type="button" onClick={() => onSelect(campaign)} className="block w-full truncate text-left text-[13px] font-semibold text-ink-900 hover:text-plum" title={campaign.campaign}>{campaign.campaign}</button>
        <p className="mt-1 line-clamp-2 h-[34px] text-[11px] leading-[17px] text-ink-400">{ad?.body ?? ad?.title ?? campaign.objective ?? "Creative details not supplied by the source."}</p>
        <div className="mt-3 flex items-center justify-between gap-2 border-t border-line-3 pt-3">
          <div><p className="text-[9px] text-ink-400">Campaign spend</p><p className="mt-0.5 font-mono text-[12px] font-medium text-ink-900">{campaign.currencyUnsafe || metricIsUnavailable("spend", campaign.spend, campaign.currency) ? "Unavailable" : money2(campaign.spend, campaign.currency)}</p></div>
          <div className="text-right"><p className="text-[9px] text-ink-400">Campaign CTR</p><p className="mt-0.5 font-mono text-[12px] font-medium text-ink-900">{campaign.ctr == null ? "Unavailable" : pct(campaign.ctr)}</p></div>
        </div>
        {campaign.ads.length > 1 ? <label className="mt-3 flex items-center gap-2 text-[10px] text-ink-400"><span className="flex-none">Creative</span><select aria-label={`Preview creative for ${campaign.campaign} in ${campaign.accountName}`} value={ad?.externalId ?? ""} onChange={(event) => setSelectedAdId(event.target.value)} className="min-w-0 flex-1 rounded-[4px] border border-line-3 bg-white p-1 text-ink-600">{campaign.ads.map((item, index) => <option key={item.externalId ?? index} value={item.externalId}>{index + 1}. {item.name}</option>)}</select></label> : null}
      </div>
    </article>
  );
}

export function PaidCreativeGallery({ campaigns, onSelect }: { campaigns: PaidCampaign[]; onSelect: (campaign: PaidCampaign) => void }): React.JSX.Element {
  if (campaigns.length === 0) return <p role="status" className="border-y border-line-3 py-12 text-center text-[13px] text-ink-400">No campaigns match these filters.</p>;
  const ordered = [...campaigns].sort((a, b) => Number(b.ads.some((ad) => !!ad.thumbnailUrl)) - Number(a.ads.some((ad) => !!ad.thumbnailUrl)));
  return <div data-testid="paid-creative-gallery" className="grid grid-cols-1 gap-4 min-[520px]:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">{ordered.map((campaign) => <CampaignCreative key={campaign.identity} campaign={campaign} onSelect={onSelect} />)}</div>;
}
