"use client";

import { LuChevronLeft, LuChevronRight, LuExternalLink } from "react-icons/lu";
import type { PaidAd, PaidCampaign } from "./format";
import { PaidCreativeMedia } from "./PaidCreativeMedia";
import { paidMediaUrl, paidProviderHandoff } from "./paid-media";

const focusRing = "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-plum";

export function PaidCreativeInspection({ campaign, ad, onSelect }: {
  campaign: PaidCampaign;
  ad?: PaidAd;
  onSelect: (ad: PaidAd) => void;
}): React.JSX.Element {
  const index = campaign.ads.findIndex((item) => item.externalId === ad?.externalId);
  const handoff = paidProviderHandoff(campaign, ad);
  const destination = paidMediaUrl(ad?.linkUrl);
  return (
    <section aria-label="Creative inspection" className="min-w-0 border-b border-line-3 pb-5">
      {ad ? <>
        <div className="mb-3 flex min-w-0 items-center gap-2">
          <label className="flex min-w-0 flex-1 items-center gap-2 text-[11px] font-medium text-ink-600">
            <span>Creative</span>
            <select aria-label="Selected creative" value={ad.externalId} onChange={(event) => {
              const next = campaign.ads.find((item) => item.externalId === event.target.value);
              if (next) onSelect(next);
            }} className={`min-w-0 flex-1 rounded-[4px] border border-line-3 bg-white p-2 ${focusRing}`}>
              {campaign.ads.map((item, itemIndex) => <option key={`${item.externalId}:${itemIndex}`} value={item.externalId}>{itemIndex + 1}. {item.name}</option>)}
            </select>
          </label>
          {([
            { step: -1, label: "Previous creative", Icon: LuChevronLeft, disabled: index <= 0 },
            { step: 1, label: "Next creative", Icon: LuChevronRight, disabled: index >= campaign.ads.length - 1 },
          ]).map(({ step, label, Icon, disabled }) => <button key={label} type="button" aria-label={label} title={label} disabled={disabled} onClick={() => onSelect(campaign.ads[index + step])} className={`flex h-9 w-9 flex-none items-center justify-center rounded-[4px] border border-line-3 bg-white text-ink-600 disabled:opacity-40 ${focusRing}`}><Icon size={16} aria-hidden /></button>)}
        </div>
        <div className="grid min-w-0 gap-4 md:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
          <div className="min-w-0">
            <div className="h-[320px] overflow-hidden sm:h-[420px]">
              <PaidCreativeMedia src={ad.thumbnailUrl} alt={ad.title ?? ad.name} inspection />
            </div>
            <p className="mt-2 text-[11px] text-ink-400">{ad.creativeType === "video" ? "Video poster only. Playback is not supplied." : "Source preview"}</p>
          </div>
          <div className="min-w-0 break-words">
            <h2 className="text-[16px] font-semibold text-ink-900">{ad.name}</h2>
            {ad.status ? <p className="mt-1 text-[11px] text-ink-400">{ad.status}</p> : null}
            {ad.title ? <h3 className="mt-4 text-[14px] font-medium text-ink-800">{ad.title}</h3> : null}
            {ad.body ? <p className="mt-2 whitespace-pre-wrap text-[13px] leading-relaxed text-ink-600">{ad.body}</p> : null}
            {ad.callToAction ? <p className="mt-3 text-[11px] text-ink-600">{ad.callToAction}</p> : null}
            {destination ? <a href={destination} target="_blank" rel="noopener noreferrer" className={`mt-3 inline-flex max-w-full items-start gap-1.5 break-all text-[11px] text-plum ${focusRing}`}><LuExternalLink className="mt-0.5 flex-none" aria-hidden /><span>{destination}</span></a> : null}
          </div>
        </div>
      </> : <p className="py-3 text-[12px] text-ink-400">No ad-level creative supplied. Campaign analytics remain available below.</p>}
      <div className="mt-4 min-w-0 border-t border-line-3 pt-3">
        {handoff ? <>
          <a href={handoff.href} target="_blank" rel="noopener noreferrer" className={`inline-flex max-w-full items-center gap-2 text-[12px] font-semibold text-plum ${focusRing}`}><LuExternalLink className="flex-none" aria-hidden /><span>{handoff.label}</span></a>
          <p className="mt-1 break-words text-[11px] leading-relaxed text-ink-400">{handoff.detail}</p>
        </> : <p className="text-[11px] text-ink-400">Provider editing link unavailable: a supported account and valid campaign ID are required.</p>}
      </div>
    </section>
  );
}
