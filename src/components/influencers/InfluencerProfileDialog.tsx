"use client";

import {
  type FormEvent,
  useEffect,
  useRef,
  useState,
} from "react";
import { LuCircleAlert, LuRefreshCw, LuX } from "react-icons/lu";

import {
  INFLUENCER_PLATFORMS,
  INFLUENCER_STATUSES,
  type InfluencerMetricDto,
  type InfluencerMetricName,
  type InfluencerProfileDto,
  type InfluencerProfileInput,
} from "./types";

const focusRing =
  "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-plum";
const fieldClass = `h-[37px] w-full min-w-0 rounded-[7px] border border-line-1 bg-surface-card px-[10px] text-[12.5px] text-ink-800 outline-none focus:border-plum-border disabled:cursor-not-allowed disabled:bg-track-1 disabled:text-ink-400 ${focusRing}`;
const focusableSelector = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  '[tabindex]:not([tabindex="-1"])',
].join(",");

const METRICS: Array<{ id: InfluencerMetricName; label: string; suffix: string }> = [
  { id: "audience_size", label: "Audience", suffix: "people" },
  { id: "average_views", label: "Average views", suffix: "views" },
  { id: "engagement_rate", label: "Engagement rate", suffix: "%" },
];

interface MetricDraft {
  value: string;
  source: InfluencerMetricDto["source"];
  sourceUrl: string;
  observedAt: string;
}

type MetricsDraft = Record<InfluencerMetricName, MetricDraft>;

interface ProfileFormState {
  platform: InfluencerProfileInput["platform"];
  handle: string;
  profileUrl: string;
  displayName: string;
  contactName: string;
  contactEmail: string;
  topics: string;
  audienceCountries: string;
  notes: string;
  status: InfluencerProfileInput["status"];
  source: InfluencerProfileInput["source"];
}

function dateInputValue(value: string): string {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? "" : parsed.toISOString().slice(0, 10);
}

function blankMetric(): MetricDraft {
  return { value: "", source: "manual", sourceUrl: "", observedAt: "" };
}

function metricDrafts(profile: InfluencerProfileDto | null): MetricsDraft {
  const result: MetricsDraft = {
    audience_size: blankMetric(),
    average_views: blankMetric(),
    engagement_rate: blankMetric(),
  };
  for (const metric of profile?.metrics ?? []) {
    result[metric.metric] = {
      value: String(metric.value),
      source: metric.source,
      sourceUrl: metric.sourceUrl ?? "",
      observedAt: dateInputValue(metric.observedAt),
    };
  }
  return result;
}

function initialState(profile: InfluencerProfileDto | null): ProfileFormState {
  return {
    platform: profile?.platform ?? "instagram",
    handle: profile?.handle ?? "",
    profileUrl: profile?.profileUrl ?? "",
    displayName: profile?.displayName ?? "",
    contactName: profile?.contactName ?? "",
    contactEmail: profile?.contactEmail ?? "",
    topics: profile?.topics.join(", ") ?? "",
    audienceCountries: profile?.audienceCountries.join(", ") ?? "",
    notes: profile?.notes ?? "",
    status: profile?.status ?? "prospect",
    source: profile?.source === "import" ? "import" : "manual",
  };
}

function list(value: string): string[] {
  return [...new Set(value.split(",").map((item) => item.trim().toLowerCase()).filter(Boolean))];
}

function validHttpsUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password;
  } catch {
    return false;
  }
}

function toMetricDtos(draft: MetricsDraft): InfluencerMetricDto[] {
  return METRICS.flatMap(({ id }) => {
    const row = draft[id];
    if (!row.value.trim()) return [];
    return [{
      metric: id,
      value: Number(row.value),
      source: row.source,
      sourceUrl: row.sourceUrl.trim() || null,
      observedAt: new Date(`${row.observedAt}T00:00:00.000Z`).toISOString(),
    }];
  });
}

function label(value: string): string {
  return value.replaceAll("_", " ").replace(/^./, (character) => character.toUpperCase());
}

