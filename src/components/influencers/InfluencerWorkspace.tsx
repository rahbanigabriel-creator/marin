"use client";

import {
  type MouseEvent as ReactMouseEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  LuCalendarDays,
  LuChartNoAxesCombined,
  LuCircleAlert,
  LuLayoutGrid,
  LuListFilter,
  LuPlus,
  LuRefreshCw,
  LuSearch,
  LuSparkles,
  LuUsers,
  LuX,
} from "react-icons/lu";

import { InfluencerProfileDetail } from "./InfluencerProfileDetail";
import { InfluencerProfileDialog } from "./InfluencerProfileDialog";
import {
  INFLUENCER_PLATFORMS,
  INFLUENCER_STATUSES,
  type InfluencerMetricDto,
  type InfluencerOutreachInput,
  type InfluencerPlatform,
  type InfluencerProfileDto,
  type InfluencerProfileInput,
  type InfluencerStatus,
  type InfluencerTrackingLinkDto,
  type InfluencerWorkspaceResponse,
} from "./types";

const focusRing =
  "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-plum";
const controlClass = `h-[34px] min-w-0 rounded-[7px] border border-line-1 bg-surface-card px-[9px] text-[11.5px] font-medium text-ink-700 outline-none focus:border-plum-border ${focusRing}`;

interface ApiErrorPayload {
  error?: string;
  code?: string;
  message?: string;
}

class InfluencerRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
  ) {
    super(message);
    this.name = "InfluencerRequestError";
  }
}

