"use client";

import {
  type FormEvent,
  useEffect,
  useMemo,
  useState,
} from "react";
import {
  LuCheck,
  LuClipboard,
  LuExternalLink,
  LuLink,
  LuMail,
  LuPencil,
  LuSparkles,
  LuUnlink,
  LuX,
} from "react-icons/lu";

import {
  INFLUENCER_STATUSES,
  type InfluencerCapabilityDto,
  type InfluencerMetricDto,
  type InfluencerOutreachInput,
  type InfluencerProfileDto,
  type InfluencerStatus,
  type InfluencerTrackingLinkDto,
} from "./types";

const focusRing =
  "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-plum";
const fieldClass = `h-[36px] w-full min-w-0 rounded-[7px] border border-line-1 bg-surface-card px-[9px] text-[12px] text-ink-800 outline-none focus:border-plum-border disabled:cursor-not-allowed disabled:bg-track-1 disabled:text-ink-400 ${focusRing}`;

function title(value: string): string {
  return value.replaceAll("_", " ").replace(/^./, (character) => character.toUpperCase());
}

function dateLabel(value: string | null | undefined): string {
  if (!value) return "Not recorded";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Not recorded";
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(date);
}

function metricValue(metric: InfluencerMetricDto): string {
  if (metric.metric === "engagement_rate") {
    return `${new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 }).format(metric.value)}%`;
  }
  return new Intl.NumberFormat(undefined, { notation: "compact", maximumFractionDigits: 1 }).format(metric.value);
}

function identity(profile: InfluencerProfileDto): string {
  const handle = (profile.normalizedHandle ?? profile.handle).trim().replace(/^@+/, "").toLowerCase();
  return `${profile.platform}:@${handle}`;
}

function mailto(outreach: InfluencerOutreachInput, email: string): string {
  const body = [outreach.body, outreach.sponsorshipDisclosure]
    .filter(Boolean)
    .join("\n\n");
  const params = new URLSearchParams();
  if (outreach.subject) params.set("subject", outreach.subject);
  params.set("body", body);
  return `mailto:${email}?${params.toString()}`;
}

async function copyText(value: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(value);
    return true;
  } catch {
    return false;
  }
}

function EvidenceTable({ profile }: { profile: InfluencerProfileDto }) {
  if (!profile.metrics.length) {
    return <p className="mb-0 mt-[7px] text-[11.5px] text-ink-400">No audience metrics have been recorded.</p>;
  }
  return (
    <div className="mt-[8px] min-w-0 divide-y divide-line-4 border-y border-line-2">
      {profile.metrics.map((metric) => (
        <div key={metric.metric} className="grid min-w-0 gap-[3px] py-[8px] sm:grid-cols-[120px_100px_minmax(0,1fr)_110px] sm:items-center sm:gap-[8px]">
          <span className="text-[10.5px] font-semibold text-ink-600">{title(metric.metric)}</span>
          <strong className="text-[12px] font-semibold text-ink-900">{metricValue(metric)}</strong>
          <span className="min-w-0 truncate text-[10.5px] text-ink-400">
            {metric.sourceUrl ? (
              <a href={metric.sourceUrl} target="_blank" rel="noreferrer" className={`inline-flex max-w-full items-center gap-[4px] text-plum hover:underline ${focusRing}`}>
                <span className="truncate">{title(metric.source)}</span><LuExternalLink aria-hidden className="flex-none" />
              </a>
            ) : title(metric.source)}
          </span>
          <span className="text-[10px] text-ink-400 sm:text-right">Observed {dateLabel(metric.observedAt)}</span>
        </div>
      ))}
    </div>
  );
}

