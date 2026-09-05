"use client";

import { useState } from "react";
import { LuCircleAlert, LuEye, LuGlobe, LuImage, LuMonitor, LuSmartphone, LuVideo } from "react-icons/lu";
import { SiFacebook, SiGoogle, SiInstagram, SiTiktok } from "react-icons/si";

import type { ContentAssetDto } from "@/lib/content/types";
import { CALL_TO_ACTION_LABEL, type PaidDraftFormValue } from "./paid-draft-form";
import {
  paidPreviewAds,
  paidPreviewDestination,
  paidPreviewMediaUrl,
  paidSearchPreview,
  selectedPaidPreview,
  type PaidPreviewSelection,
} from "./paid-draft-preview";

const focusRing = "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-plum";

function CreativeMedia({ asset, compact = false }: { asset: ContentAssetDto | undefined; compact?: boolean }) {
  const [failed, setFailed] = useState(false);
  const url = paidPreviewMediaUrl(asset?.contentUrl);
  const icon = asset?.kind === "video" ? LuVideo : LuImage;
  const Icon = failed ? LuCircleAlert : icon;
  if (!url || failed || (compact && asset?.kind === "video")) {
    return <div className="flex h-full w-full flex-col items-center justify-center gap-2 bg-track-1 p-2 text-ink-400">
      <Icon aria-hidden className={compact ? "h-4 w-4" : "h-7 w-7"} />
      {!compact ? <span role={failed ? "status" : undefined} className="text-center text-xs">{failed ? "Asset preview unavailable" : asset ? "Asset unavailable" : "No creative selected"}</span> : null}
    </div>;
  }
  return asset?.kind === "video" ? (
    <video src={url} controls muted playsInline preload="metadata" aria-label={asset.filename || "Selected ad video"} onError={() => setFailed(true)} className="h-full w-full object-contain" />
  ) : (
    // Private workspace assets must retain their authenticated content URL.
    // eslint-disable-next-line @next/next/no-img-element
    <img src={url} alt={compact ? "" : asset?.filename || "Selected ad creative"} loading={compact ? "lazy" : "eager"} onError={() => setFailed(true)} className="h-full w-full object-contain" />
  );
}

interface PaidDraftAdPreviewProps {
  value: PaidDraftFormValue;
  assets: ContentAssetDto[];
  selection: PaidPreviewSelection | null;
  onSelect: (selection: PaidPreviewSelection) => void;
  unsaved: boolean;
}