function requestId(prefix: string): string {
  if (globalThis.crypto?.randomUUID) return `${prefix}_${globalThis.crypto.randomUUID()}`;
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 14)}`;
}

function apiMessage(status: number, payload: ApiErrorPayload): string {
  if (payload.message) return payload.message;
  if (status === 401) return "Your session expired. Sign in again to continue.";
  if (status === 403) return "You do not have permission to change influencer records.";
  if (status === 404) return "This influencer profile is no longer available.";
  if (status === 409) return "This profile changed elsewhere. Reload the latest version before continuing.";
  if (status === 402) return "AI assistance is not included in this workspace plan.";
  if (status === 422) return "Check the profile details and try again.";
  if (status === 503) return "The influencer workspace is temporarily unavailable.";
  return `The influencer request failed (${status}). Please try again.`;
}

async function responseJson<T>(response: Response): Promise<T> {
  const payload = (await response.json().catch(() => ({}))) as T & ApiErrorPayload;
  if (!response.ok) throw new InfluencerRequestError(apiMessage(response.status, payload), response.status, payload.code ?? payload.error);
  return payload;
}

function profileFromPayload(payload: unknown): InfluencerProfileDto | null {
  if (!payload || typeof payload !== "object") return null;
  if ("profile" in payload) {
    const profile = (payload as { profile?: unknown }).profile;
    return profile && typeof profile === "object" ? profile as InfluencerProfileDto : null;
  }
  return "id" in payload && "version" in payload ? payload as InfluencerProfileDto : null;
}

function trackingLinkFromPayload(payload: unknown): InfluencerTrackingLinkDto | null {
  if (!payload || typeof payload !== "object") return null;
  if ("trackingLink" in payload) {
    const link = (payload as { trackingLink?: unknown }).trackingLink;
    return link && typeof link === "object" ? link as InfluencerTrackingLinkDto : null;
  }
  return "taggedDestinationUrl" in payload ? payload as InfluencerTrackingLinkDto : null;
}

function label(value: string): string {
  return value.replaceAll("_", " ").replace(/^./, (character) => character.toUpperCase());
}

function identity(profile: InfluencerProfileDto): string {
  const handle = (profile.normalizedHandle ?? profile.handle).trim().replace(/^@+/, "").toLowerCase();
  return `${profile.platform}:@${handle}`;
}

function dateLabel(value: string | null | undefined): string {
  if (!value) return "Not recorded";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "Not recorded";
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(parsed);
}

function metric(profile: InfluencerProfileDto, name: InfluencerMetricDto["metric"]): InfluencerMetricDto | null {
  return profile.metrics.find((candidate) => candidate.metric === name) ?? null;
}

function metricLabel(value: InfluencerMetricDto | null): string {
  if (!value) return "Not available";
  if (value.metric === "engagement_rate") {
    return `${new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 }).format(value.value)}%`;
  }
  return new Intl.NumberFormat(undefined, { notation: "compact", maximumFractionDigits: 1 }).format(value.value);
}

function qualificationLabel(profile: InfluencerProfileDto): string {
  const evidence = profile.qualificationEvidence?.[0];
  if (evidence) return evidence.detail ? `${evidence.label}: ${evidence.detail}` : evidence.label;
  return profile.notes?.trim() || "Not recorded";
}

function ProfileRow({
  profile,
  selected,
  onSelect,
}: {
  profile: InfluencerProfileDto;
  selected: boolean;
  onSelect: (event: ReactMouseEvent<HTMLButtonElement>) => void;
}) {
  const audience = metric(profile, "audience_size");
  const engagement = metric(profile, "engagement_rate");
  return (
    <tr className={`border-b border-line-2 last:border-b-0 ${selected ? "bg-plum-soft/60" : "bg-surface-card hover:bg-track-1/55"}`}>
      <td className="min-w-0 px-[11px] py-[10px] align-top">
        <button type="button" data-influencer-id={profile.id} onClick={onSelect} className={`block max-w-full text-left ${focusRing}`}>
          <span className="block truncate text-[12px] font-semibold text-ink-900">{profile.displayName || `@${profile.handle.replace(/^@+/, "")}`}</span>
          <span className="mt-[2px] block truncate font-mono text-[9px] text-ink-400">{identity(profile)}</span>
        </button>
      </td>
      <td className="px-[9px] py-[10px] align-top text-[10.5px] font-semibold text-ink-600">{label(profile.status)}</td>
      <td className="px-[9px] py-[10px] align-top text-[11px] text-ink-700"><span aria-label={audience ? undefined : "Audience not available"}>{metricLabel(audience)}</span></td>
      <td className="px-[9px] py-[10px] align-top text-[11px] text-ink-700"><span aria-label={engagement ? undefined : "Engagement not available"}>{metricLabel(engagement)}</span></td>
      <td className="max-w-[210px] px-[9px] py-[10px] align-top"><span className="line-clamp-2 text-[10.5px] leading-[1.4] text-ink-500">{qualificationLabel(profile)}</span></td>
      <td className="px-[9px] py-[10px] align-top text-right text-[10px] text-ink-400">{dateLabel(profile.lastActivityAt ?? profile.updatedAt)}</td>
    </tr>
  );
}

function MobileProfileRow({
  profile,
  selected,
  onSelect,
}: {
  profile: InfluencerProfileDto;
  selected: boolean;
  onSelect: (event: ReactMouseEvent<HTMLButtonElement>) => void;
}) {
  const audience = metric(profile, "audience_size");
  const engagement = metric(profile, "engagement_rate");
  return (
    <button
      type="button"
      data-influencer-id={profile.id}
      onClick={onSelect}
      className={`block w-full min-w-0 border-b border-line-2 px-[12px] py-[11px] text-left last:border-b-0 ${selected ? "bg-plum-soft/60" : "bg-surface-card"} ${focusRing}`}
    >
      <span className="flex min-w-0 items-start justify-between gap-[8px]">
        <span className="min-w-0"><span className="block truncate text-[12.5px] font-semibold text-ink-900">{profile.displayName || `@${profile.handle.replace(/^@+/, "")}`}</span><span className="mt-[2px] block truncate font-mono text-[9px] text-ink-400">{identity(profile)}</span></span>
        <span className="flex-none rounded-[6px] bg-track-1 px-[6px] py-[3px] text-[9.5px] font-semibold text-ink-500">{label(profile.status)}</span>
      </span>
      <span className="mt-[7px] grid grid-cols-2 gap-[7px] text-[10.5px] text-ink-500">
        <span>Audience <strong className="font-semibold text-ink-800">{metricLabel(audience)}</strong></span>
        <span>Engagement <strong className="font-semibold text-ink-800">{metricLabel(engagement)}</strong></span>
      </span>
      <span className="mt-[6px] block truncate text-[10px] text-ink-400">{qualificationLabel(profile)}</span>
    </button>
  );
}

function SurfaceTabs({
  onCalendar,
  onStudio,
  onSeo,
}: {
  onCalendar: () => void;
  onStudio: () => void;
  onSeo: () => void;
}) {
  return (
    <div className="mt-[12px] grid h-[36px] w-full max-w-[480px] grid-cols-4 rounded-[8px] bg-track-1 p-[3px]" aria-label="Organic workspace view">
      <button type="button" onClick={onCalendar} className={`flex min-w-0 items-center justify-center gap-[5px] rounded-[6px] px-[6px] text-[11px] font-semibold text-ink-400 sm:text-[12px] ${focusRing}`}><LuCalendarDays aria-hidden /><span className="hidden min-[430px]:inline">Calendar</span></button>
      <button type="button" onClick={onStudio} className={`flex min-w-0 items-center justify-center gap-[5px] rounded-[6px] px-[6px] text-[11px] font-semibold text-ink-400 sm:text-[12px] ${focusRing}`}><LuLayoutGrid aria-hidden /><span className="hidden min-[430px]:inline">Studio</span></button>
      <button type="button" onClick={onSeo} className={`flex min-w-0 items-center justify-center gap-[5px] rounded-[6px] px-[6px] text-[11px] font-semibold text-ink-400 sm:text-[12px] ${focusRing}`}><LuChartNoAxesCombined aria-hidden /><span className="hidden min-[430px]:inline">SEO</span></button>
      <button type="button" aria-pressed="true" className={`flex min-w-0 items-center justify-center gap-[5px] rounded-[6px] bg-surface-card px-[6px] text-[11px] font-semibold text-ink-900 shadow-sm sm:text-[12px] ${focusRing}`}><LuUsers aria-hidden /><span className="hidden min-[430px]:inline">Influencers</span></button>
    </div>
  );
}

export function InfluencerWorkspace({
  brandId,
  fetcher = globalThis.fetch,
  onCalendar,
  onStudio,
  onSeo,
  onAskAI,
}: {
  brandId: string;
  fetcher?: typeof fetch;
  onCalendar: () => void;
  onStudio: () => void;
  onSeo: () => void;
  onAskAI: (prompt: string) => void | Promise<void>;
}) {
  const [workspace, setWorkspace] = useState<InfluencerWorkspaceResponse | null>(null);
  const [loadState, setLoadState] = useState<"loading" | "ready" | "error">("loading");
  const [loadError, setLoadError] = useState("The influencer workspace could not be loaded.");
  const [mutationError, setMutationError] = useState<string | null>(null);
  const [conflict, setConflict] = useState(false);
  const [busy, setBusy] = useState(false);
  const [query, setQuery] = useState("");
  const [platformFilter, setPlatformFilter] = useState<InfluencerPlatform | "all">("all");
  const [statusFilter, setStatusFilter] = useState<InfluencerStatus | "all">("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editing, setEditing] = useState<InfluencerProfileDto | "create" | null>(null);
  const dialogOriginRef = useRef<HTMLElement | null>(null);
  const createRequestRef = useRef<string | null>(null);
  const outreachRequestRef = useRef<{ profileId: string; requestId: string } | null>(null);
  const trackingRequestRef = useRef<{ profileId: string; requestId: string } | null>(null);

  const load = useCallback(async (quiet = false): Promise<InfluencerWorkspaceResponse | null> => {
    if (!quiet) setLoadState("loading");
    try {
      const response = await fetcher(`/api/influencers?brandId=${encodeURIComponent(brandId)}`, {
        method: "GET",
        headers: { Accept: "application/json" },
      });
      const next = await responseJson<InfluencerWorkspaceResponse>(response);
      setWorkspace(next);
      setSelectedId((current) => current && next.profiles.some((profile) => profile.id === current) ? current : next.profiles[0]?.id ?? null);
      setLoadState("ready");
      return next;
    } catch (error) {
      const message = error instanceof Error ? error.message : "The influencer workspace could not be loaded.";
      if (quiet) setMutationError(message);
      else {
        setLoadError(message);
        setLoadState("error");
      }
      return null;
    }
  }, [brandId, fetcher]);

  useEffect(() => {
    void load();
  }, [load]);

  const profiles = useMemo(() => workspace?.profiles ?? [], [workspace?.profiles]);
  const visibleProfiles = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return profiles
      .filter((profile) => platformFilter === "all" || profile.platform === platformFilter)
      .filter((profile) => statusFilter === "all" || profile.status === statusFilter)
      .filter((profile) => !normalized || [
        profile.displayName,
        profile.handle,
        identity(profile),
        profile.notes,
        ...profile.topics,
        ...profile.audienceCountries,
      ].some((value) => value?.toLowerCase().includes(normalized)))
      .sort((a, b) => new Date(b.lastActivityAt ?? b.updatedAt).getTime() - new Date(a.lastActivityAt ?? a.updatedAt).getTime() || identity(a).localeCompare(identity(b)));
  }, [platformFilter, profiles, query, statusFilter]);

  useEffect(() => {
    if (selectedId && visibleProfiles.some((profile) => profile.id === selectedId)) return;
    setSelectedId(visibleProfiles[0]?.id ?? null);
  }, [selectedId, visibleProfiles]);

  const selected = profiles.find((profile) => profile.id === selectedId) ?? null;

  const openEditor = (profile: InfluencerProfileDto | "create") => {
    dialogOriginRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setMutationError(null);
    setConflict(false);
    setEditing(profile);
  };

  const closeEditor = () => {
    setEditing(null);
    setMutationError(null);
    setConflict(false);
    requestAnimationFrame(() => dialogOriginRef.current?.focus());
  };

  const applyProfile = useCallback((profile: InfluencerProfileDto) => {
    setWorkspace((current) => current ? {
      ...current,
      profiles: current.profiles.some((candidate) => candidate.id === profile.id)
        ? current.profiles.map((candidate) => candidate.id === profile.id ? profile : candidate)
        : [profile, ...current.profiles],
    } : current);
    setSelectedId(profile.id);
  }, []);

  const saveProfile = async (input: InfluencerProfileInput) => {
    if (!workspace?.capability.canManage || busy) return;
    setBusy(true);
    setMutationError(null);
    setConflict(false);
    try {
      const existing = editing && editing !== "create" ? editing : null;
      const nextRequestId = createRequestRef.current ?? requestId("influencer");
      if (!existing) createRequestRef.current = nextRequestId;
      const body = existing
        ? {
            expectedVersion: existing.version,
            ...input,
            ...(existing.source === "vendor" ? { source: undefined } : {}),
          }
        : { brandId, requestId: nextRequestId, profile: input };
      const response = await fetcher(existing ? `/api/influencers/${encodeURIComponent(existing.id)}` : "/api/influencers", {
        method: existing ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify(body),
      });
      const payload = await responseJson<unknown>(response);
      const saved = profileFromPayload(payload);
      if (saved) applyProfile(saved);
      createRequestRef.current = null;
      setEditing(null);
      await load(true);
      requestAnimationFrame(() => dialogOriginRef.current?.focus());
    } catch (error) {
      setConflict(error instanceof InfluencerRequestError && error.status === 409);
      setMutationError(error instanceof Error ? error.message : "The profile could not be saved.");
    } finally {
      setBusy(false);
    }
  };

  const patchSelected = async (fields: Record<string, unknown>) => {
    if (!selected || !workspace?.capability.canManage || busy) return;
    setBusy(true);
    setMutationError(null);
    setConflict(false);
    try {
      const response = await fetcher(`/api/influencers/${encodeURIComponent(selected.id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ expectedVersion: selected.version, ...fields }),
      });
      const payload = await responseJson<unknown>(response);
      const updated = profileFromPayload(payload);
      if (updated) applyProfile(updated);
      await load(true);
    } catch (error) {
      setConflict(error instanceof InfluencerRequestError && error.status === 409);
      setMutationError(error instanceof Error ? error.message : "The profile could not be updated.");
    } finally {
      setBusy(false);
    }
  };

  const saveOutreach = async (draft: InfluencerOutreachInput) => {
    if (!selected || !workspace?.capability.canManage || busy) return;
    setBusy(true);
    setMutationError(null);
    setConflict(false);
    const request = outreachRequestRef.current?.profileId === selected.id
      ? outreachRequestRef.current
      : { profileId: selected.id, requestId: requestId("outreach") };
    outreachRequestRef.current = request;
    try {
      const response = await fetcher(`/api/influencers/${encodeURIComponent(selected.id)}/outreach`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ expectedVersion: selected.version, requestId: request.requestId, draft }),
      });
      const payload = await responseJson<unknown>(response);
      const updated = profileFromPayload(payload);
      if (updated) applyProfile(updated);
      outreachRequestRef.current = null;
      await load(true);
    } catch (error) {
      setConflict(error instanceof InfluencerRequestError && error.status === 409);
      setMutationError(error instanceof Error ? error.message : "The outreach draft could not be saved.");
    } finally {
      setBusy(false);
    }
  };

  const createTrackingLink = async (input: { destinationUrl: string; campaignKey: string }): Promise<InfluencerTrackingLinkDto | null> => {
    if (!selected || !workspace?.capability.canManage || busy) return null;
    setBusy(true);
    setMutationError(null);
    setConflict(false);
    const request = trackingRequestRef.current?.profileId === selected.id
      ? trackingRequestRef.current
      : { profileId: selected.id, requestId: requestId("tracking") };
    trackingRequestRef.current = request;
    try {
      const response = await fetcher(`/api/influencers/${encodeURIComponent(selected.id)}/tracking-links`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ requestId: request.requestId, ...input }),
      });
      const payload = await responseJson<unknown>(response);
      const link = trackingLinkFromPayload(payload);
      const updated = profileFromPayload(payload);
      if (updated) applyProfile(updated);
      trackingRequestRef.current = null;
      await load(true);
      return link;
    } catch (error) {
      setConflict(error instanceof InfluencerRequestError && error.status === 409);
      setMutationError(error instanceof Error ? error.message : "The tracking link could not be created.");
      return null;
    } finally {
      setBusy(false);
    }
  };

  const disableTrackingLink = async (link: InfluencerTrackingLinkDto) => {
    if (!selected || !workspace?.capability.canManage || busy || !link.enabled) return;
    setBusy(true);
    setMutationError(null);
    setConflict(false);
    try {
      const response = await fetcher(
        `/api/influencers/${encodeURIComponent(selected.id)}/tracking-links/${encodeURIComponent(link.id)}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json", Accept: "application/json" },
          body: JSON.stringify({ expectedVersion: link.version }),
        },
      );
      const payload = await responseJson<unknown>(response);
      const updated = profileFromPayload(payload);
      if (updated) applyProfile(updated);
      await load(true);
    } catch (error) {
      setConflict(error instanceof InfluencerRequestError && error.status === 409);
      setMutationError(error instanceof Error ? error.message : "The tracking link could not be disabled.");
    } finally {
      setBusy(false);
    }
  };

  const reloadLatest = async () => {
    setBusy(true);
    setMutationError(null);
    const next = await load(true);
    setBusy(false);
    if (next) {
      setConflict(false);
      if (editing && editing !== "create") {
        const latest = next.profiles.find((profile) => profile.id === editing.id);
        if (latest) setEditing(latest);
        else setEditing(null);
      }
    }
  };

  const clearFilters = () => {
    setQuery("");
    setPlatformFilter("all");
    setStatusFilter("all");
  };

  return (
    <section data-testid="influencer-workspace" className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-surface-panel" aria-labelledby="influencer-workspace-title">
      <header className="flex-none border-b border-line-2 bg-surface-panel px-[14px] py-[13px] sm:px-[20px] lg:px-[24px]">
        <div className="flex min-w-0 flex-wrap items-start justify-between gap-[12px]">
          <div className="min-w-0">
            <p className="m-0 font-mono text-[9.5px] font-semibold uppercase text-ink-300">Organic + SEO</p>
            <h1 id="influencer-workspace-title" className="mb-0 mt-[2px] text-[20px] font-semibold text-ink-900">Influencer CRM</h1>
          </div>
          <div className="flex flex-wrap items-center justify-end gap-[7px]">
            {workspace?.capability.canManage && workspace.capability.aiAssistance === "available" ? (
              <button type="button" onClick={() => void onAskAI("Help me qualify the persisted influencer profiles in this workspace using only their recorded evidence. Prepare recommendations for review and do not contact anyone.")} className={`flex h-[36px] items-center gap-[6px] rounded-[7px] border border-plum-border bg-plum-soft px-[11px] text-[11.5px] font-semibold text-plum-deep ${focusRing}`}><LuSparkles aria-hidden /> Qualify with AI</button>
            ) : null}
            {workspace?.capability.canManage ? (
              <button type="button" onClick={() => openEditor("create")} className={`flex h-[36px] items-center gap-[6px] rounded-[7px] bg-plum px-[11px] text-[11.5px] font-semibold text-white ${focusRing}`}><LuPlus aria-hidden /> Add profile</button>
            ) : null}
          </div>
        </div>
        <SurfaceTabs onCalendar={onCalendar} onStudio={onStudio} onSeo={onSeo} />
      </header>

      {mutationError ? (
        <div role="alert" className="mx-[14px] mt-[10px] flex min-w-0 items-center gap-[8px] rounded-[7px] border border-line-1 bg-neg-bg px-[10px] py-[8px] text-[11.5px] text-neg-700 sm:mx-[20px]">
          <LuCircleAlert aria-hidden className="flex-none" /><span className="min-w-0 flex-1">{mutationError}</span>
          {conflict ? <button type="button" disabled={busy} onClick={() => void reloadLatest()} className={`h-[29px] flex-none rounded-[6px] border border-line-1 bg-surface-card px-[8px] text-[10.5px] font-semibold ${focusRing}`}>Reload latest</button> : null}
          <button type="button" aria-label="Dismiss influencer error" onClick={() => { setMutationError(null); setConflict(false); }} className={`flex h-[27px] w-[27px] flex-none items-center justify-center rounded-[6px] ${focusRing}`}><LuX aria-hidden /></button>
        </div>
      ) : null}

      {loadState === "loading" ? (
        <div className="grid min-h-[360px] flex-1 place-items-center" role="status" aria-live="polite"><div className="text-center"><LuRefreshCw aria-hidden className="mx-auto h-[21px] w-[21px] animate-spin text-plum motion-reduce:animate-none" /><p className="mb-0 mt-[8px] text-[12px] text-ink-400">Loading influencer workspace</p></div></div>
      ) : loadState === "error" ? (
        <div className="grid min-h-[360px] flex-1 place-items-center px-[20px] text-center" role="alert"><div className="max-w-[390px]"><LuCircleAlert aria-hidden className="mx-auto h-[23px] w-[23px] text-neg-700" /><h2 className="mb-0 mt-[10px] text-[16px] font-semibold text-ink-900">Influencer workspace unavailable</h2><p className="mb-0 mt-[5px] text-[11.5px] text-ink-400">{loadError}</p><button type="button" onClick={() => void load()} className={`mt-[13px] inline-flex h-[35px] items-center gap-[6px] rounded-[7px] border border-line-1 bg-surface-card px-[11px] text-[11.5px] font-semibold text-ink-700 ${focusRing}`}><LuRefreshCw aria-hidden /> Try again</button></div></div>
      ) : workspace ? (
        <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto lg:overflow-hidden">
          <div className="flex-none border-b border-line-2 bg-surface-card px-[14px] py-[10px] sm:px-[20px]">
            <div className="flex min-w-0 flex-wrap items-center justify-between gap-[8px]">
              <div className="flex min-w-0 flex-1 flex-wrap items-center gap-[7px]">
                <label className="relative min-w-[180px] flex-1 sm:max-w-[300px]"><span className="sr-only">Search influencer profiles</span><LuSearch aria-hidden className="pointer-events-none absolute left-[9px] top-1/2 -translate-y-1/2 text-ink-300" /><input aria-label="Search influencer profiles" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search profiles" className={`${controlClass} w-full pl-[29px]`} /></label>
                <label className="relative min-w-[128px]"><span className="sr-only">Filter by platform</span><LuListFilter aria-hidden className="pointer-events-none absolute left-[9px] top-1/2 -translate-y-1/2 text-ink-300" /><select aria-label="Filter by platform" value={platformFilter} onChange={(event) => setPlatformFilter(event.target.value as InfluencerPlatform | "all")} className={`${controlClass} w-full pl-[28px]`}><option value="all">All platforms</option>{INFLUENCER_PLATFORMS.map((platform) => <option key={platform} value={platform}>{label(platform)}</option>)}</select></label>
                <label className="min-w-[128px]"><span className="sr-only">Filter by stage</span><select aria-label="Filter by stage" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as InfluencerStatus | "all")} className={`${controlClass} w-full`}><option value="all">All stages</option>{INFLUENCER_STATUSES.map((status) => <option key={status} value={status}>{label(status)}</option>)}</select></label>
              </div>
              <span className="text-[10.5px] text-ink-400">{profiles.length.toLocaleString()} persisted profile{profiles.length === 1 ? "" : "s"}{workspace.coverage.observedAt ? ` - coverage ${dateLabel(workspace.coverage.observedAt)}` : ""}</span>
            </div>
            <div className="mt-[8px] flex min-w-0 flex-wrap items-center gap-[6px] text-[10.5px]">
              {workspace.capability.vendorDiscovery === "unavailable" ? (
                <span className="text-ink-500">Vendor discovery is unavailable. Add profiles manually or use an approved list import.</span>
              ) : <span className="text-pos-700">Vendor discovery is connected. Only persisted profiles are shown.</span>}
              {workspace.capability.aiAssistance !== "available" ? <span className="text-ink-400">{workspace.capability.aiAssistance === "upgrade_required" ? "AI assistance requires an upgrade." : "AI assistance is unavailable."}</span> : null}
            </div>
          </div>

          {!profiles.length ? (
            <div className="grid min-h-[340px] flex-1 place-items-center px-[20px] text-center">
              <div className="max-w-[410px]"><LuUsers aria-hidden className="mx-auto h-[25px] w-[25px] text-ink-300" /><h2 className="mb-0 mt-[10px] text-[16px] font-semibold text-ink-900">No influencer profiles yet</h2><p className="mb-0 mt-[5px] text-[11.5px] leading-[1.5] text-ink-400">Build a sourced prospect list manually. Unknown audience metrics can stay blank until they are observed.</p>{workspace.capability.canManage ? <button type="button" onClick={() => openEditor("create")} className={`mt-[13px] inline-flex h-[35px] items-center gap-[6px] rounded-[7px] bg-plum px-[11px] text-[11.5px] font-semibold text-white ${focusRing}`}><LuPlus aria-hidden /> Add first profile</button> : null}</div>
            </div>
          ) : !visibleProfiles.length ? (
            <div className="grid min-h-[300px] flex-1 place-items-center px-[20px] text-center"><div><LuSearch aria-hidden className="mx-auto h-[21px] w-[21px] text-ink-300" /><h2 className="mb-0 mt-[9px] text-[15px] font-semibold text-ink-900">No profiles match</h2><button type="button" onClick={clearFilters} className={`mt-[11px] h-[34px] rounded-[7px] border border-line-1 bg-surface-card px-[10px] text-[11px] font-semibold text-ink-700 ${focusRing}`}>Clear filters</button></div></div>
          ) : (
            <div className="grid min-h-0 min-w-0 flex-1 lg:grid-cols-[minmax(390px,0.92fr)_minmax(0,1.08fr)]">
              <div className="min-h-0 min-w-0 border-b border-line-2 lg:overflow-y-auto lg:border-b-0 lg:border-r">
                <div className="hidden min-w-0 md:block">
                  <table className="w-full table-fixed border-collapse" aria-label="Influencer pipeline">
                    <thead className="sticky top-0 z-10 bg-track-1 text-left text-[9px] font-semibold uppercase text-ink-400">
                      <tr><th className="w-[24%] px-[11px] py-[8px]">Account</th><th className="w-[13%] px-[9px] py-[8px]">Stage</th><th className="w-[12%] px-[9px] py-[8px]">Audience</th><th className="w-[12%] px-[9px] py-[8px]">Engagement</th><th className="w-[25%] px-[9px] py-[8px]">Qualification</th><th className="w-[14%] px-[9px] py-[8px] text-right">Activity</th></tr>
                    </thead>
                    <tbody>{visibleProfiles.map((profile) => <ProfileRow key={identity(profile)} profile={profile} selected={profile.id === selectedId} onSelect={() => setSelectedId(profile.id)} />)}</tbody>
                  </table>
                </div>
                <div className="min-w-0 md:hidden">{visibleProfiles.map((profile) => <MobileProfileRow key={identity(profile)} profile={profile} selected={profile.id === selectedId} onSelect={() => setSelectedId(profile.id)} />)}</div>
              </div>
              <div className="min-h-0 min-w-0 lg:overflow-y-auto">
                {selected ? <InfluencerProfileDetail profile={selected} capability={workspace.capability} busy={busy} onEdit={() => openEditor(selected)} onStageChange={(status) => patchSelected({ status })} onSaveOutreach={saveOutreach} onCreateTrackingLink={createTrackingLink} onDisableTrackingLink={disableTrackingLink} onAskAI={onAskAI} /> : null}
              </div>
            </div>
          )}
        </div>
      ) : null}

      {editing ? (
        <InfluencerProfileDialog
          profile={editing === "create" ? null : editing}
          busy={busy}
          error={mutationError}
          conflict={conflict}
          onClose={closeEditor}
          onSubmit={saveProfile}
          onReloadLatest={reloadLatest}
        />
      ) : null}
    </section>
  );
}
