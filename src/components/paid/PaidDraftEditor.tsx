"use client";

import { useEffect, useState, type ChangeEvent, type ReactNode } from "react";
import {
  LuCalendarDays,
  LuCheck,
  LuEye,
  LuEyeOff,
  LuFileText,
  LuLayers,
  LuMegaphone,
  LuPlus,
  LuSave,
  LuSlidersHorizontal,
  LuTrash2,
  LuUpload,
} from "react-icons/lu";

import type { ContentAssetDto } from "@/lib/content/types";
import type { PaidLaunchTemplate, SocialGender } from "@/lib/paid-drafts/types";
import { PaidDraftAdPreview } from "./PaidDraftAdPreview";
import { selectedPaidPreview, type PaidPreviewSelection } from "./paid-draft-preview";

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
const field = `w-full min-h-[36px] min-w-0 rounded-[7px] border border-line-1 bg-surface-card px-[10px] py-[8px] text-[13px] text-ink-900 outline-none focus:border-plum-border disabled:cursor-not-allowed disabled:bg-track-1 disabled:text-ink-400 ${focusRing}`;
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
  deliverySettings?: ReactNode;
}

function ErrorText({ issues, path }: { issues: PaidDraftFormIssue[]; path: string }) {
  const issue = issues.find((item) => item.path === path || item.path.startsWith(`${path}.`));
  return issue ? <span className="text-[11px] text-neg-700">{issue.message}</span> : null;
}

