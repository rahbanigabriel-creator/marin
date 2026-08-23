"use client";

import type { ChangeEvent } from "react";
import {
  LuCheck,
  LuPlus,
  LuSave,
  LuTrash2,
  LuUpload,
} from "react-icons/lu";

import type { ContentAssetDto } from "@/lib/content/types";
import type { PaidLaunchTemplate, SocialGender } from "@/lib/paid-drafts/types";

import {
  CALL_TO_ACTION_LABEL,
  CALL_TO_ACTIONS,
  PLATFORM_LABEL,
  TEMPLATE_LABEL,
  assetOptionsForPlatform,
  createPaidDraftAd,
  createPaidDraftAdGroup,
  templatesForPlatform,
  type PaidConnectionOption,
  type PaidDraftAdForm,
  type PaidDraftAdGroupForm,
  type PaidDraftFormIssue,
  type PaidDraftFormValue,
} from "./paid-draft-form";

const focusRing = "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-plum";
const field = `w-full min-w-0 rounded-[7px] border border-line-1 bg-surface-card px-[10px] py-[8px] text-[13px] text-ink-900 outline-none focus:border-plum-border disabled:cursor-not-allowed disabled:bg-track-1 disabled:text-ink-400 ${focusRing}`;
const label = "text-[11px] font-semibold text-ink-500";

interface PaidDraftEditorProps {
  value: PaidDraftFormValue;
  connections: PaidConnectionOption[];
  assets: ContentAssetDto[];
  issues: PaidDraftFormIssue[];
  isNew: boolean;
  disabled: boolean;
  saving: boolean;
  uploading: boolean;
  dirty: boolean;
  onChange: (value: PaidDraftFormValue) => void;
  onConnectionChange: (connectionId: string) => void;
  onTemplateChange: (template: PaidLaunchTemplate) => void;
  onSave: () => void;
  onReady: () => void;
  canMarkReady: boolean;
  onUpload: (file: File) => void;
}

function ErrorText({ issues, path }: { issues: PaidDraftFormIssue[]; path: string }) {
  const issue = issues.find((item) => item.path === path || item.path.startsWith(`${path}.`));
  return issue ? <span className="text-[11px] text-neg-700">{issue.message}</span> : null;
}

function updateAt<T>(items: readonly T[], index: number, value: T): T[] {
  return items.map((item, itemIndex) => itemIndex === index ? value : item);
}

function removeAt<T>(items: readonly T[], index: number): T[] {
  return items.filter((_, itemIndex) => itemIndex !== index);
}

