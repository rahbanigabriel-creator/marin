"use client";

import { useState } from "react";
import { LuExternalLink, LuRefreshCw, LuShieldCheck, LuX } from "react-icons/lu";
import type { MetaPublishingAccess } from "@/lib/connectors/meta-publishing-access";
import { META_PAUSED_COUNTRIES } from "@/lib/paid-drafts/meta-paused-contract";
import type { MetaPausedDeliveryV1 } from "@/lib/paid-drafts/types";
import { splitLines, type PaidDraftFormValue } from "./paid-draft-form";

const focusRing = "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-plum";
const field = `min-h-9 w-full min-w-0 rounded-[7px] border border-line-1 bg-surface-card px-2.5 py-2 text-xs text-ink-800 disabled:opacity-50 ${focusRing}`;

export function MetaDeliverySettings({ value, disabled, onChange, onConnect }: { value: PaidDraftFormValue; disabled: boolean; onChange: (next: PaidDraftFormValue) => void; onConnect?: () => boolean }) {
  const [access, setAccess] = useState<MetaPublishingAccess | null>(null);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [broadAcknowledged, setBroadAcknowledged] = useState(true);
  const delivery = value.metaDelivery;
  const group = value.adGroups[0];
  const countries = group ? splitLines(group.locations) : [];
  const unresolved = countries.filter((country) => !Object.hasOwn(META_PAUSED_COUNTRIES, country));
  const broad = group?.languages.trim() === "All languages" && !group.interests.trim();
  const setDelivery = (next: Partial<MetaPausedDeliveryV1>) => {
    if (delivery) onChange({ ...value, metaDelivery: { ...delivery, ...next } });
  };
  const setCountries = (next: string[]) => onChange({ ...value, adGroups: value.adGroups.map((item, index) => index === 0 ? { ...item, locations: next.join("\n") } : item) });
  const checkAccess = async () => {
    if (disabled || checking) return;
    setChecking(true);
    setError(null);
    try {
      const response = await fetch(`/api/paid/connections/${encodeURIComponent(value.connection.id)}/meta-publishing`, { cache: "no-store", credentials: "same-origin" });
      const result = await response.json().catch(() => ({})) as MetaPublishingAccess & { message?: string };
      if (!response.ok) throw new Error(result.message || "Meta permissions could not be checked.");
      if (result.accountId !== value.connection.accountId.replace(/^act_/, "") || !Array.isArray(result.pages) || !result.permissions) throw new Error("Meta returned a different account or incomplete access details.");
      setAccess(result);
    } catch (failure) {
      setAccess(null);
      setError(failure instanceof Error ? failure.message : "Meta permissions could not be checked.");
    } finally { setChecking(false); }
  };
  const selectedPage = access?.pages.find((page) => page.id === delivery?.pageId);
  const allPermissions = access?.permissions.adsManagement && access.permissions.pagesShowList && access.permissions.pagesReadEngagement;

  return <fieldset className="mt-4 min-w-0 border-t border-line-2 pt-4" aria-label="Meta paused delivery settings">
    <label className="flex items-center gap-2.5 text-[12px] font-semibold text-ink-800"><input type="checkbox" checked={Boolean(delivery)} disabled={disabled} className="h-4 w-4 accent-plum" onChange={(event) => {
      if (event.target.checked) onChange({ ...value, metaDelivery: { version: 1, pageId: "", pageName: "", placement: "facebook_feed", specialAdCategory: "none", beneficiary: "", payer: "" }, metaCategoryConfirmed: false });
      else onChange({ ...value, metaDelivery: undefined, metaCategoryConfirmed: false });
    }} />Create through Marpin, in pause</label>
    {delivery ? <div className="mt-3 grid min-w-0 gap-3">
      <div className="flex flex-wrap items-center gap-2 text-[11px]"><span className="inline-flex items-center gap-1.5 text-plum"><LuShieldCheck aria-hidden />Facebook feed · traffic · 1 audience · 1–3 image ads</span><span className="text-ink-400">No activation included.</span></div>
      <div className="flex flex-wrap items-center gap-2"><button type="button" disabled={disabled || checking} onClick={() => void checkAccess()} className={`inline-flex min-h-8 items-center gap-1.5 rounded-[6px] border border-line-1 bg-surface-card px-2.5 text-[11px] font-semibold text-ink-600 disabled:opacity-50 ${focusRing}`}><LuRefreshCw aria-hidden className={checking ? "animate-spin" : ""} />{checking ? "Checking Meta…" : "Check Meta permissions"}</button>
        {/* OAuth requires full-document navigation without route prefetch; a new tab preserves this unsaved draft. */}
        <a href="/api/connect/meta_ads?intent=paid_write" target="_blank" rel="noreferrer" aria-disabled={disabled || undefined} onClick={(event) => { if (disabled || (onConnect && !onConnect())) event.preventDefault(); }} className={`inline-flex min-h-8 items-center gap-1.5 text-[11px] font-semibold text-plum ${focusRing}`}><LuExternalLink aria-hidden />Grant publishing permissions</a>
      </div>
      {error ? <p role="alert" className="m-0 border-l-2 border-neg-700 pl-2 text-[11px] text-neg-700">{error}</p> : null}
      {access ? <div role="status" className="grid gap-1 text-[11px] text-ink-500"><span>{access.canAdvertise && allPermissions ? "Account and publishing permissions available." : "Publishing permissions or ad-account access are incomplete."}</span><span>{access.currency} · {access.timezone}</span>{!access.pagesComplete ? <span className="text-[#745616]">The Page list is incomplete. Recheck permissions before selecting a Page.</span> : null}</div> : null}
      <label className="grid gap-1.5 text-[11px] font-semibold text-ink-500">Facebook Page<select aria-label="Facebook Page" value={delivery.pageId} disabled={disabled || checking} onChange={(event) => { const page = access?.pages.find((item) => item.id === event.target.value && item.canAdvertise); if (page) setDelivery({ pageId: page.id, pageName: page.name }); else if (!event.target.value) setDelivery({ pageId: "", pageName: "" }); }} className={field}><option value="">Select a Page after checking permissions</option>{delivery.pageId && !selectedPage ? <option value={delivery.pageId}>{delivery.pageName || delivery.pageId} · saved selection{access ? ", not in current list" : ""}</option> : null}{access?.pages.map((page) => <option key={page.id} value={page.id} disabled={!page.canAdvertise}>{page.name}{page.canAdvertise ? "" : " · advertising access unavailable"}</option>)}</select>{access && delivery.pageId && !selectedPage?.canAdvertise ? <span className="font-normal text-neg-700">Advertising access to this Page has not been confirmed.</span> : null}</label>
      <div className="grid gap-3 sm:grid-cols-2"><label className="grid gap-1.5 text-[11px] font-semibold text-ink-500">Beneficiary<input aria-label="Meta beneficiary" required maxLength={200} value={delivery.beneficiary} disabled={disabled} onChange={(event) => setDelivery({ beneficiary: event.target.value })} className={field} /></label><label className="grid gap-1.5 text-[11px] font-semibold text-ink-500">Payer<input aria-label="Meta payer" required maxLength={200} value={delivery.payer} disabled={disabled} onChange={(event) => setDelivery({ payer: event.target.value })} className={field} /></label></div>
      <fieldset className="min-w-0"><legend className="text-[11px] font-semibold text-ink-500">Audience 1 countries</legend><div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-2 sm:grid-cols-3">{Object.entries(META_PAUSED_COUNTRIES).map(([code, name]) => <label key={code} className="flex min-w-0 items-center gap-1.5 text-[11px] text-ink-600"><input type="checkbox" aria-label={`Target ${name}`} disabled={disabled || !group} checked={countries.includes(code)} className="accent-plum" onChange={(event) => setCountries(event.target.checked ? [...countries, code] : countries.filter((country) => country !== code))} /><span className="min-w-0">{name}</span></label>)}</div>{unresolved.length ? <div className="mt-2 text-[10px] text-[#745616]"><span>Unresolved locations:</span><div className="mt-1 flex flex-wrap gap-2">{unresolved.map((country) => <button type="button" key={country} disabled={disabled} title={`Remove unresolved location ${country}`} aria-label={`Remove unresolved location ${country}`} onClick={() => setCountries(countries.filter((item) => item !== country))} className={`inline-flex max-w-full items-center gap-1 border-0 bg-transparent p-0 text-left ${focusRing}`}><span className="min-w-0 break-words">{country}</span><LuX aria-hidden className="shrink-0" /></button>)}</div></div> : null}</fieldset>
      <label className="flex items-start gap-2 text-[11px] leading-relaxed text-ink-600"><input type="checkbox" aria-label="Apply broad audience targeting" checked={Boolean(broad && broadAcknowledged)} disabled={disabled || !group} className="mt-0.5 accent-plum" onChange={(event) => { setBroadAcknowledged(event.target.checked); if (event.target.checked) onChange({ ...value, adGroups: value.adGroups.map((item, index) => index === 0 ? { ...item, languages: "All languages", interests: "" } : item) }); }} /><span>Apply broad targeting: all languages, no interests. Age and gender stay unchanged.</span></label>
      <label className="flex items-start gap-2 text-[11px] leading-relaxed text-ink-600"><input type="checkbox" aria-label="No Meta Special Ad Category" checked={value.metaCategoryConfirmed === true} disabled={disabled} className="mt-0.5 accent-plum" onChange={(event) => onChange({ ...value, metaCategoryConfirmed: event.target.checked })} /><span>This campaign does not fall under a Meta Special Ad Category.</span></label>
    </div> : null}
  </fieldset>;
}