function SectionHeading({ id, icon, children }: { id: string; icon: ReactNode; children: ReactNode }) {
  return <h3 id={id} className="m-0 flex items-center gap-2.5 text-[14px] font-semibold text-ink-900"><span className="grid h-8 w-8 shrink-0 place-items-center rounded-[6px] bg-plum-soft text-plum" aria-hidden>{icon}</span>{children}</h3>;
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
  deliverySettings,
}: PaidDraftEditorProps): React.JSX.Element {
  const [selection, setSelection] = useState<PaidPreviewSelection | null>(null);
  const [previewOpen, setPreviewOpen] = useState(true);
  useEffect(() => {
    if (window.matchMedia("(max-width: 767px)").matches) setPreviewOpen(false);
  }, []);
  const selected = selectedPaidPreview(value, selection);
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
  const showAdPreview = (next: PaidPreviewSelection) => {
    setSelection(next);
    setPreviewOpen(true);
    requestAnimationFrame(() => {
      const preview = document.getElementById("paid-draft-preview");
      if (preview && (preview.closest("form")?.clientWidth ?? 0) < 850) {
        preview.scrollIntoView({ block: "start", behavior: "smooth" });
      }
    });
  };

  return (
    <form
      aria-label={isNew ? "New paid campaign draft" : `Edit ${value.campaignName || "paid campaign draft"}`}
      onSubmit={(event) => { event.preventDefault(); onSave(); }}
      className="mx-auto w-full min-w-0 max-w-[1240px] [container-type:inline-size] [overflow-wrap:anywhere] [&_label]:content-start"
    >
      <div className="flex flex-wrap items-start justify-between gap-[12px] border-b border-line-2 pb-[16px]">
        <div className="min-w-0 flex-1 basis-[260px]">
          <p className="m-0 flex items-center gap-2 text-[10px] font-semibold text-plum"><LuMegaphone aria-hidden />{PLATFORM_LABEL[value.connection.platform]}<span className="text-ink-300">/</span>{value.source === "ai" ? "AI-assisted draft" : "Manual campaign builder"}</p>
          <h2 className="mb-0 mt-[5px] font-serif text-[25px] font-medium leading-tight text-ink-900">
            {isNew ? "New paid campaign" : value.campaignName || "Untitled campaign"}
          </h2>
          <p className="mb-0 mt-[4px] text-[11.5px] text-ink-400">Saved drafts create no ads and spend no budget.</p>
        </div>
        <div className="flex flex-wrap items-center gap-[7px]">
          <button
            type="submit"
            disabled={disabled || saving || (!isNew && !dirty)}
            className={`inline-flex h-[36px] items-center gap-[6px] rounded-[7px] bg-plum px-[12px] text-[12px] font-semibold text-white disabled:cursor-not-allowed disabled:opacity-45 ${focusRing}`}
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

      <nav aria-label="Campaign editor sections" className="flex flex-wrap items-center gap-x-1 gap-y-2 border-b border-line-2 py-2.5">
        {[
          { id: "paid-draft-setup-title", title: "Campaign", icon: LuSlidersHorizontal },
          { id: "paid-draft-budget-title", title: "Budget & dates", icon: LuCalendarDays },
          { id: "paid-draft-groups-title", title: "Audience & ads", icon: LuLayers },
          { id: "paid-draft-assumptions-title", title: "Assumptions", icon: LuFileText },
        ].map(({ id, title, icon: Icon }) => <button key={id} type="button" onClick={() => document.getElementById(id)?.scrollIntoView({ block: "start", behavior: "smooth" })} className={`inline-flex min-h-8 items-center gap-1.5 rounded-[5px] border-0 bg-transparent px-2 text-[11px] font-medium text-ink-500 hover:bg-track-1 hover:text-plum ${focusRing}`}><Icon aria-hidden />{title}</button>)}
        <button type="button" aria-label={previewOpen ? "Hide ad preview" : "Show ad preview"} aria-expanded={previewOpen} aria-controls="paid-draft-preview" onClick={() => setPreviewOpen(!previewOpen)} className={`ml-auto grid h-8 w-8 shrink-0 place-items-center rounded-[5px] border ${previewOpen ? "border-plum-border bg-plum-soft text-plum" : "border-line-2 text-ink-400"} ${focusRing}`} title={previewOpen ? "Hide ad preview" : "Show ad preview"}>{previewOpen ? <LuEye aria-hidden /> : <LuEyeOff aria-hidden />}</button>
      </nav>

      {issues.length ? (
        <div role="alert" className="mt-[12px] border-l-[3px] border-neg-700 bg-neg-bg px-[12px] py-[10px] text-[12px] text-neg-700">
          <p className="m-0 font-semibold">Resolve {issues.length} validation {issues.length === 1 ? "issue" : "issues"} before saving.</p>
          <ul className="mb-0 mt-[5px] list-disc pl-[18px]">
            {issues.slice(0, 8).map((issue, index) => <li key={`${issue.path}-${index}`}>{issue.message}</li>)}
          </ul>
        </div>
      ) : null}

      <div className={`grid min-w-0 grid-cols-1 gap-x-6 ${previewOpen ? "[@container(min-width:850px)]:grid-cols-[minmax(0,1fr)_330px]" : ""}`}>
      <div className="min-w-0 [container-type:inline-size]">
      <section className="border-b border-line-2 py-[18px]" aria-labelledby="paid-draft-setup-title">
        <SectionHeading id="paid-draft-setup-title" icon={<LuSlidersHorizontal />}>Campaign setup</SectionHeading>
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
        {deliverySettings}
      </section>

      <section className="border-b border-line-2 py-[18px]" aria-labelledby="paid-draft-budget-title">
        <SectionHeading id="paid-draft-budget-title" icon={<LuCalendarDays />}>Budget and schedule</SectionHeading>
        <div className="mt-[12px] grid gap-[12px] sm:grid-cols-2 [@container(min-width:680px)]:grid-cols-4">
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
        <SectionHeading id="paid-draft-assumptions-title" icon={<LuFileText />}>Assumptions</SectionHeading>
        <label className="mt-[10px] grid gap-[5px]"><span className={label}>One assumption per line</span><textarea aria-label="Assumptions" rows={3} maxLength={6000} disabled={disabled} value={value.assumptions} onChange={(event) => set("assumptions", event.target.value)} className={`${field} resize-y leading-[1.5]`} /></label>
      </section>

      <section className="py-[18px]" aria-labelledby="paid-draft-groups-title">
        <div className="flex flex-wrap items-center justify-between gap-[8px]">
          <div><SectionHeading id="paid-draft-groups-title" icon={<LuLayers />}>Ad groups and ads</SectionHeading></div>
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
                        <div className="flex items-center justify-between gap-[8px]"><button type="button" aria-label={`Preview ad ${adIndex + 1} from ad group ${groupIndex + 1}`} aria-pressed={selected?.groupId === group.localId && selected.adId === ad.localId} onClick={() => showAdPreview({ groupId: group.localId, adId: ad.localId })} className={`inline-flex min-h-8 items-center gap-1.5 rounded-[5px] border-0 px-2 text-[11px] font-semibold ${selected?.groupId === group.localId && selected.adId === ad.localId ? "bg-plum-soft text-plum" : "bg-transparent text-ink-500"} ${focusRing}`} title="Preview this ad"><LuEye aria-hidden />Ad {adIndex + 1}</button><button type="button" aria-label={`Remove ad ${adIndex + 1} from ad group ${groupIndex + 1}`} disabled={disabled || group.ads.length === 1} onClick={() => setGroup(groupIndex, { ...group, ads: removeAt(group.ads, adIndex) })} className={`grid h-[30px] w-[30px] place-items-center rounded-[6px] border-0 bg-transparent text-ink-400 disabled:opacity-35 ${focusRing}`}><LuTrash2 aria-hidden /></button></div>
                        <div onFocusCapture={() => setSelection({ groupId: group.localId, adId: ad.localId })} className="mt-[8px] grid gap-[11px] md:grid-cols-2">
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
      </div>
      {previewOpen ? <div id="paid-draft-preview" className="order-first min-w-0 border-b border-line-2 py-[18px] [@container(min-width:850px)]:order-last [@container(min-width:850px)]:border-b-0 [@container(min-width:850px)]:border-l [@container(min-width:850px)]:pl-5"><div className="[@container(min-width:850px)]:sticky [@container(min-width:850px)]:top-0"><PaidDraftAdPreview value={value} assets={assets} selection={selection} onSelect={setSelection} unsaved={isNew || dirty} /></div></div> : null}
      </div>
    </form>
  );
}