export function PaidDraftEditor({
  value,
  connections,
  assets,
  issues,
  isNew,
  disabled,
  saving,
  uploading,
  dirty,
  onChange,
  onConnectionChange,
  onTemplateChange,
  onSave,
  onReady,
  canMarkReady,
  onUpload,
}: PaidDraftEditorProps): React.JSX.Element {
  const social = value.connection.platform !== "google_ads";
  const assetOptions = assetOptionsForPlatform(assets, value.connection.platform);
  const set = <K extends keyof PaidDraftFormValue>(key: K, next: PaidDraftFormValue[K]) => {
    onChange({ ...value, [key]: next });
  };
  const setGroup = (index: number, group: PaidDraftAdGroupForm) => {
    set("adGroups", updateAt(value.adGroups, index, group));
  };
  const setAd = (groupIndex: number, adIndex: number, ad: PaidDraftAdForm) => {
    const group = value.adGroups[groupIndex];
    setGroup(groupIndex, { ...group, ads: updateAt(group.ads, adIndex, ad) });
  };

  return (
    <form
      aria-label={isNew ? "New paid campaign draft" : `Edit ${value.campaignName || "paid campaign draft"}`}
      onSubmit={(event) => { event.preventDefault(); onSave(); }}
      className="mx-auto w-full max-w-[980px]"
    >
      <div className="flex flex-wrap items-start justify-between gap-[12px] border-b border-line-2 pb-[16px]">
        <div>
          <p className="m-0 font-mono text-[9.5px] font-semibold uppercase tracking-[0.08em] text-ink-300">Manual campaign builder</p>
          <h2 className="mb-0 mt-[3px] text-[20px] font-semibold text-ink-900">
            {isNew ? "New paid campaign" : value.campaignName || "Untitled campaign"}
          </h2>
          <p className="mb-0 mt-[4px] text-[11.5px] text-ink-400">Saved drafts create no ads and spend no budget.</p>
        </div>
        <div className="flex flex-wrap items-center gap-[7px]">
          <button
            type="submit"
            disabled={disabled || saving || (!isNew && !dirty)}
            className={`inline-flex h-[36px] items-center gap-[6px] rounded-[7px] bg-ink-900 px-[12px] text-[12px] font-semibold text-white disabled:cursor-not-allowed disabled:opacity-45 ${focusRing}`}
          >
            <LuSave aria-hidden /> {saving ? "Saving…" : isNew ? "Create draft" : "Save changes"}
          </button>
          {!isNew ? (
            <button
              type="button"
              disabled={!canMarkReady || dirty || saving}
              title={dirty ? "Save changes before marking this version ready" : undefined}
              onClick={onReady}
              className={`inline-flex h-[36px] items-center gap-[6px] rounded-[7px] border border-pos-500 bg-pos-bg px-[12px] text-[12px] font-semibold text-pos-700 disabled:cursor-not-allowed disabled:opacity-45 ${focusRing}`}
            >
              <LuCheck aria-hidden /> Mark ready
            </button>
          ) : null}
        </div>
      </div>

      {issues.length ? (
        <div role="alert" className="mt-[12px] border-l-[3px] border-neg-700 bg-neg-bg px-[12px] py-[10px] text-[12px] text-neg-700">
          <p className="m-0 font-semibold">Resolve {issues.length} validation {issues.length === 1 ? "issue" : "issues"} before saving.</p>
          <ul className="mb-0 mt-[5px] list-disc pl-[18px]">
            {issues.slice(0, 8).map((issue, index) => <li key={`${issue.path}-${index}`}>{issue.message}</li>)}
          </ul>
        </div>
      ) : null}

      <section className="border-b border-line-2 py-[18px]" aria-labelledby="paid-draft-setup-title">
        <h3 id="paid-draft-setup-title" className="m-0 text-[14px] font-semibold text-ink-900">Campaign setup</h3>
        <div className="mt-[12px] grid gap-[12px] md:grid-cols-2">
          <label className="grid gap-[5px]">
            <span className={label}>Connected paid account</span>
            <select
              aria-label="Connected paid account"
              disabled={disabled || !isNew}
              value={value.connection.id}
              onChange={(event) => onConnectionChange(event.target.value)}
              className={field}
            >
              {connections.map((connection) => (
                <option key={connection.id} value={connection.id}>
                  {PLATFORM_LABEL[connection.platform]} · {connection.accountName}
                </option>
              ))}
            </select>
            <span className="font-mono text-[10px] text-ink-300">Account {value.connection.accountId}</span>
          </label>
          <label className="grid gap-[5px]">
            <span className={label}>Campaign type</span>
            <select
              aria-label="Campaign type"
              disabled={disabled || !isNew}
              value={value.template}
              onChange={(event) => onTemplateChange(event.target.value as PaidLaunchTemplate)}
              className={field}
            >
              {templatesForPlatform(value.connection.platform).map((template) => (
                <option key={template} value={template}>{TEMPLATE_LABEL[template]}</option>
              ))}
            </select>
          </label>
          <label className="grid gap-[5px] md:col-span-2">
            <span className={label}>Campaign name</span>
            <input
              aria-label="Campaign name"
              maxLength={160}
              disabled={disabled}
              value={value.campaignName}
              onChange={(event) => set("campaignName", event.target.value)}
              className={field}
            />
            <ErrorText issues={issues} path="campaign.name" />
          </label>
        </div>
      </section>

      <section className="border-b border-line-2 py-[18px]" aria-labelledby="paid-draft-budget-title">
        <h3 id="paid-draft-budget-title" className="m-0 text-[14px] font-semibold text-ink-900">Budget and schedule</h3>
        <div className="mt-[12px] grid gap-[12px] sm:grid-cols-2 lg:grid-cols-4">
          <label className="grid gap-[5px]"><span className={label}>Budget</span><input aria-label="Budget" inputMode="decimal" placeholder="50.00" disabled={disabled} value={value.budgetMajor} onChange={(event) => set("budgetMajor", event.target.value)} className={field} /><ErrorText issues={issues} path="budget.amountMinor" /></label>
          <label className="grid gap-[5px]"><span className={label}>Currency</span><input aria-label="Currency" maxLength={3} placeholder="EUR" disabled={disabled} value={value.currency} onChange={(event) => set("currency", event.target.value.toUpperCase())} className={field} /><ErrorText issues={issues} path="budget.currency" /></label>
          <label className="grid gap-[5px]"><span className={label}>Budget cadence</span><select aria-label="Budget cadence" disabled={disabled} value={value.cadence} onChange={(event) => set("cadence", event.target.value as "daily" | "lifetime")} className={field}><option value="daily">Daily</option><option value="lifetime">Lifetime</option></select></label>
          <label className="grid gap-[5px]"><span className={label}>Timezone</span><input aria-label="Timezone" disabled={disabled} value={value.timezone} onChange={(event) => set("timezone", event.target.value)} className={field} /><ErrorText issues={issues} path="schedule.timezone" /></label>
          <label className="grid gap-[5px]"><span className={label}>Start date</span><input aria-label="Start date" type="date" disabled={disabled} value={value.startsDate} onChange={(event) => set("startsDate", event.target.value)} className={field} /></label>
          <label className="grid gap-[5px]"><span className={label}>Start time</span><input aria-label="Start time" type="time" disabled={disabled} value={value.startsTime} onChange={(event) => set("startsTime", event.target.value)} className={field} /></label>
          <label className="grid gap-[5px]"><span className={label}>End date</span><input aria-label="End date" type="date" disabled={disabled} value={value.endsDate} onChange={(event) => set("endsDate", event.target.value)} className={field} /></label>
          <label className="grid gap-[5px]"><span className={label}>End time</span><input aria-label="End time" type="time" disabled={disabled} value={value.endsTime} onChange={(event) => set("endsTime", event.target.value)} className={field} /><ErrorText issues={issues} path="schedule.endsAt" /></label>
        </div>
      </section>

      <section className="border-b border-line-2 py-[18px]" aria-labelledby="paid-draft-assumptions-title">
        <h3 id="paid-draft-assumptions-title" className="m-0 text-[14px] font-semibold text-ink-900">Assumptions</h3>
        <label className="mt-[10px] grid gap-[5px]"><span className={label}>One assumption per line</span><textarea aria-label="Assumptions" rows={3} maxLength={6000} disabled={disabled} value={value.assumptions} onChange={(event) => set("assumptions", event.target.value)} className={`${field} resize-y leading-[1.5]`} /></label>
      </section>

      <section className="py-[18px]" aria-labelledby="paid-draft-groups-title">
        <div className="flex flex-wrap items-center justify-between gap-[8px]">
          <div><h3 id="paid-draft-groups-title" className="m-0 text-[14px] font-semibold text-ink-900">Ad groups and ads</h3><p className="mb-0 mt-[2px] text-[11px] text-ink-400">Every group and ad is included in the versioned approval snapshot.</p></div>
          <button type="button" disabled={disabled || value.adGroups.length >= 20} onClick={() => set("adGroups", [...value.adGroups, createPaidDraftAdGroup()])} className={`inline-flex h-[34px] items-center gap-[6px] rounded-[7px] border border-line-1 bg-surface-card px-[10px] text-[11.5px] font-semibold text-ink-700 disabled:opacity-45 ${focusRing}`}><LuPlus aria-hidden /> Add ad group</button>
        </div>

        <div className="mt-[8px]">
          {value.adGroups.map((group, groupIndex) => {
            const groupPrefix = `adGroups[${groupIndex}]`;
            return (
              <section key={group.localId} className="border-t border-line-2 py-[16px]" aria-labelledby={`group-title-${group.localId}`}>
                <div className="flex items-center justify-between gap-[8px]">
                  <h4 id={`group-title-${group.localId}`} className="m-0 text-[13px] font-semibold text-ink-800">Ad group {groupIndex + 1}</h4>
                  <button type="button" aria-label={`Remove ad group ${groupIndex + 1}`} disabled={disabled || value.adGroups.length === 1} onClick={() => set("adGroups", removeAt(value.adGroups, groupIndex))} className={`grid h-[32px] w-[32px] place-items-center rounded-[6px] border border-line-2 bg-transparent text-ink-400 disabled:opacity-35 ${focusRing}`}><LuTrash2 aria-hidden /></button>
                </div>
                <div className="mt-[10px] grid gap-[11px] md:grid-cols-2">
                  <label className="grid gap-[5px] md:col-span-2"><span className={label}>Ad group name</span><input aria-label={`Ad group ${groupIndex + 1} name`} maxLength={128} disabled={disabled} value={group.name} onChange={(event) => setGroup(groupIndex, { ...group, name: event.target.value })} className={field} /><ErrorText issues={issues} path={`${groupPrefix}.name`} /></label>
                  <label className="grid gap-[5px]"><span className={label}>Locations · one per line</span><textarea aria-label={`Ad group ${groupIndex + 1} locations`} rows={3} disabled={disabled} value={group.locations} onChange={(event) => setGroup(groupIndex, { ...group, locations: event.target.value })} className={`${field} resize-y`} /><ErrorText issues={issues} path={`${groupPrefix}.targeting.locations`} /></label>
                  <label className="grid gap-[5px]"><span className={label}>Languages · one per line</span><textarea aria-label={`Ad group ${groupIndex + 1} languages`} rows={3} disabled={disabled} value={group.languages} onChange={(event) => setGroup(groupIndex, { ...group, languages: event.target.value })} className={`${field} resize-y`} /><ErrorText issues={issues} path={`${groupPrefix}.targeting.languages`} /></label>

                  {!social ? (
                    <>
                      <label className="grid gap-[5px]"><span className={label}>Keywords · broad:, phrase:, or exact:</span><textarea aria-label={`Ad group ${groupIndex + 1} keywords`} rows={5} disabled={disabled} value={group.keywords} onChange={(event) => setGroup(groupIndex, { ...group, keywords: event.target.value })} className={`${field} resize-y font-mono text-[12px]`} /><ErrorText issues={issues} path={`${groupPrefix}.targeting.keywords`} /></label>
                      <label className="grid gap-[5px]"><span className={label}>Negative keywords · one per line</span><textarea aria-label={`Ad group ${groupIndex + 1} negative keywords`} rows={5} disabled={disabled} value={group.negativeKeywords} onChange={(event) => setGroup(groupIndex, { ...group, negativeKeywords: event.target.value })} className={`${field} resize-y`} /></label>
                    </>
                  ) : (
                    <>
                      <div className="grid grid-cols-2 gap-[10px]"><label className="grid gap-[5px]"><span className={label}>Minimum age</span><input aria-label={`Ad group ${groupIndex + 1} minimum age`} type="number" min={13} max={65} disabled={disabled} value={group.ageMin} onChange={(event) => setGroup(groupIndex, { ...group, ageMin: event.target.value })} className={field} /></label><label className="grid gap-[5px]"><span className={label}>Maximum age</span><input aria-label={`Ad group ${groupIndex + 1} maximum age`} type="number" min={13} max={65} disabled={disabled} value={group.ageMax} onChange={(event) => setGroup(groupIndex, { ...group, ageMax: event.target.value })} className={field} /></label></div>
                      <fieldset className="min-w-0"><legend className={label}>Gender</legend><div className="mt-[7px] flex flex-wrap gap-[12px]">{(["all", "female", "male"] as SocialGender[]).map((gender) => <label key={gender} className="flex items-center gap-[5px] text-[12px] capitalize text-ink-600"><input type="checkbox" disabled={disabled} checked={group.genders.includes(gender)} onChange={() => { const next = gender === "all" ? ["all" as const] : group.genders.includes(gender) ? group.genders.filter((item) => item !== gender) : [...group.genders.filter((item) => item !== "all"), gender]; setGroup(groupIndex, { ...group, genders: next.length ? next : ["all"] }); }} />{gender}</label>)}</div></fieldset>
                      <label className="grid gap-[5px] md:col-span-2"><span className={label}>Interests · one per line</span><textarea aria-label={`Ad group ${groupIndex + 1} interests`} rows={3} disabled={disabled} value={group.interests} onChange={(event) => setGroup(groupIndex, { ...group, interests: event.target.value })} className={`${field} resize-y`} /></label>
                    </>
                  )}
                </div>

                <div className="mt-[15px] border-l-2 border-line-2 pl-[12px] sm:pl-[16px]">
                  <div className="flex items-center justify-between gap-[8px]"><h5 className="m-0 text-[12px] font-semibold text-ink-700">Ads</h5><button type="button" disabled={disabled || group.ads.length >= 20} onClick={() => setGroup(groupIndex, { ...group, ads: [...group.ads, createPaidDraftAd()] })} className={`inline-flex h-[31px] items-center gap-[5px] rounded-[6px] border border-line-2 bg-transparent px-[9px] text-[11px] font-semibold text-ink-600 disabled:opacity-45 ${focusRing}`}><LuPlus aria-hidden /> Add ad</button></div>
                  {group.ads.map((ad, adIndex) => {
                    const adPrefix = `${groupPrefix}.ads[${adIndex}]`;
                    return (
                      <div key={ad.localId} className="border-b border-line-3 py-[14px] last:border-b-0">
                        <div className="flex items-center justify-between gap-[8px]"><span className="font-mono text-[9.5px] font-semibold uppercase tracking-[0.08em] text-ink-300">Ad {adIndex + 1}</span><button type="button" aria-label={`Remove ad ${adIndex + 1} from ad group ${groupIndex + 1}`} disabled={disabled || group.ads.length === 1} onClick={() => setGroup(groupIndex, { ...group, ads: removeAt(group.ads, adIndex) })} className={`grid h-[30px] w-[30px] place-items-center rounded-[6px] border-0 bg-transparent text-ink-400 disabled:opacity-35 ${focusRing}`}><LuTrash2 aria-hidden /></button></div>
                        <div className="mt-[8px] grid gap-[11px] md:grid-cols-2">
                          <label className="grid gap-[5px] md:col-span-2"><span className={label}>Ad name</span><input aria-label={`Ad group ${groupIndex + 1} ad ${adIndex + 1} name`} maxLength={128} disabled={disabled} value={ad.name} onChange={(event) => setAd(groupIndex, adIndex, { ...ad, name: event.target.value })} className={field} /><ErrorText issues={issues} path={`${adPrefix}.name`} /></label>
                          {!social ? (
                            <>
                              <label className="grid gap-[5px]"><span className={label}>Headlines · 3–15, one per line</span><textarea aria-label={`Ad group ${groupIndex + 1} ad ${adIndex + 1} headlines`} rows={6} disabled={disabled} value={ad.headlines} onChange={(event) => setAd(groupIndex, adIndex, { ...ad, headlines: event.target.value })} className={`${field} resize-y`} /><ErrorText issues={issues} path={`${adPrefix}.headlines`} /></label>
                              <label className="grid gap-[5px]"><span className={label}>Descriptions · 2–4, one per line</span><textarea aria-label={`Ad group ${groupIndex + 1} ad ${adIndex + 1} descriptions`} rows={6} disabled={disabled} value={ad.descriptions} onChange={(event) => setAd(groupIndex, adIndex, { ...ad, descriptions: event.target.value })} className={`${field} resize-y`} /><ErrorText issues={issues} path={`${adPrefix}.descriptions`} /></label>
                              <label className="grid gap-[5px]"><span className={label}>Display path 1</span><input aria-label={`Ad group ${groupIndex + 1} ad ${adIndex + 1} path 1`} maxLength={15} disabled={disabled} value={ad.path1} onChange={(event) => setAd(groupIndex, adIndex, { ...ad, path1: event.target.value })} className={field} /></label>
                              <label className="grid gap-[5px]"><span className={label}>Display path 2</span><input aria-label={`Ad group ${groupIndex + 1} ad ${adIndex + 1} path 2`} maxLength={15} disabled={disabled} value={ad.path2} onChange={(event) => setAd(groupIndex, adIndex, { ...ad, path2: event.target.value })} className={field} /></label>
                            </>
                          ) : (
                            <>
                              <label className="grid gap-[5px] md:col-span-2"><span className={label}>Creative asset</span><div className="flex min-w-0 flex-col gap-[7px] sm:flex-row"><select aria-label={`Ad group ${groupIndex + 1} ad ${adIndex + 1} creative asset`} disabled={disabled} value={ad.assetId} onChange={(event) => { const asset = assets.find((item) => item.id === event.target.value); setAd(groupIndex, adIndex, { ...ad, assetId: event.target.value, format: asset?.kind === "video" ? "video" : "image" }); }} className={field}><option value="">Select an asset</option>{assetOptions.map((asset) => <option key={asset.id} value={asset.id}>{asset.filename || `${asset.kind} asset`} · {asset.kind}</option>)}</select><label className={`inline-flex h-[36px] flex-none cursor-pointer items-center justify-center gap-[6px] rounded-[7px] border border-line-1 bg-surface-card px-[10px] text-[11.5px] font-semibold text-ink-700 ${focusRing}`}><LuUpload aria-hidden /> {uploading ? "Uploading…" : "Upload"}<input aria-label="Upload creative asset" type="file" accept={value.connection.platform === "tiktok_ads" ? "video/*" : "image/*,video/*"} disabled={disabled || uploading} className="sr-only" onChange={(event: ChangeEvent<HTMLInputElement>) => { const file = event.target.files?.[0]; if (file) onUpload(file); event.target.value = ""; }} /></label></div>{value.connection.platform === "tiktok_ads" && !assetOptions.length ? <span className="text-[11px] text-ink-400">TikTok drafts require one video from the shared asset library.</span> : null}<ErrorText issues={issues} path={`${adPrefix}.assetIds`} /></label>
                              <label className="grid gap-[5px] md:col-span-2"><span className={label}>Primary text</span><textarea aria-label={`Ad group ${groupIndex + 1} ad ${adIndex + 1} primary text`} rows={4} disabled={disabled} value={ad.primaryText} onChange={(event) => setAd(groupIndex, adIndex, { ...ad, primaryText: event.target.value })} className={`${field} resize-y`} /></label>
                              <label className="grid gap-[5px]"><span className={label}>Headline</span><input aria-label={`Ad group ${groupIndex + 1} ad ${adIndex + 1} headline`} disabled={disabled} value={ad.headline} onChange={(event) => setAd(groupIndex, adIndex, { ...ad, headline: event.target.value })} className={field} /></label>
                              {value.connection.platform === "meta_ads" ? <label className="grid gap-[5px]"><span className={label}>Description</span><input aria-label={`Ad group ${groupIndex + 1} ad ${adIndex + 1} description`} disabled={disabled} value={ad.description} onChange={(event) => setAd(groupIndex, adIndex, { ...ad, description: event.target.value })} className={field} /></label> : null}
                              <label className="grid gap-[5px]"><span className={label}>Call to action</span><select aria-label={`Ad group ${groupIndex + 1} ad ${adIndex + 1} call to action`} disabled={disabled} value={ad.callToAction} onChange={(event) => setAd(groupIndex, adIndex, { ...ad, callToAction: event.target.value as PaidDraftAdForm["callToAction"] })} className={field}>{CALL_TO_ACTIONS.map((cta) => <option key={cta} value={cta}>{CALL_TO_ACTION_LABEL[cta]}</option>)}</select></label>
                            </>
                          )}
                          <label className={`grid gap-[5px] ${social ? "" : "md:col-span-2"}`}><span className={label}>Destination URL</span><input aria-label={`Ad group ${groupIndex + 1} ad ${adIndex + 1} destination URL`} type="url" placeholder="https://example.com/offer" disabled={disabled} value={ad.destinationUrl} onChange={(event) => setAd(groupIndex, adIndex, { ...ad, destinationUrl: event.target.value })} className={field} /><ErrorText issues={issues} path={`${adPrefix}.destinationUrl`} /></label>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </section>
            );
          })}
        </div>
      </section>
    </form>
  );
}