export function InfluencerProfileDialog({
  profile,
  busy,
  error,
  conflict,
  onClose,
  onSubmit,
  onReloadLatest,
}: {
  profile: InfluencerProfileDto | null;
  busy: boolean;
  error: string | null;
  conflict: boolean;
  onClose: () => void;
  onSubmit: (input: InfluencerProfileInput) => void | Promise<void>;
  onReloadLatest: () => void | Promise<void>;
}) {
  const dialogRef = useRef<HTMLElement>(null);
  const firstFieldRef = useRef<HTMLSelectElement>(null);
  const busyRef = useRef(busy);
  const [form, setForm] = useState<ProfileFormState>(() => initialState(profile));
  const [metrics, setMetrics] = useState<MetricsDraft>(() => metricDrafts(profile));
  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => {
    setForm(initialState(profile));
    setMetrics(metricDrafts(profile));
    setFormError(null);
  }, [profile]);

  useEffect(() => {
    busyRef.current = busy;
  }, [busy]);

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    firstFieldRef.current?.focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busyRef.current) {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = [...(dialogRef.current?.querySelectorAll<HTMLElement>(focusableSelector) ?? [])]
        .filter((element) => element.getAttribute("aria-hidden") !== "true");
      if (!focusable.length) return;
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
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [onClose]);

  const updateMetric = <K extends keyof MetricDraft>(
    metric: InfluencerMetricName,
    key: K,
    value: MetricDraft[K],
  ) => {
    setMetrics((current) => ({
      ...current,
      [metric]: { ...current[metric], [key]: value },
    }));
  };

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setFormError(null);
    if (!validHttpsUrl(form.profileUrl.trim())) {
      setFormError("Profile URL must be a public HTTPS URL.");
      return;
    }
    for (const { id, label: metricLabel } of METRICS) {
      const metric = metrics[id];
      if (!metric.value.trim()) continue;
      if (!metric.observedAt) {
        setFormError(`${metricLabel} needs an observed date.`);
        return;
      }
      if (metric.sourceUrl.trim() && !validHttpsUrl(metric.sourceUrl.trim())) {
        setFormError(`${metricLabel} evidence must be a public HTTPS URL.`);
        return;
      }
    }
    void onSubmit({
      platform: form.platform,
      handle: form.handle.trim().replace(/^@+/, "").toLowerCase(),
      profileUrl: form.profileUrl.trim(),
      displayName: form.displayName.trim() || null,
      contactName: form.contactName.trim() || null,
      contactEmail: form.contactEmail.trim().toLowerCase() || null,
      topics: list(form.topics),
      audienceCountries: list(form.audienceCountries),
      notes: form.notes.trim() || null,
      status: form.status,
      source: form.source,
      metrics: toMetricDtos(metrics),
    });
  };

  return (
    <div
      className="fixed inset-0 z-[80] flex items-end justify-center bg-ink-900/35 p-0 sm:items-center sm:p-[20px]"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !busy) onClose();
      }}
    >
      <section
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="influencer-profile-dialog-title"
        className="flex max-h-[94dvh] w-full max-w-[760px] min-w-0 flex-col overflow-hidden rounded-t-[8px] border border-line-1 bg-surface-panel shadow-2xl sm:rounded-[8px]"
      >
        <header className="flex flex-none items-center justify-between gap-[12px] border-b border-line-2 px-[16px] py-[13px] sm:px-[20px]">
          <div className="min-w-0">
            <p className="m-0 text-[10px] font-semibold uppercase text-ink-300">Influencer CRM</p>
            <h2 id="influencer-profile-dialog-title" className="mb-0 mt-[2px] text-[17px] font-semibold text-ink-900">
              {profile ? "Edit profile" : "Add profile"}
            </h2>
          </div>
          <button
            type="button"
            aria-label="Close profile editor"
            title="Close"
            disabled={busy}
            onClick={onClose}
            className={`flex h-[32px] w-[32px] flex-none items-center justify-center rounded-[7px] text-ink-400 hover:bg-track-1 hover:text-ink-800 disabled:opacity-40 ${focusRing}`}
          >
            <LuX aria-hidden />
          </button>
        </header>

        <form onSubmit={submit} className="min-h-0 overflow-y-auto overscroll-contain px-[16px] py-[15px] sm:px-[20px]">
          <div className="grid min-w-0 gap-[12px] sm:grid-cols-2">
            <label className="min-w-0 text-[11px] font-semibold text-ink-500">
              Platform
              <select ref={firstFieldRef} value={form.platform} onChange={(event) => setForm((current) => ({ ...current, platform: event.target.value as ProfileFormState["platform"] }))} className={`${fieldClass} mt-[5px]`}>
                {INFLUENCER_PLATFORMS.map((platform) => <option key={platform} value={platform}>{label(platform)}</option>)}
              </select>
            </label>
            <label className="min-w-0 text-[11px] font-semibold text-ink-500">
              Handle
              <input required maxLength={120} value={form.handle} onChange={(event) => setForm((current) => ({ ...current, handle: event.target.value }))} placeholder="creator_handle" className={`${fieldClass} mt-[5px]`} />
            </label>
            <label className="min-w-0 text-[11px] font-semibold text-ink-500 sm:col-span-2">
              Profile URL
              <input required type="url" inputMode="url" value={form.profileUrl} onChange={(event) => setForm((current) => ({ ...current, profileUrl: event.target.value }))} placeholder="https://..." className={`${fieldClass} mt-[5px]`} />
            </label>
            <label className="min-w-0 text-[11px] font-semibold text-ink-500">
              Display name
              <input maxLength={160} value={form.displayName} onChange={(event) => setForm((current) => ({ ...current, displayName: event.target.value }))} className={`${fieldClass} mt-[5px]`} />
            </label>
            <label className="min-w-0 text-[11px] font-semibold text-ink-500">
              Stage
              <select value={form.status} onChange={(event) => setForm((current) => ({ ...current, status: event.target.value as ProfileFormState["status"] }))} className={`${fieldClass} mt-[5px]`}>
                {INFLUENCER_STATUSES.map((status) => <option key={status} value={status}>{label(status)}</option>)}
              </select>
            </label>
            <label className="min-w-0 text-[11px] font-semibold text-ink-500">
              Contact name
              <input maxLength={160} value={form.contactName} onChange={(event) => setForm((current) => ({ ...current, contactName: event.target.value }))} className={`${fieldClass} mt-[5px]`} />
            </label>
            <label className="min-w-0 text-[11px] font-semibold text-ink-500">
              Contact email
              <input type="email" maxLength={320} value={form.contactEmail} onChange={(event) => setForm((current) => ({ ...current, contactEmail: event.target.value }))} className={`${fieldClass} mt-[5px]`} />
            </label>
            <label className="min-w-0 text-[11px] font-semibold text-ink-500">
              Topics
              <input value={form.topics} onChange={(event) => setForm((current) => ({ ...current, topics: event.target.value }))} placeholder="saas, analytics" className={`${fieldClass} mt-[5px]`} />
            </label>
            <label className="min-w-0 text-[11px] font-semibold text-ink-500">
              Audience countries
              <input value={form.audienceCountries} onChange={(event) => setForm((current) => ({ ...current, audienceCountries: event.target.value }))} placeholder="spain, united kingdom" className={`${fieldClass} mt-[5px]`} />
            </label>
            <label className="min-w-0 text-[11px] font-semibold text-ink-500">
              Source
              <select value={form.source} onChange={(event) => setForm((current) => ({ ...current, source: event.target.value as ProfileFormState["source"] }))} className={`${fieldClass} mt-[5px]`}>
                <option value="manual">Manual research</option>
                <option value="import">Imported list</option>
              </select>
            </label>
            <label className="min-w-0 text-[11px] font-semibold text-ink-500 sm:col-span-2">
              Qualification notes
              <textarea rows={3} maxLength={10_000} value={form.notes} onChange={(event) => setForm((current) => ({ ...current, notes: event.target.value }))} placeholder="Audience fit, content quality, constraints, and evidence to verify" className={`${fieldClass} mt-[5px] h-auto min-h-[76px] resize-y py-[8px] leading-[1.45]`} />
            </label>
          </div>

          <fieldset className="mt-[18px] min-w-0 border-0 border-t border-line-2 p-0 pt-[14px]">
            <legend className="px-0 text-[12px] font-semibold text-ink-800">Audience evidence</legend>
            <p className="mb-0 mt-[3px] text-[10.5px] text-ink-400">Leave a metric blank when it is not known. Values require an observation date.</p>
            <div className="mt-[10px] divide-y divide-line-4 border-y border-line-2">
              {METRICS.map((metric) => {
                const row = metrics[metric.id];
                return (
                  <div key={metric.id} className="grid min-w-0 gap-[8px] py-[10px] sm:grid-cols-[130px_110px_130px_minmax(0,1fr)] sm:items-end">
                    <label className="min-w-0 text-[10.5px] font-semibold text-ink-500">
                      {metric.label}
                      <span className="relative mt-[4px] block">
                        <input aria-label={`${metric.label} value`} type="number" min="0" max={metric.id === "engagement_rate" ? 100 : undefined} step={metric.id === "engagement_rate" ? "0.01" : "1"} value={row.value} onChange={(event) => updateMetric(metric.id, "value", event.target.value)} className={`${fieldClass} pr-[42px]`} />
                        <span className="pointer-events-none absolute right-[8px] top-1/2 -translate-y-1/2 text-[9px] text-ink-300">{metric.suffix}</span>
                      </span>
                    </label>
                    <label className="min-w-0 text-[10.5px] font-semibold text-ink-500">
                      Evidence type
                      <select aria-label={`${metric.label} evidence type`} value={row.source} onChange={(event) => updateMetric(metric.id, "source", event.target.value as MetricDraft["source"])} className={`${fieldClass} mt-[4px]`}>
                        <option value="manual">Manual</option>
                        <option value="public_profile">Public profile</option>
                        {row.source === "vendor" ? <option value="vendor">Vendor</option> : null}
                      </select>
                    </label>
                    <label className="min-w-0 text-[10.5px] font-semibold text-ink-500">
                      Observed
                      <input aria-label={`${metric.label} observed date`} type="date" required={Boolean(row.value.trim())} value={row.observedAt} onChange={(event) => updateMetric(metric.id, "observedAt", event.target.value)} className={`${fieldClass} mt-[4px]`} />
                    </label>
                    <label className="min-w-0 text-[10.5px] font-semibold text-ink-500">
                      Evidence URL
                      <input aria-label={`${metric.label} evidence URL`} type="url" inputMode="url" value={row.sourceUrl} onChange={(event) => updateMetric(metric.id, "sourceUrl", event.target.value)} placeholder="Optional HTTPS source" className={`${fieldClass} mt-[4px]`} />
                    </label>
                  </div>
                );
              })}
            </div>
          </fieldset>

          {formError || error ? (
            <div role="alert" className="mt-[13px] flex min-w-0 items-start gap-[8px] rounded-[7px] bg-neg-bg px-[11px] py-[9px] text-[11.5px] text-neg-700">
              <LuCircleAlert aria-hidden className="mt-[1px] flex-none" />
              <span className="min-w-0">{formError ?? error}</span>
            </div>
          ) : null}
          {conflict ? (
            <button type="button" disabled={busy} onClick={() => void onReloadLatest()} className={`mt-[9px] inline-flex h-[33px] items-center gap-[6px] rounded-[7px] border border-line-1 bg-surface-card px-[10px] text-[11px] font-semibold text-ink-700 ${focusRing}`}>
              <LuRefreshCw aria-hidden /> Reload latest
            </button>
          ) : null}

          <footer className="mt-[17px] flex items-center justify-end gap-[8px] border-t border-line-2 pt-[14px]">
            <button type="button" disabled={busy} onClick={onClose} className={`h-[37px] rounded-[7px] border border-line-1 bg-surface-card px-[14px] text-[12px] font-semibold text-ink-600 disabled:opacity-40 ${focusRing}`}>Cancel</button>
            <button type="submit" disabled={busy} className={`h-[37px] rounded-[7px] bg-plum px-[15px] text-[12px] font-semibold text-white disabled:opacity-45 ${focusRing}`}>
              {busy ? "Saving..." : profile ? "Save profile" : "Add profile"}
            </button>
          </footer>
        </form>
      </section>
    </div>
  );
}