export function InfluencerProfileDetail({
  profile,
  capability,
  busy,
  onEdit,
  onStageChange,
  onSaveOutreach,
  onCreateTrackingLink,
  onDisableTrackingLink,
  onAskAI,
}: {
  profile: InfluencerProfileDto;
  capability: InfluencerCapabilityDto;
  busy: boolean;
  onEdit: () => void;
  onStageChange: (status: InfluencerStatus) => void | Promise<void>;
  onSaveOutreach: (draft: InfluencerOutreachInput) => void | Promise<void>;
  onCreateTrackingLink: (input: { destinationUrl: string; campaignKey: string }) => Promise<InfluencerTrackingLinkDto | null>;
  onDisableTrackingLink: (link: InfluencerTrackingLinkDto) => void | Promise<void>;
  onAskAI: (prompt: string) => void | Promise<void>;
}) {
  const latestOutreach = useMemo(
    () => [...(profile.outreachDrafts ?? [])].sort((a, b) => new Date(b.updatedAt ?? b.createdAt).getTime() - new Date(a.updatedAt ?? a.createdAt).getTime())[0] ?? null,
    [profile.outreachDrafts],
  );
  const [outreach, setOutreach] = useState<InfluencerOutreachInput>({
    subject: null,
    body: "",
    sponsorshipDisclosure: "Paid partnership disclosure required.",
    claimsRestrictions: null,
    compensationNote: null,
  });
  const [destinationUrl, setDestinationUrl] = useState("");
  const [campaignKey, setCampaignKey] = useState("");
  const [createdLink, setCreatedLink] = useState<InfluencerTrackingLinkDto | null>(null);
  const [copyNotice, setCopyNotice] = useState("");

  useEffect(() => {
    setOutreach({
      subject: latestOutreach?.subject ?? null,
      body: latestOutreach?.body ?? "",
      sponsorshipDisclosure: latestOutreach?.sponsorshipDisclosure ?? "Paid partnership disclosure required.",
      claimsRestrictions: latestOutreach?.claimsRestrictions ?? null,
      compensationNote: latestOutreach?.compensationNote ?? null,
    });
    setDestinationUrl("");
    setCampaignKey("");
    setCreatedLink(null);
    setCopyNotice("");
  }, [latestOutreach, profile.id]);

  const saveOutreach = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!capability.canManage) return;
    void onSaveOutreach({
      subject: outreach.subject?.trim() || null,
      body: outreach.body.trim(),
      sponsorshipDisclosure: outreach.sponsorshipDisclosure.trim(),
      claimsRestrictions: outreach.claimsRestrictions?.trim() || null,
      compensationNote: outreach.compensationNote?.trim() || null,
    });
  };

  const createTrackingLink = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!capability.canManage) return;
    const link = await onCreateTrackingLink({
      destinationUrl: destinationUrl.trim(),
      campaignKey: campaignKey.trim(),
    });
    if (link) {
      setCreatedLink(link);
      setDestinationUrl("");
      setCampaignKey("");
    }
  };

  const copyDraft = async () => {
    const value = [
      outreach.subject ? `Subject: ${outreach.subject}` : "",
      outreach.body,
      outreach.sponsorshipDisclosure,
    ].filter(Boolean).join("\n\n");
    setCopyNotice(await copyText(value) ? "Draft copied." : "Copy was blocked by the browser.");
  };

  const copyLink = async (link: InfluencerTrackingLinkDto) => {
    setCopyNotice(await copyText(link.trackingUrl) ? "Tracking link copied." : "Copy was blocked by the browser.");
  };

  const trackingLinks = createdLink
    ? [createdLink, ...(profile.trackingLinks ?? []).filter((link) => link.slug !== createdLink.slug)]
    : profile.trackingLinks ?? [];

  return (
    <article aria-labelledby="influencer-detail-title" className="min-w-0 bg-surface-panel">
      <header className="flex min-w-0 flex-wrap items-start justify-between gap-[10px] border-b border-line-2 px-[14px] py-[13px] sm:px-[18px]">
        <div className="min-w-0">
          <p className="m-0 truncate font-mono text-[9.5px] text-ink-400">{identity(profile)}</p>
          <h2 id="influencer-detail-title" className="mb-0 mt-[3px] truncate text-[17px] font-semibold text-ink-900">{profile.displayName || `@${profile.handle.replace(/^@+/, "")}`}</h2>
          <a href={profile.profileUrl} target="_blank" rel="noreferrer" className={`mt-[4px] inline-flex max-w-full items-center gap-[4px] text-[10.5px] text-plum hover:underline ${focusRing}`}>
            <span className="truncate">Open public profile</span><LuExternalLink aria-hidden />
          </a>
        </div>
        {capability.canManage ? (
          <button type="button" onClick={onEdit} className={`flex h-[34px] items-center gap-[6px] rounded-[7px] border border-line-1 bg-surface-card px-[10px] text-[11.5px] font-semibold text-ink-700 ${focusRing}`}>
            <LuPencil aria-hidden /> Edit
          </button>
        ) : <span className="rounded-[6px] bg-track-1 px-[7px] py-[4px] text-[10px] font-semibold text-ink-400">Read only</span>}
      </header>

      <div className="min-w-0 divide-y divide-line-2">
        <section className="min-w-0 px-[14px] py-[14px] sm:px-[18px]">
          <div className="grid min-w-0 gap-[11px] sm:grid-cols-2">
            <div>
              <p className="m-0 text-[10px] font-semibold uppercase text-ink-300">Pipeline stage</p>
              {capability.canManage ? (
                <select aria-label="Pipeline stage" disabled={busy} value={profile.status} onChange={(event) => void onStageChange(event.target.value as InfluencerStatus)} className={`${fieldClass} mt-[5px] max-w-[220px]`}>
                  {INFLUENCER_STATUSES.map((status) => <option key={status} value={status}>{title(status)}</option>)}
                </select>
              ) : <p className="mb-0 mt-[4px] text-[12px] font-semibold text-ink-700">{title(profile.status)}</p>}
            </div>
            <div>
              <p className="m-0 text-[10px] font-semibold uppercase text-ink-300">Last activity</p>
              <p className="mb-0 mt-[4px] text-[12px] text-ink-700">{dateLabel(profile.lastActivityAt ?? profile.updatedAt)}</p>
            </div>
            <div className="min-w-0">
              <p className="m-0 text-[10px] font-semibold uppercase text-ink-300">Topics</p>
              <p className="mb-0 mt-[4px] break-words text-[12px] text-ink-700">{profile.topics.length ? profile.topics.join(", ") : "Not recorded"}</p>
            </div>
            <div className="min-w-0">
              <p className="m-0 text-[10px] font-semibold uppercase text-ink-300">Audience geography</p>
              <p className="mb-0 mt-[4px] break-words text-[12px] text-ink-700">{profile.audienceCountries.length ? profile.audienceCountries.join(", ") : "Not recorded"}</p>
            </div>
          </div>
          {capability.contactVisibility === "full" ? (
            <div className="mt-[12px] grid min-w-0 gap-[10px] border-t border-line-4 pt-[10px] sm:grid-cols-2" data-testid="influencer-contact-fields">
              <div className="min-w-0"><p className="m-0 text-[10px] font-semibold uppercase text-ink-300">Contact name</p><p className="mb-0 mt-[3px] truncate text-[12px] text-ink-700">{profile.contactName || "Not recorded"}</p></div>
              <div className="min-w-0"><p className="m-0 text-[10px] font-semibold uppercase text-ink-300">Contact email</p><p className="mb-0 mt-[3px] truncate text-[12px] text-ink-700">{profile.contactEmail || "Not recorded"}</p></div>
            </div>
          ) : null}
        </section>

        <section className="min-w-0 px-[14px] py-[14px] sm:px-[18px]">
          <h3 className="m-0 text-[12.5px] font-semibold text-ink-900">Audience evidence</h3>
          <EvidenceTable profile={profile} />
          {profile.qualificationEvidence?.length ? (
            <div className="mt-[12px]">
              <p className="m-0 text-[10px] font-semibold uppercase text-ink-300">Qualification evidence</p>
              <ul className="mb-0 mt-[5px] space-y-[5px] pl-[16px] text-[11.5px] text-ink-600">
                {profile.qualificationEvidence.map((evidence, index) => (
                  <li key={evidence.id ?? `${evidence.label}-${index}`}>
                    <span className="font-semibold">{evidence.label}</span>{evidence.detail ? `: ${evidence.detail}` : ""}
                    {evidence.sourceUrl ? <a href={evidence.sourceUrl} target="_blank" rel="noreferrer" aria-label={`Open evidence for ${evidence.label}`} className={`ml-[5px] inline-flex text-plum ${focusRing}`}><LuExternalLink aria-hidden /></a> : null}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          <div className="mt-[12px] border-t border-line-4 pt-[10px]">
            <p className="m-0 text-[10px] font-semibold uppercase text-ink-300">Qualification notes</p>
            <p className="mb-0 mt-[4px] whitespace-pre-wrap break-words text-[11.5px] leading-[1.5] text-ink-600">{profile.notes || "No qualification notes recorded."}</p>
          </div>
        </section>

        {profile.campaigns ? (
          <section className="min-w-0 px-[14px] py-[14px] sm:px-[18px]">
            <h3 className="m-0 text-[12.5px] font-semibold text-ink-900">Campaigns</h3>
            {profile.campaigns.length ? <ul className="mb-0 mt-[7px] space-y-[5px] pl-[16px] text-[11.5px] text-ink-600">{profile.campaigns.map((campaign) => <li key={campaign.id}>{campaign.name} - {title(campaign.status)}</li>)}</ul> : <p className="mb-0 mt-[5px] text-[11.5px] text-ink-400">No persisted campaigns are linked.</p>}
          </section>
        ) : null}
        {profile.deliverables ? (
          <section className="min-w-0 px-[14px] py-[14px] sm:px-[18px]">
            <h3 className="m-0 text-[12.5px] font-semibold text-ink-900">Deliverables</h3>
            {profile.deliverables.length ? <ul className="mb-0 mt-[7px] space-y-[5px] pl-[16px] text-[11.5px] text-ink-600">{profile.deliverables.map((deliverable) => <li key={deliverable.id}>{deliverable.title} - {title(deliverable.status)}{deliverable.dueAt ? `, due ${dateLabel(deliverable.dueAt)}` : ""}</li>)}</ul> : <p className="mb-0 mt-[5px] text-[11.5px] text-ink-400">No persisted deliverables are linked.</p>}
          </section>
        ) : null}

        <section className="min-w-0 px-[14px] py-[14px] sm:px-[18px]">
          <div className="flex min-w-0 flex-wrap items-center justify-between gap-[8px]">
            <div>
              <h3 className="m-0 text-[12.5px] font-semibold text-ink-900">Outreach draft</h3>
              <p className="mb-0 mt-[2px] text-[10.5px] text-ink-400">Prepare and review copy. Marpin does not send it automatically.</p>
            </div>
            {capability.canManage ? (
              capability.aiAssistance === "available" ? (
                <button type="button" disabled={busy} onClick={() => void onAskAI(`Prepare a concise, compliant influencer outreach draft for ${identity(profile)} based only on its recorded topics, audience evidence, and qualification notes. Include a clear sponsorship disclosure and do not send anything.`)} className={`flex h-[32px] items-center gap-[5px] rounded-[7px] border border-plum-border bg-plum-soft px-[9px] text-[10.5px] font-semibold text-plum-deep disabled:opacity-40 ${focusRing}`}><LuSparkles aria-hidden /> Draft with AI</button>
              ) : <span className="text-[10.5px] font-medium text-ink-400">{capability.aiAssistance === "upgrade_required" ? "AI assistance requires an upgrade." : "AI assistance is unavailable."}</span>
            ) : null}
          </div>
          {capability.canManage ? (
            <form onSubmit={saveOutreach} className="mt-[10px] min-w-0 space-y-[8px]">
              <label className="block min-w-0 text-[10.5px] font-semibold text-ink-500">Subject<input maxLength={240} value={outreach.subject ?? ""} onChange={(event) => setOutreach((current) => ({ ...current, subject: event.target.value }))} className={`${fieldClass} mt-[4px]`} /></label>
              <label className="block min-w-0 text-[10.5px] font-semibold text-ink-500">Draft body<textarea required rows={5} maxLength={10_000} value={outreach.body} onChange={(event) => setOutreach((current) => ({ ...current, body: event.target.value }))} className={`${fieldClass} mt-[4px] h-auto min-h-[112px] resize-y py-[8px] leading-[1.45]`} /></label>
              <label className="block min-w-0 text-[10.5px] font-semibold text-ink-500">Sponsorship disclosure<textarea required rows={2} maxLength={500} value={outreach.sponsorshipDisclosure} onChange={(event) => setOutreach((current) => ({ ...current, sponsorshipDisclosure: event.target.value }))} className={`${fieldClass} mt-[4px] h-auto min-h-[62px] resize-y py-[8px] leading-[1.45]`} /></label>
              <div className="grid min-w-0 gap-[8px] sm:grid-cols-2">
                <label className="block min-w-0 text-[10.5px] font-semibold text-ink-500">Claims restrictions<textarea rows={2} maxLength={2_000} value={outreach.claimsRestrictions ?? ""} onChange={(event) => setOutreach((current) => ({ ...current, claimsRestrictions: event.target.value }))} className={`${fieldClass} mt-[4px] h-auto min-h-[62px] resize-y py-[8px]`} /></label>
                <label className="block min-w-0 text-[10.5px] font-semibold text-ink-500">Compensation note<textarea rows={2} maxLength={2_000} value={outreach.compensationNote ?? ""} onChange={(event) => setOutreach((current) => ({ ...current, compensationNote: event.target.value }))} className={`${fieldClass} mt-[4px] h-auto min-h-[62px] resize-y py-[8px]`} /></label>
              </div>
              <div className="flex min-w-0 flex-wrap items-center gap-[7px]">
                <button type="submit" disabled={busy || !outreach.body.trim() || !outreach.sponsorshipDisclosure.trim()} className={`h-[34px] rounded-[7px] bg-plum px-[11px] text-[11px] font-semibold text-white disabled:opacity-45 ${focusRing}`}>{busy ? "Saving..." : "Save draft"}</button>
                <button type="button" disabled={!outreach.body.trim()} onClick={() => void copyDraft()} className={`flex h-[34px] items-center gap-[5px] rounded-[7px] border border-line-1 bg-surface-card px-[10px] text-[11px] font-semibold text-ink-700 disabled:opacity-40 ${focusRing}`}><LuClipboard aria-hidden /> Copy draft</button>
                {profile.contactEmail ? <a href={mailto(outreach, profile.contactEmail)} className={`flex h-[34px] items-center gap-[5px] rounded-[7px] border border-line-1 bg-surface-card px-[10px] text-[11px] font-semibold text-ink-700 ${focusRing}`}><LuMail aria-hidden /> Open email</a> : <button type="button" disabled className="flex h-[34px] items-center gap-[5px] rounded-[7px] border border-line-1 bg-track-1 px-[10px] text-[11px] font-semibold text-ink-300"><LuMail aria-hidden /> Open email</button>}
              </div>
            </form>
          ) : <p className="mb-0 mt-[8px] text-[11.5px] text-ink-400">Outreach preparation is read only for your workspace role.</p>}
        </section>

        <section className="min-w-0 px-[14px] py-[14px] sm:px-[18px]">
          <h3 className="m-0 text-[12.5px] font-semibold text-ink-900">Tracking links</h3>
          <p className="mb-0 mt-[2px] text-[10.5px] text-ink-400">Create tagged destinations. Results appear only when measured data is returned.</p>
          {capability.canManage ? (
            <form onSubmit={createTrackingLink} className="mt-[9px] grid min-w-0 gap-[7px] sm:grid-cols-[minmax(0,1fr)_150px_auto] sm:items-end">
              <label className="min-w-0 text-[10.5px] font-semibold text-ink-500">Destination URL<input required type="url" inputMode="url" value={destinationUrl} onChange={(event) => setDestinationUrl(event.target.value)} placeholder="https://www.example.com/offer" className={`${fieldClass} mt-[4px]`} /></label>
              <label className="min-w-0 text-[10.5px] font-semibold text-ink-500">Campaign key<input required value={campaignKey} onChange={(event) => setCampaignKey(event.target.value)} placeholder="summer-launch" className={`${fieldClass} mt-[4px]`} /></label>
              <button type="submit" disabled={busy} className={`flex h-[36px] items-center justify-center gap-[5px] rounded-[7px] border border-line-1 bg-surface-card px-[10px] text-[11px] font-semibold text-ink-700 disabled:opacity-40 ${focusRing}`}><LuLink aria-hidden /> Create</button>
            </form>
          ) : null}
          {trackingLinks.length ? (
            <div className="mt-[10px] min-w-0 divide-y divide-line-4 border-y border-line-2">
              {trackingLinks.map((link) => (
                <div key={link.slug} className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-[7px] py-[8px]">
                  <span className="min-w-0">
                    {link.enabled ? <a href={link.trackingUrl} target="_blank" rel="noreferrer" className={`block truncate text-[10.5px] text-plum hover:underline ${focusRing}`}>{link.trackingUrl}</a> : <span className="block truncate text-[10.5px] text-ink-300">{link.trackingUrl}</span>}
                    <span className="mt-[2px] block text-[9.5px] text-ink-400">{link.enabled ? `${link.clickCount} clicks · expires ${dateLabel(link.expiresAt)}` : `Disabled ${dateLabel(link.disabledAt)}`}</span>
                  </span>
                  <button type="button" disabled={!link.enabled} aria-label="Copy tracking link" title="Copy tracking link" onClick={() => void copyLink(link)} className={`flex h-[29px] w-[29px] flex-none items-center justify-center rounded-[6px] border border-line-1 bg-surface-card text-ink-500 disabled:cursor-not-allowed disabled:opacity-35 ${focusRing}`}><LuClipboard aria-hidden /></button>
                  {capability.canManage ? <button type="button" disabled={busy || !link.enabled} aria-label="Disable tracking link" title="Disable tracking link" onClick={() => void onDisableTrackingLink(link)} className={`flex h-[29px] w-[29px] flex-none items-center justify-center rounded-[6px] border border-line-1 bg-surface-card text-ink-500 disabled:cursor-not-allowed disabled:opacity-35 ${focusRing}`}><LuUnlink aria-hidden /></button> : null}
                </div>
              ))}
            </div>
          ) : <p className="mb-0 mt-[7px] text-[11.5px] text-ink-400">No tracking links recorded.</p>}
        </section>
      </div>

      <div aria-live="polite" className="sr-only">{busy ? "Saving influencer changes" : ""}</div>
      {copyNotice ? <div role="status" aria-live="polite" className="sticky bottom-0 flex items-center gap-[6px] border-t border-line-2 bg-surface-card px-[14px] py-[8px] text-[10.5px] text-pos-700"><LuCheck aria-hidden /> {copyNotice}<button type="button" aria-label="Dismiss copy notice" onClick={() => setCopyNotice("")} className={`ml-auto flex h-[25px] w-[25px] items-center justify-center rounded-[6px] ${focusRing}`}><LuX aria-hidden className="h-[12px] w-[12px]" /></button></div> : null}
    </article>
  );
}