export function PaidDraftAdPreview({ value, assets, selection, onSelect, unsaved }: PaidDraftAdPreviewProps) {
  const [placement, setPlacement] = useState<"facebook" | "instagram">("facebook");
  const [device, setDevice] = useState<"mobile" | "desktop">("mobile");
  const selected = selectedPaidPreview(value, selection);
  const ads = paidPreviewAds(value);
  const google = value.connection.platform === "google_ads";
  const meta = value.connection.platform === "meta_ads";
  const instagram = meta && placement === "instagram";
  const pageName = value.metaDelivery?.pageName ?? value.connection.accountName;
  const ad = selected?.ad;
  const asset = google ? undefined : assets.find((item) => item.id === ad?.assetId);
  const destination = paidPreviewDestination(ad?.destinationUrl ?? "");
  const search = ad ? paidSearchPreview(ad) : null;

  return <aside aria-label="Live draft ad preview" className="min-w-0 [overflow-wrap:anywhere]">
    <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line-2 pb-3">
      <h3 className="m-0 flex items-center gap-2 text-[13px] font-semibold text-ink-800"><LuEye aria-hidden className="text-plum" /> Draft preview</h3>
      <span className={`inline-flex items-center gap-1.5 text-[10px] font-medium ${unsaved ? "text-plum" : "text-ink-400"}`}><span aria-hidden className={`h-1.5 w-1.5 rounded-full ${unsaved ? "bg-plum" : "bg-ink-300"}`} />{unsaved ? "Unsaved draft" : "Saved draft"}</span>
    </div>

    {ads.length > 1 ? <div role="group" aria-label="Ad preview selection" className="mt-3 grid max-h-[156px] grid-cols-2 gap-1.5 overflow-y-auto p-0.5">
      {ads.map((item) => {
        const active = selected?.groupId === item.groupId && selected.adId === item.adId;
        const thumbnail = assets.find((candidate) => candidate.id === item.ad.assetId);
        return <button type="button" key={`${item.groupId}:${item.adId}`} aria-pressed={active} aria-label={`Preview ${item.groupName}: ${item.adName}`} onClick={() => onSelect(item)} title={`${item.groupName}: ${item.adName}`} className={`flex min-w-0 items-center gap-2 rounded-[6px] border p-1.5 text-left ${active ? "border-plum-border bg-plum-soft text-plum-deep" : "border-line-2 bg-surface-card text-ink-600"} ${focusRing}`}>
          <span className="grid h-9 w-9 shrink-0 place-items-center overflow-hidden rounded-[3px] bg-track-1">{google ? <SiGoogle aria-hidden /> : <CreativeMedia key={`${thumbnail?.id}:${thumbnail?.contentUrl}`} asset={thumbnail} compact />}</span>
          <span className="min-w-0"><span className="block truncate text-[11px] font-semibold">{item.adName}</span><span className="block truncate text-[9px] opacity-70">{item.groupName}</span></span>
        </button>;
      })}
    </div> : null}

    <div className="my-3 flex flex-wrap items-center justify-between gap-2">
      {meta ? <div role="group" aria-label="Preview placement" className="inline-flex items-center gap-1 rounded-[6px] bg-track-1 p-1">
        {(["facebook", "instagram"] as const).map((item) => {
          const Icon = item === "facebook" ? SiFacebook : SiInstagram;
          return <button type="button" key={item} aria-pressed={placement === item} aria-label={`${item === "facebook" ? "Facebook" : "Instagram"} feed preview`} title={`${item === "facebook" ? "Facebook" : "Instagram"} feed preview`} onClick={() => setPlacement(item)} className={`grid h-7 w-8 place-items-center rounded-[4px] ${placement === item ? "bg-surface-card text-plum shadow-sm" : "text-ink-400"} ${focusRing}`}><Icon aria-hidden /></button>;
        })}
      </div> : <span className="inline-flex items-center gap-2 text-[11px] text-ink-500">{google ? <SiGoogle aria-hidden /> : <SiTiktok aria-hidden />}{google ? "Search" : "In-feed"}</span>}
      <div role="group" aria-label="Preview device" className="inline-flex gap-1">
        {(["mobile", "desktop"] as const).map((item) => {
          const Icon = item === "mobile" ? LuSmartphone : LuMonitor;
          return <button type="button" key={item} aria-pressed={device === item} aria-label={`${item === "mobile" ? "Mobile" : "Desktop"} ad preview`} title={`${item === "mobile" ? "Mobile" : "Desktop"} ad preview`} onClick={() => setDevice(item)} className={`grid h-8 w-8 place-items-center rounded-[5px] border ${device === item ? "border-plum-border bg-plum-soft text-plum" : "border-transparent text-ink-400"} ${focusRing}`}><Icon aria-hidden /></button>;
        })}
      </div>
    </div>

    <div className="border-y border-line-2 bg-track-1 px-2 py-5 sm:px-3">
      <article aria-label={google ? "Google responsive search draft preview" : `${meta ? instagram ? "Instagram" : "Facebook" : "Social"} draft preview`} data-preview-device={device} className={`mx-auto min-w-0 overflow-hidden rounded-[8px] border border-line-1 bg-surface-card shadow-sm ${device === "mobile" ? "max-w-[300px]" : "max-w-[500px]"}`}>
        {!ad ? <p className="p-5 text-center text-xs text-ink-400">No ad in this draft.</p> : google ? <div className="p-4">
          <div className="mb-4 flex items-center gap-2 border-b border-line-3 pb-3 text-xs text-ink-400"><SiGoogle aria-hidden className="text-ink-600" /> Sponsored</div>
          <div className="flex items-center gap-2"><span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-track-1"><LuGlobe aria-hidden className="h-4 w-4 text-ink-500" /></span><div className="min-w-0"><p className="m-0 text-[12px] font-medium text-ink-900">{destination.host}</p>{search?.path ? <p className="m-0 text-[10px] text-ink-500">{search.path}</p> : null}</div></div>
          <p className={`mb-2 mt-3 text-[18px] leading-snug ${search?.headlines.length ? "text-[#1a0dab]" : "text-ink-300"}`}>{search?.headlines.join(" | ") || "Your ad headlines"}</p>
          <p className={`m-0 whitespace-pre-wrap text-[12px] leading-relaxed ${search?.descriptions.length ? "text-ink-700" : "text-ink-300"}`}>{search?.descriptions.join(" ") || "Your ad descriptions"}</p>
        </div> : <>
          <div className="flex items-center gap-2.5 px-3 py-3"><span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-track-1 text-ink-400"><LuGlobe aria-hidden className="h-4 w-4" /></span><div className="min-w-0"><p className="m-0 text-[11px] font-semibold text-ink-800">{meta && !instagram ? pageName : instagram ? "Instagram identity pending" : "Advertiser identity pending"}</p><p className="m-0 text-[10px] text-ink-400">Sponsored{meta && !instagram && !value.metaDelivery ? " · Account name" : ""}</p></div></div>
          {!instagram ? <p className={`m-0 whitespace-pre-wrap px-3 pb-3 text-[12px] leading-relaxed ${ad.primaryText.trim() ? "text-ink-800" : "text-ink-300"}`}>{ad.primaryText || "Your primary text"}</p> : null}
          <div className="aspect-square w-full overflow-hidden bg-track-1"><CreativeMedia key={`${asset?.id}:${asset?.contentUrl}`} asset={asset} /></div>
          <div className="flex flex-wrap items-center justify-between gap-2 border-y border-line-2 bg-surface-panel px-3 py-3">
            <div className="min-w-0 flex-1 basis-[120px]"><span className={`block text-[9px] ${destination.valid ? "text-ink-400" : "text-neg-700"}`}>{destination.host}</span><p className={`mb-0 mt-1 text-[12px] font-semibold leading-snug ${ad.headline.trim() ? "text-ink-900" : "text-ink-300"}`}>{ad.headline || "Your headline"}</p>{ad.description && meta ? <p className="mb-0 mt-1 text-[10px] leading-relaxed text-ink-500">{ad.description}</p> : null}</div>
            <span aria-label={`Preview call to action: ${CALL_TO_ACTION_LABEL[ad.callToAction]}`} className="max-w-full rounded-[4px] border border-line-1 bg-surface-card px-2.5 py-2 text-center text-[10px] font-semibold text-ink-800">{CALL_TO_ACTION_LABEL[ad.callToAction]}</span>
          </div>
          {instagram ? <p className={`m-0 whitespace-pre-wrap px-3 py-3 text-[12px] leading-relaxed ${ad.primaryText.trim() ? "text-ink-800" : "text-ink-300"}`}>{ad.primaryText || "Your primary text"}</p> : null}
        </>}
      </article>
    </div>

    <div className="flex flex-wrap items-start justify-between gap-2 py-3 text-[10px] text-ink-400">
      <span>{google ? "Example RSA combination. Actual rendering varies." : "Placement illustration, not a delivery guarantee."}{meta && !value.metaDelivery && !instagram ? " Page identity pending." : ""}</span>
      {asset ? <span className="inline-flex items-center gap-1 font-mono">{asset.kind === "video" ? <LuVideo aria-hidden /> : <LuImage aria-hidden />}{asset.width && asset.height ? `${asset.width} × ${asset.height}` : asset.kind}</span> : null}
    </div>
    {selected ? <p className="m-0 text-[10px] text-ink-500">{selected.groupName}<span className="px-1.5 text-ink-300">/</span>{selected.adName}</p> : null}
  </aside>;
}
