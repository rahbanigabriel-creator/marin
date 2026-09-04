"use client";

import {
  type FormEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  LuCalendarDays,
  LuCheck,
  LuChartNoAxesCombined,
  LuExternalLink,
  LuFileImage,
  LuImagePlus,
  LuLayoutGrid,
  LuMessageSquare,
  LuPlus,
  LuRefreshCw,
  LuSave,
  LuSparkles,
  LuTrash2,
  LuUpload,
  LuUsers,
  LuX,
} from "react-icons/lu";

import { ORGANIC_FORMATS_BY_PLATFORM } from "@/lib/content/destinations";
import type {
  ContentAssetDto,
  ContentItemDto,
  ContentProposalDto,
  ContentPublicationDto,
  ContentStudioItemDto,
} from "@/lib/content/types";
import { MAX_ASSET_BYTES, MAX_SERVER_ASSET_BYTES } from "@/lib/storage/limits";

import { wallClockFromIso, zonedDateTimeToIso } from "./calendar-utils";
import { ORGANIC_PLATFORMS, type OrganicPlatform } from "./types";
import {
  AssistedHandoffDialog,
  type AssistedHandoffPublication,
} from "./AssistedHandoffDialog";

const focusRing =
  "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-plum";

const PLATFORM_LABELS: Record<OrganicPlatform, string> = {
  youtube: "YouTube",
  instagram: "Instagram",
  facebook: "Facebook",
  tiktok: "TikTok",
  snapchat: "Snapchat",
  reddit: "Reddit",
  pinterest: "Pinterest",
};

const PLATFORM_DOTS: Record<OrganicPlatform, string> = {
  youtube: "bg-red-600",
  instagram: "bg-fuchsia-600",
  facebook: "bg-blue-600",
  tiktok: "bg-ink-900",
  snapchat: "bg-yellow-400",
  reddit: "bg-orange-600",
  pinterest: "bg-rose-700",
};

function publicationStatusLabel(status: string): string {
  if (status === "published") return "Unverified external completion";
  if (status === "failed") return "Needs attention";
  return status.charAt(0).toUpperCase() + status.slice(1);
}

type MasterStatus = ContentItemDto["status"];

interface MasterDraft {
  title: string;
  objective: string;
  brief: string;
  coreCopy: string;
  status: MasterStatus;
}

interface VariantDraft {
  id: string | null;
  requestId: string | null;
  platform: OrganicPlatform;
  format: string;
  title: string;
  body: string;
  firstComment: string;
  linkUrl: string;
  status: "draft" | "ready";
  date: string;
  time: string;
}

interface ImageDraft {
  prompt: string;
  altText: string;
  aspectRatio: "1:1" | "4:5" | "16:9" | "9:16";
}

type PendingStudioNavigation =
  | { kind: "calendar" }
  | { kind: "seo" }
  | { kind: "influencers" }
  | { kind: "new" }
  | { kind: "select"; contentItemId: string };

interface ContentItemsPage {
  items?: ContentStudioItemDto[];
  nextCursor?: string | null;
}

interface ApiFailure {
  message?: string;
  error?: string;
  reason?: string;
  currentVersion?: number;
}

class StudioRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
    readonly currentVersion?: number,
  ) {
    super(message);
    this.name = "StudioRequestError";
  }
}

async function jsonResponse<T>(response: Response): Promise<T> {
  const payload = await response.json().catch(() => ({})) as T & ApiFailure;
  if (!response.ok) {
    throw new StudioRequestError(
      payload.message ?? payload.reason ?? payload.error ?? `Request failed (${response.status})`,
      response.status,
      payload.error,
      payload.currentVersion,
    );
  }
  return payload;
}

const dialogFocusable = [
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  '[tabindex]:not([tabindex="-1"])',
].join(",");

function useDialogFocusTrap(
  open: boolean,
  onClose: () => void,
  closeDisabled = false,
) {
  const dialogRef = useRef<HTMLElement>(null);
  const closeRef = useRef(onClose);
  const closeDisabledRef = useRef(closeDisabled);
  closeRef.current = onClose;
  closeDisabledRef.current = closeDisabled;

  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    const priorOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const frame = window.requestAnimationFrame(() => {
      const focusable = dialogRef.current?.querySelector<HTMLElement>(dialogFocusable);
      (focusable ?? dialogRef.current)?.focus();
    });
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape" && !closeDisabledRef.current) {
        event.preventDefault();
        closeRef.current();
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = [...(dialogRef.current?.querySelectorAll<HTMLElement>(dialogFocusable) ?? [])];
      if (!focusable.length) {
        event.preventDefault();
        dialogRef.current?.focus();
        return;
      }
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
      window.cancelAnimationFrame(frame);
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = priorOverflow;
      previous?.focus();
    };
  }, [open]);

  return dialogRef;
}

function masterDraft(item?: ContentItemDto | null): MasterDraft {
  return {
    title: item?.title ?? "",
    objective: item?.objective ?? "",
    brief: item?.brief ?? "",
    coreCopy: item?.coreCopy ?? "",
    status: item?.status ?? "idea",
  };
}

function variantDraft(
  publication: ContentPublicationDto | null,
  timezone: string,
): VariantDraft {
  const wall = publication?.scheduledAt
    ? wallClockFromIso(publication.scheduledAt, timezone)
    : { date: "", time: "09:00" };
  const platform = (publication?.platform ?? "instagram") as OrganicPlatform;
  return {
    id: publication?.id ?? null,
    requestId: publication ? null : globalThis.crypto.randomUUID(),
    platform,
    format: publication?.format ?? ORGANIC_FORMATS_BY_PLATFORM[platform][0],
    title: publication?.title ?? "",
    body: publication?.body ?? "",
    firstComment: publication?.firstComment ?? "",
    linkUrl: publication?.linkUrl ?? "",
    status: publication?.status === "ready" ? "ready" : "draft",
    date: wall.date,
    time: wall.time,
  };
}

function bytesLabel(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

const UPLOAD_MIME_BY_EXTENSION: Record<string, string> = {
  gif: "image/gif",
  jpeg: "image/jpeg",
  jpg: "image/jpeg",
  mov: "video/quicktime",
  mp4: "video/mp4",
  png: "image/png",
  webm: "video/webm",
  webp: "image/webp",
};

function uploadMimeType(file: File): string | null {
  const claimed = file.type.trim().toLowerCase();
  if ([
    "image/gif",
    "image/jpeg",
    "image/jpg",
    "image/png",
    "image/webp",
    "video/mp4",
    "video/quicktime",
    "video/webm",
  ].includes(claimed)) {
    return claimed === "image/jpg" ? "image/jpeg" : claimed;
  }
  const extension = file.name.split(".").at(-1)?.toLowerCase() ?? "";
  return UPLOAD_MIME_BY_EXTENSION[extension] ?? null;
}

function PrivateAssetImage({ src, alt }: { src: string; alt: string }) {
  // Private media must be fetched by the signed-in browser, not Next's shared optimizer.
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={src} alt={alt} className="h-full w-full object-cover" />;
}

function StudioAlert({
  message,
  needsReload,
  onReload,
  onDismiss,
  reloadLabel = "Reload latest",
  reloading = false,
  className = "",
}: {
  message: string;
  needsReload: boolean;
  onReload: () => void;
  onDismiss?: () => void;
  reloadLabel?: string;
  reloading?: boolean;
  className?: string;
}) {
  return (
    <div role="alert" className={`flex items-center justify-between gap-[10px] rounded-[7px] border border-line-1 bg-neg-bg px-[11px] py-[9px] text-[12px] text-neg-700 ${className}`}>
      <span>{message}</span>
      <span className="flex flex-none items-center gap-[6px]">
        {needsReload ? <button type="button" disabled={reloading} onClick={onReload} className={`flex h-[28px] items-center gap-[5px] rounded-[6px] border border-neg-700/20 px-[8px] text-[10.5px] font-semibold disabled:opacity-45 ${focusRing}`}><LuRefreshCw aria-hidden className={reloading ? "animate-spin" : ""} /> {reloading ? "Retrying…" : reloadLabel}</button> : null}
        {onDismiss ? <button type="button" aria-label="Dismiss Content Studio error" onClick={onDismiss} className={`flex h-[28px] w-[28px] items-center justify-center rounded-[6px] ${focusRing}`}><LuX aria-hidden /></button> : null}
      </span>
    </div>
  );
}

function CopyProposalPanel({
  proposal,
  onUse,
  onDiscard,
  busy,
}: {
  proposal: ContentProposalDto;
  onUse: () => void;
  onDiscard: () => void;
  busy: boolean;
}) {
  const fields = proposal.kind === "master"
    ? [
        ["Title", proposal.fields.title],
        ["Objective", proposal.fields.objective],
        ["Core copy", proposal.fields.coreCopy],
        ["Creative brief", proposal.fields.brief],
      ]
    : [
        ["Title", proposal.fields.title],
        ["Copy", proposal.fields.body],
        ["First comment", proposal.fields.firstComment],
      ];
  return (
    <section aria-label="AI copy proposal" className="rounded-[7px] border border-plum-border bg-plum-soft p-[12px]">
      <div className="flex flex-wrap items-center justify-between gap-[8px]">
        <div>
          <p className="m-0 text-[11px] font-semibold text-plum-deep">AI draft ready</p>
          <p className="mb-0 mt-[2px] text-[10px] text-ink-400">Preview before adding it to your editor</p>
        </div>
        <div className="flex gap-[7px]">
          <button type="button" disabled={busy} onClick={onDiscard} className={`h-[32px] rounded-[6px] border border-line-1 bg-surface-card px-[10px] text-[11px] font-semibold text-ink-500 disabled:opacity-45 ${focusRing}`}>Discard</button>
          <button type="button" disabled={busy} onClick={onUse} className={`flex h-[32px] items-center gap-[6px] rounded-[6px] bg-plum px-[10px] text-[11px] font-semibold text-white disabled:opacity-45 ${focusRing}`}><LuCheck aria-hidden /> Use draft</button>
        </div>
      </div>
      <div className="mt-[10px] grid gap-[8px] sm:grid-cols-2">
        {fields.filter(([, value]) => Boolean(value)).map(([label, value]) => (
          <div key={label} className="min-w-0 rounded-[6px] border border-plum-border/60 bg-surface-card px-[9px] py-[8px]">
            <span className="block text-[9.5px] font-semibold uppercase text-ink-300">{label}</span>
            <span className="mt-[4px] block whitespace-pre-wrap text-[11.5px] leading-[1.45] text-ink-700">{value}</span>
          </div>
        ))}
      </div>
    </section>
  );
}

function updateStudioItem(
  items: ContentStudioItemDto[],
  id: string,
  update: (item: ContentStudioItemDto) => ContentStudioItemDto,
): ContentStudioItemDto[] {
  return items.map((item) => item.contentItem.id === id ? update(item) : item);
}

const CONTENT_STUDIO_PAGE_SIZE = 50;

function contentItemsPageUrl(brandId: string, cursor?: string | null): string {
  const params = new URLSearchParams({
    brandId,
    limit: String(CONTENT_STUDIO_PAGE_SIZE),
  });
  if (cursor) params.set("cursor", cursor);
  return `/api/content/items?${params.toString()}`;
}

async function fetchContentItemsPage(
  brandId: string,
  cursor?: string | null,
): Promise<ContentItemsPage> {
  return fetch(contentItemsPageUrl(brandId, cursor), { cache: "no-store" })
    .then((response) => jsonResponse<ContentItemsPage>(response));
}

export function mergeContentItems(
  current: ContentStudioItemDto[],
  incoming: ContentStudioItemDto[],
): ContentStudioItemDto[] {
  const seen = new Set(current.map((item) => item.contentItem.id));
  return [
    ...current,
    ...incoming.filter((item) => !seen.has(item.contentItem.id)),
  ];
}

export async function collectContentPagesUntilTarget({
  firstPage,
  targetContentId,
  loadPage,
  onProgress,
}: {
  firstPage: ContentItemsPage;
  targetContentId?: string;
  loadPage: (cursor: string) => Promise<ContentItemsPage>;
  onProgress?: (items: ContentStudioItemDto[], nextCursor: string | null) => void;
}): Promise<{ items: ContentStudioItemDto[]; nextCursor: string | null }> {
  let items = firstPage.items ?? [];
  let nextCursor = firstPage.nextCursor ?? null;
  onProgress?.(items, nextCursor);
  const visitedCursors = new Set<string>();
  while (
    targetContentId &&
    !items.some((item) => item.contentItem.id === targetContentId) &&
    nextCursor
  ) {
    if (visitedCursors.has(nextCursor)) {
      throw new StudioRequestError(
        "Content pagination returned a repeated cursor.",
        502,
        "invalid_pagination",
      );
    }
    visitedCursors.add(nextCursor);
    const page = await loadPage(nextCursor);
    items = mergeContentItems(items, page.items ?? []);
    nextCursor = page.nextCursor ?? null;
    onProgress?.(items, nextCursor);
  }
  return { items, nextCursor };
}

export function ContentStudio({
  brandId,
  timezone,
  canManage,
  initialContentId,
  onCalendar,
  onSeo,
  onInfluencers,
  onAskAI,
}: {
  brandId: string;
  timezone: string;
  locale: string;
  canManage: boolean;
  initialContentId?: string;
  onCalendar: () => void;
  onSeo: () => void;
  onInfluencers: () => void;
  onAskAI: (prompt: string) => void | Promise<void>;
}) {
  const [items, setItems] = useState<ContentStudioItemDto[]>([]);
  const [assets, setAssets] = useState<ContentAssetDto[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [masterCreateRequestId, setMasterCreateRequestId] = useState<string | null>(null);
  const [draft, setDraft] = useState<MasterDraft>(() => masterDraft());
  const [variant, setVariant] = useState<VariantDraft | null>(null);
  const [handoffPublicationId, setHandoffPublicationId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<MasterStatus | "all">("all");
  const [assetAlt, setAssetAlt] = useState("");
  const [imageGenerationAvailable, setImageGenerationAvailable] = useState(false);
  const [imageDraft, setImageDraft] = useState<ImageDraft | null>(null);
  const [generatingImage, setGeneratingImage] = useState(false);
  const [copyProposal, setCopyProposal] = useState<ContentProposalDto | null>(null);
  const [generatingCopy, setGeneratingCopy] = useState(false);
  const [acceptedMasterProposalId, setAcceptedMasterProposalId] = useState<string | null>(null);
  const [acceptedVariantProposalId, setAcceptedVariantProposalId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [loadingMoreAssets, setLoadingMoreAssets] = useState(false);
  const [loadingMoreContent, setLoadingMoreContent] = useState(false);
  const [contentCursor, setContentCursor] = useState<string | null>(null);
  const [assetCursor, setAssetCursor] = useState<string | null>(null);
  const [assetLibraryError, setAssetLibraryError] = useState<string | null>(null);
  const [loadingAssetLibrary, setLoadingAssetLibrary] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [needsReload, setNeedsReload] = useState(false);
  const [deletingAssetId, setDeletingAssetId] = useState<string | null>(null);
  const [confirmDeleteAssetId, setConfirmDeleteAssetId] = useState<string | null>(null);
  const [pendingNavigation, setPendingNavigation] = useState<PendingStudioNavigation | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const imageRequestRef = useRef<string | null>(null);
  const copyRequestRef = useRef<{ key: string; id: string } | null>(null);
  const draftSourceRef = useRef<string | null>(null);
  const initialSelectionResolvedRef = useRef<string | null>(null);
  const masterDirtyRef = useRef(false);
  const selectedIdRef = useRef<string | null>(null);
  const creatingRef = useRef(false);
  const itemsRef = useRef<ContentStudioItemDto[]>([]);
  const variantDialogRef = useDialogFocusTrap(
    Boolean(variant),
    () => setVariant(null),
    busy,
  );
  const imageDialogRef = useDialogFocusTrap(
    Boolean(imageDraft),
    () => setImageDraft(null),
    generatingImage,
  );
  const navigationDialogRef = useDialogFocusTrap(
    Boolean(pendingNavigation),
    () => setPendingNavigation(null),
  );

  const selected = useMemo(
    () => items.find((item) => item.contentItem.id === selectedId) ?? null,
    [items, selectedId],
  );
  const locked = Boolean(selected && !canManage);
  const masterDirty = useMemo(() => {
    const baseline = creating ? masterDraft() : selected ? masterDraft(selected.contentItem) : null;
    if (!baseline) return false;
    return (
      draft.title !== baseline.title ||
      draft.objective !== baseline.objective ||
      draft.brief !== baseline.brief ||
      draft.coreCopy !== baseline.coreCopy ||
      draft.status !== baseline.status
    );
  }, [creating, draft, selected]);

  const initialSelectionKey = initialContentId
    ? `${brandId}:${initialContentId}`
    : null;
  masterDirtyRef.current = masterDirty;
  selectedIdRef.current = selectedId;
  creatingRef.current = creating;
  itemsRef.current = items;

  const resolveInitialSelection = useCallback((
    loadedItems: ContentStudioItemDto[],
    nextCursor: string | null,
  ) => {
    if (
      !initialContentId ||
      !initialSelectionKey ||
      initialSelectionResolvedRef.current === initialSelectionKey
    ) return;
    const found = loadedItems.some(
      (item) => item.contentItem.id === initialContentId,
    );
    if (!found) {
      if (!nextCursor) initialSelectionResolvedRef.current = initialSelectionKey;
      return;
    }
    initialSelectionResolvedRef.current = initialSelectionKey;
    if (
      !creatingRef.current &&
      selectedIdRef.current === initialContentId
    ) return;
    if (masterDirtyRef.current) {
      setPendingNavigation({ kind: "select", contentItemId: initialContentId });
      return;
    }
    setCreating(false);
    setMasterCreateRequestId(null);
    setSelectedId(initialContentId);
  }, [initialContentId, initialSelectionKey]);

  const performNavigation = useCallback((navigation: PendingStudioNavigation) => {
    if (navigation.kind === "calendar") {
      setMasterCreateRequestId(null);
      onCalendar();
      return;
    }
    if (navigation.kind === "seo") {
      setMasterCreateRequestId(null);
      onSeo();
      return;
    }
    if (navigation.kind === "influencers") {
      setMasterCreateRequestId(null);
      onInfluencers();
      return;
    }
    if (navigation.kind === "new") {
      setCreating(true);
      setMasterCreateRequestId(globalThis.crypto.randomUUID());
      setSelectedId(null);
      setDraft(masterDraft());
      return;
    }
    setCreating(false);
    setMasterCreateRequestId(null);
    setSelectedId(navigation.contentItemId);
  }, [onCalendar, onInfluencers, onSeo]);

  const requestNavigation = useCallback((navigation: PendingStudioNavigation) => {
    if (
      (navigation.kind === "new" && creating) ||
      (navigation.kind === "select" &&
        !creating &&
        navigation.contentItemId === selectedId)
    ) return;
    if (masterDirty) {
      setPendingNavigation(navigation);
      return;
    }
    performNavigation(navigation);
  }, [creating, masterDirty, performNavigation, selectedId]);

  useEffect(() => {
    if (!masterDirty) return;
    const warnBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warnBeforeUnload);
    return () => window.removeEventListener("beforeunload", warnBeforeUnload);
  }, [masterDirty]);

  const reportFailure = useCallback((failure: unknown, fallback: string) => {
    setError(failure instanceof Error ? failure.message : fallback);
    setNeedsReload(
      failure instanceof StudioRequestError &&
        (failure.status === 409 || failure.currentVersion !== undefined),
    );
  }, []);

  const updateHandoffPublication = useCallback((updated: AssistedHandoffPublication) => {
    setItems((current) => current.map((item) => {
      if (!item.publications.some((publication) => publication.id === updated.id)) return item;
      return {
        ...item,
        contentItem: { ...item.contentItem, version: updated.contentVersion },
        publications: item.publications.map((publication) => publication.id === updated.id
          ? {
              ...publication,
              status: updated.status,
              publishedAt: updated.publishedAt,
              permalink: updated.permalink,
              publishAttempts: updated.publishAttempts,
              lastError: updated.lastError,
            }
          : publication),
      };
    }));
  }, []);

  const loadAssetLibrary = useCallback(async () => {
    setLoadingAssetLibrary(true);
    try {
      const payload = await fetch("/api/assets", { cache: "no-store" }).then((response) =>
        jsonResponse<{
          assets?: ContentAssetDto[];
          capabilities?: { imageGeneration?: boolean };
          nextCursor?: string | null;
        }>(response));
      setAssets(payload.assets ?? []);
      setAssetCursor(payload.nextCursor ?? null);
      setImageGenerationAvailable(Boolean(payload.capabilities?.imageGeneration));
      setAssetLibraryError(null);
    } catch (loadError) {
      setAssetLibraryError(
        loadError instanceof Error
          ? loadError.message
          : "The media library is temporarily unavailable.",
      );
    } finally {
      setLoadingAssetLibrary(false);
    }
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    setNeedsReload(false);
    try {
      const [firstPage] = await Promise.all([
        fetchContentItemsPage(brandId),
        loadAssetLibrary(),
      ]);
      const targetContentId = (
        initialContentId &&
        initialSelectionKey &&
        initialSelectionResolvedRef.current !== initialSelectionKey
      ) ? initialContentId : undefined;
      const alreadyLoadedTarget = targetContentId
        ? itemsRef.current.find((item) => item.contentItem.id === targetContentId)
        : undefined;
      await collectContentPagesUntilTarget({
        firstPage: alreadyLoadedTarget
          ? {
              ...firstPage,
              items: mergeContentItems(firstPage.items ?? [], [alreadyLoadedTarget]),
            }
          : firstPage,
        targetContentId,
        loadPage: (cursor) => fetchContentItemsPage(brandId, cursor),
        onProgress: (incoming, nextCursor) => {
          const dirtySelection = masterDirtyRef.current
            ? itemsRef.current.find((item) => item.contentItem.id === selectedIdRef.current)
            : undefined;
          const visibleItems = dirtySelection
            ? mergeContentItems(incoming, [dirtySelection])
            : incoming;
          setItems(visibleItems);
          setContentCursor(nextCursor);
          setSelectedId((current) =>
            current && visibleItems.some((item) => item.contentItem.id === current)
              ? current
              : visibleItems[0]?.contentItem.id ?? null,
          );
          resolveInitialSelection(visibleItems, nextCursor);
        },
      });
    } catch (loadError) {
      reportFailure(loadError, "Content Studio could not be loaded.");
    } finally {
      setLoading(false);
    }
  }, [
    brandId,
    initialContentId,
    initialSelectionKey,
    loadAssetLibrary,
    reportFailure,
    resolveInitialSelection,
  ]);

  const loadMoreContent = useCallback(async () => {
    const cursor = contentCursor;
    if (!cursor || loadingMoreContent) return;
    setLoadingMoreContent(true);
    setError(null);
    setNeedsReload(false);
    try {
      const page = await fetchContentItemsPage(brandId, cursor);
      const incoming = page.items ?? [];
      const nextCursor = page.nextCursor ?? null;
      const merged = mergeContentItems(itemsRef.current, incoming);
      setItems(merged);
      setContentCursor(nextCursor);
      resolveInitialSelection(merged, nextCursor);
    } catch (loadError) {
      reportFailure(loadError, "More content could not be loaded.");
    } finally {
      setLoadingMoreContent(false);
    }
  }, [
    brandId,
    contentCursor,
    loadingMoreContent,
    reportFailure,
    resolveInitialSelection,
  ]);

  useEffect(() => {
    void load();
  }, [load]);

  const recoverLatest = useCallback(() => {
    setVariant(null);
    setImageDraft(null);
    imageRequestRef.current = null;
    draftSourceRef.current = null;
    void load();
  }, [load]);

  useEffect(() => {
    const sourceKey = creating
      ? `${brandId}:new`
      : selected
        ? `${brandId}:${selected.contentItem.id}`
        : null;
    if (draftSourceRef.current === sourceKey) return;
    draftSourceRef.current = sourceKey;
    if (!creating) setDraft(masterDraft(selected?.contentItem));
    setVariant(null);
    setCopyProposal(null);
    setAcceptedMasterProposalId(null);
    setAcceptedVariantProposalId(null);
    copyRequestRef.current = null;
  }, [brandId, creating, selected]);

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    return items.filter((item) =>
      (statusFilter === "all" || item.contentItem.status === statusFilter) &&
      (!query || item.contentItem.title.toLowerCase().includes(query)),
    );
  }, [items, search, statusFilter]);

  const saveMaster = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!draft.title.trim() || (!creating && !masterDirty)) return;
    setBusy(true);
    setError(null);
    setNeedsReload(false);
    try {
      const response = await fetch(
        creating ? "/api/content/items" : `/api/content/items/${encodeURIComponent(selectedId ?? "")}`,
        {
          method: creating ? "POST" : "PATCH",
          headers: { "Content-Type": "application/json", Accept: "application/json" },
          body: JSON.stringify({
            ...(creating
              ? { brandId, requestId: masterCreateRequestId }
              : { expectedVersion: selected?.contentItem.version }),
            title: draft.title.trim(),
            objective: draft.objective.trim() || null,
            brief: draft.brief.trim() || null,
            coreCopy: draft.coreCopy.trim() || null,
            status: draft.status,
            ...(!creating && acceptedMasterProposalId
              ? { proposalId: acceptedMasterProposalId }
              : {}),
          }),
        },
      );
      const payload = await jsonResponse<{ contentItem: ContentItemDto }>(response);
      if (creating) {
        const next = { contentItem: payload.contentItem, publications: [], assets: [] };
        setItems((current) => [next, ...current]);
        setSelectedId(payload.contentItem.id);
        setCreating(false);
        setMasterCreateRequestId(null);
      } else if (selected) {
        setItems((current) => updateStudioItem(current, selected.contentItem.id, (item) => ({
          ...item,
          contentItem: payload.contentItem,
        })));
        setDraft(masterDraft(payload.contentItem));
      }
      setAcceptedMasterProposalId(null);
    } catch (saveError) {
      reportFailure(saveError, "The content item could not be saved.");
    } finally {
      setBusy(false);
    }
  };

  const approveMaster = async () => {
    if (
      !selected ||
      !canManage ||
      masterDirty ||
      selected.contentItem.status !== "review"
    ) return;
    setBusy(true);
    setError(null);
    setNeedsReload(false);
    try {
      const response = await fetch(
        `/api/content/items/${encodeURIComponent(selected.contentItem.id)}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json", Accept: "application/json" },
          body: JSON.stringify({
            expectedVersion: selected.contentItem.version,
            status: "approved",
            approvalIntent: true,
          }),
        },
      );
      const payload = await jsonResponse<{ contentItem: ContentItemDto }>(response);
      setItems((current) => updateStudioItem(current, selected.contentItem.id, (item) => ({
        ...item,
        contentItem: payload.contentItem,
      })));
      setDraft(masterDraft(payload.contentItem));
    } catch (approvalError) {
      reportFailure(approvalError, "The content item could not be approved.");
    } finally {
      setBusy(false);
    }
  };

  const saveVariant = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!selected || !variant?.body.trim()) return;
    setBusy(true);
    setError(null);
    setNeedsReload(false);
    try {
      const scheduledAt = variant.date
        ? zonedDateTimeToIso(variant.date, variant.time || "09:00", timezone)
        : null;
      const response = await fetch(
        variant.id
          ? `/api/content/variants/${encodeURIComponent(variant.id)}`
          : `/api/content/items/${encodeURIComponent(selected.contentItem.id)}/variants`,
        {
          method: variant.id ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json", Accept: "application/json" },
          body: JSON.stringify({
            expectedVersion: selected.contentItem.version,
            ...(!variant.id ? { requestId: variant.requestId } : {}),
            platform: variant.platform,
            format: variant.format,
            title: variant.title.trim() || null,
            body: variant.body.trim(),
            firstComment: variant.firstComment.trim() || null,
            linkUrl: variant.linkUrl.trim() || null,
            status: variant.status,
            scheduledAt,
            ...(acceptedVariantProposalId
              ? { proposalId: acceptedVariantProposalId }
              : {}),
          }),
        },
      );
      const payload = await jsonResponse<{
        post: { contentItem: ContentItemDto; publication: ContentPublicationDto };
      }>(response);
      setItems((current) => updateStudioItem(current, selected.contentItem.id, (item) => ({
        ...item,
        contentItem: payload.post.contentItem,
        publications: variant.id
          ? item.publications.map((entry) =>
              entry.id === payload.post.publication.id ? payload.post.publication : entry)
          : [payload.post.publication, ...item.publications],
      })));
      setDraft((current) => ({ ...current, status: payload.post.contentItem.status }));
      setAcceptedVariantProposalId(null);
      setVariant(null);
    } catch (saveError) {
      reportFailure(saveError, "The channel variant could not be saved.");
    } finally {
      setBusy(false);
    }
  };

  const removeVariant = async () => {
    if (!selected || !variant?.id) return;
    setBusy(true);
    setError(null);
    setNeedsReload(false);
    try {
      const response = await fetch(`/api/content/variants/${encodeURIComponent(variant.id)}`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ expectedVersion: selected.contentItem.version }),
      });
      const payload = await jsonResponse<{
        contentItem: ContentItemDto;
        contentItemVersion: number;
      }>(response);
      setItems((current) => updateStudioItem(current, selected.contentItem.id, (item) => ({
        ...item,
        contentItem: payload.contentItem,
        publications: item.publications.filter((entry) => entry.id !== variant.id),
      })));
      setDraft((current) => ({ ...current, status: payload.contentItem.status }));
      setVariant(null);
    } catch (removeError) {
      reportFailure(removeError, "The channel variant could not be removed.");
    } finally {
      setBusy(false);
    }
  };

  const uploadAsset = async (file: File) => {
    setUploading(true);
    setError(null);
    setNeedsReload(false);
    try {
      if (file.size <= 0 || file.size > MAX_ASSET_BYTES) {
        throw new Error("Choose a file between 1 byte and 30 MB.");
      }
      const mimeType = uploadMimeType(file);
      if (!mimeType) {
        throw new Error("Use a PNG, JPEG, WebP, GIF, MP4, MOV, or WebM file.");
      }

      let payload: { asset?: ContentAssetDto; reason?: string };
      if (file.size <= MAX_SERVER_ASSET_BYTES) {
        const form = new FormData();
        form.append("file", file);
        const response = await fetch("/api/assets", { method: "POST", body: form });
        payload = await jsonResponse<{ asset?: ContentAssetDto; reason?: string }>(response);
      } else {
        const reservationResponse = await fetch("/api/assets/reservations", {
          method: "POST",
          headers: { "Content-Type": "application/json", Accept: "application/json" },
          body: JSON.stringify({ filename: file.name, bytes: file.size, mimeType }),
        });
        const reservation = await jsonResponse<{
          reservationId: string;
          pathname: string;
          uploadUrl: string;
        }>(reservationResponse);
        const uploadResponse = await fetch(reservation.uploadUrl, {
          method: "PUT",
          headers: { "Content-Type": mimeType },
          body: file,
        });
        if (!uploadResponse.ok) {
          throw new Error(`The private media upload failed (${uploadResponse.status}).`);
        }

        let completionError: unknown = null;
        payload = {};
        for (let attempt = 0; attempt < 3; attempt += 1) {
          try {
            const completeResponse = await fetch(
              `/api/assets/reservations/${encodeURIComponent(reservation.reservationId)}/complete`,
              {
                method: "POST",
                headers: { "Content-Type": "application/json", Accept: "application/json" },
                body: JSON.stringify({ pathname: reservation.pathname }),
              },
            );
            payload = await jsonResponse<{ asset?: ContentAssetDto }>(completeResponse);
            completionError = null;
            break;
          } catch (completeError) {
            completionError = completeError;
            if (!(completeError instanceof StudioRequestError) || completeError.status !== 503) {
              break;
            }
            await new Promise((resolve) => window.setTimeout(resolve, 350 * (attempt + 1)));
          }
        }
        if (completionError) throw completionError;
      }
      if (!payload.asset) {
        throw new Error(payload.reason ?? "Asset storage is not configured.");
      }
      const uploadedAsset = payload.asset;
      setAssets((current) => [
        uploadedAsset,
        ...current.filter((asset) => asset.id !== uploadedAsset.id),
      ]);
    } catch (uploadError) {
      reportFailure(uploadError, "The asset could not be uploaded.");
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const attachAsset = async (asset: ContentAssetDto) => {
    if (!selected) return;
    setBusy(true);
    setError(null);
    setNeedsReload(false);
    try {
      const response = await fetch(
        `/api/content/items/${encodeURIComponent(selected.contentItem.id)}/assets`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json", Accept: "application/json" },
          body: JSON.stringify({
            expectedVersion: selected.contentItem.version,
            assetId: asset.id,
            role: selected.assets.length ? "media" : "cover",
            position: selected.assets.length,
            altText: assetAlt.trim() || null,
          }),
        },
      );
      const payload = await jsonResponse<{
        contentItem: ContentItemDto;
        link: ContentStudioItemDto["assets"][number];
      }>(response);
      setItems((current) => updateStudioItem(current, selected.contentItem.id, (item) => ({
        ...item,
        contentItem: payload.contentItem,
        assets: [
          ...item.assets.filter((entry) => entry.asset.id !== payload.link.asset.id),
          payload.link,
        ],
      })));
      setDraft((current) => ({ ...current, status: payload.contentItem.status }));
      setAssetAlt("");
    } catch (attachError) {
      reportFailure(attachError, "The asset could not be attached.");
    } finally {
      setBusy(false);
    }
  };

  const detachAsset = async (linkId: string) => {
    if (!selected) return;
    setBusy(true);
    setError(null);
    setNeedsReload(false);
    try {
      const response = await fetch(
        `/api/content/items/${encodeURIComponent(selected.contentItem.id)}/assets/${encodeURIComponent(linkId)}`,
        {
          method: "DELETE",
          headers: { "Content-Type": "application/json", Accept: "application/json" },
          body: JSON.stringify({ expectedVersion: selected.contentItem.version }),
        },
      );
      const payload = await jsonResponse<{
        contentItem: ContentItemDto;
        contentItemVersion: number;
      }>(response);
      setItems((current) => updateStudioItem(current, selected.contentItem.id, (item) => ({
        ...item,
        contentItem: payload.contentItem,
        assets: item.assets.filter((entry) => entry.id !== linkId),
      })));
      setDraft((current) => ({ ...current, status: payload.contentItem.status }));
    } catch (detachError) {
      reportFailure(detachError, "The asset could not be detached.");
    } finally {
      setBusy(false);
    }
  };

  const deleteAsset = async (asset: ContentAssetDto) => {
    setDeletingAssetId(asset.id);
    setError(null);
    setNeedsReload(false);
    try {
      const response = await fetch(`/api/assets/${encodeURIComponent(asset.id)}`, {
        method: "DELETE",
        headers: { Accept: "application/json" },
      });
      await jsonResponse<{ assetId?: string; deleted?: boolean }>(response);
      setAssets((current) => current.filter((entry) => entry.id !== asset.id));
      setConfirmDeleteAssetId(null);
    } catch (deleteError) {
      reportFailure(deleteError, "The asset could not be deleted.");
    } finally {
      setDeletingAssetId(null);
    }
  };

  const loadMoreAssets = async () => {
    if (!assetCursor || loadingMoreAssets) return;
    setLoadingMoreAssets(true);
    setError(null);
    setNeedsReload(false);
    try {
      const response = await fetch(`/api/assets?cursor=${encodeURIComponent(assetCursor)}`, {
        cache: "no-store",
      });
      const payload = await jsonResponse<{
        assets?: ContentAssetDto[];
        nextCursor?: string | null;
      }>(response);
      setAssets((current) => {
        const byId = new Map(current.map((asset) => [asset.id, asset]));
        for (const asset of payload.assets ?? []) byId.set(asset.id, asset);
        return [...byId.values()];
      });
      setAssetCursor(payload.nextCursor ?? null);
    } catch (loadError) {
      reportFailure(loadError, "More media could not be loaded.");
    } finally {
      setLoadingMoreAssets(false);
    }
  };

  const generateCopyProposal = async (kind: "master" | "variant") => {
    if (!selected || (kind === "variant" && !variant)) return;
    const key = [
      selected.contentItem.id,
      selected.contentItem.version,
      kind,
      kind === "variant" ? variant?.id ?? "new" : "master",
      kind === "variant" ? variant?.platform : "",
      kind === "variant" ? variant?.format : "",
    ].join(":");
    const requestId = copyRequestRef.current?.key === key
      ? copyRequestRef.current.id
      : globalThis.crypto.randomUUID();
    copyRequestRef.current = { key, id: requestId };
    setGeneratingCopy(true);
    setCopyProposal(null);
    setError(null);
    setNeedsReload(false);
    try {
      const response = await fetch(
        `/api/content/items/${encodeURIComponent(selected.contentItem.id)}/proposals`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json", Accept: "application/json" },
          body: JSON.stringify({
            expectedVersion: selected.contentItem.version,
            requestId,
            kind,
            ...(kind === "variant" && variant
              ? {
                  publicationId: variant.id,
                  platform: variant.platform,
                  format: variant.format,
                }
              : {}),
          }),
        },
      );
      const payload = await jsonResponse<{ proposal: ContentProposalDto }>(response);
      setCopyProposal(payload.proposal);
      copyRequestRef.current = null;
    } catch (generationError) {
      reportFailure(generationError, "The AI copy draft could not be generated.");
    } finally {
      setGeneratingCopy(false);
    }
  };

  const useCopyProposal = () => {
    if (!copyProposal) return;
    if (copyProposal.kind === "master") {
      setDraft((current) => ({
        ...current,
        ...copyProposal.fields,
        status: current.status === "approved" ? "review" : current.status,
      }));
      setAcceptedMasterProposalId(copyProposal.id);
    } else if (variant) {
      setVariant({
        ...variant,
        title: copyProposal.fields.title,
        body: copyProposal.fields.body,
        firstComment: copyProposal.fields.firstComment,
      });
      setAcceptedVariantProposalId(copyProposal.id);
    }
    setCopyProposal(null);
  };

  const discardCopyProposal = async () => {
    if (!copyProposal) return;
    const dismissed = copyProposal;
    setGeneratingCopy(true);
    setError(null);
    setNeedsReload(false);
    try {
      const response = await fetch(
        `/api/content/proposals/${encodeURIComponent(dismissed.id)}`,
        { method: "DELETE", headers: { Accept: "application/json" } },
      );
      await jsonResponse<{ dismissed: true }>(response);
      setCopyProposal(null);
    } catch (dismissError) {
      reportFailure(dismissError, "The AI draft could not be discarded.");
    } finally {
      setGeneratingCopy(false);
    }
  };

  const generateImage = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!selected || !imageDraft?.prompt.trim()) return;
    const requestId = imageRequestRef.current ?? globalThis.crypto.randomUUID();
    imageRequestRef.current = requestId;
    setGeneratingImage(true);
    setError(null);
    setNeedsReload(false);
    try {
      const response = await fetch(
        `/api/content/items/${encodeURIComponent(selected.contentItem.id)}/generate-image`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json", Accept: "application/json" },
          body: JSON.stringify({
            expectedVersion: selected.contentItem.version,
            requestId,
            prompt: imageDraft.prompt.trim(),
            aspectRatio: imageDraft.aspectRatio,
            altText: imageDraft.altText.trim() || null,
          }),
        },
      );
      const payload = await jsonResponse<{
        contentItem: ContentItemDto;
        link: ContentStudioItemDto["assets"][number];
      }>(response);
      setItems((current) => updateStudioItem(current, selected.contentItem.id, (item) => ({
        ...item,
        contentItem: payload.contentItem,
        assets: [...item.assets, payload.link],
      })));
      setDraft((current) => ({ ...current, status: payload.contentItem.status }));
      setAssets((current) => [
        payload.link.asset,
        ...current.filter((asset) => asset.id !== payload.link.asset.id),
      ]);
      imageRequestRef.current = null;
      setImageDraft(null);
    } catch (generationError) {
      reportFailure(generationError, "The visual could not be generated.");
    } finally {
      setGeneratingImage(false);
    }
  };

  const field = `w-full rounded-[7px] border border-line-1 bg-surface-card px-[10px] py-[8px] text-[13px] text-ink-900 outline-none focus:border-plum-border disabled:cursor-not-allowed disabled:bg-track-1 disabled:text-ink-400 ${focusRing}`;

  return (
    <section className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-surface-panel" aria-labelledby="content-studio-title">
      <header className="flex-none border-b border-line-2 bg-surface-panel px-[14px] py-[13px] sm:px-[20px] lg:px-[24px]">
        <div className="flex min-w-0 flex-wrap items-center justify-between gap-[12px]">
          <div>
            <p className="m-0 font-mono text-[9.5px] font-semibold uppercase tracking-[0.08em] text-ink-300">Organic + SEO</p>
            <h1 id="content-studio-title" className="mb-0 mt-[2px] text-[20px] font-semibold text-ink-900">Content Studio</h1>
          </div>
          <div className="flex flex-wrap items-center gap-[7px]">
            <button type="button" disabled={!canManage || !selected || creating || locked || generatingCopy} onClick={() => void generateCopyProposal("master")} className={`flex h-[36px] items-center gap-[7px] rounded-[7px] border border-plum-border bg-plum-soft px-[11px] text-[12px] font-semibold text-plum-deep disabled:cursor-not-allowed disabled:opacity-45 ${focusRing}`}>
              {generatingCopy && !variant ? <LuRefreshCw aria-hidden className="animate-spin" /> : <LuSparkles aria-hidden />} {generatingCopy && !variant ? "Drafting…" : "Draft with AI"}
            </button>
            <button type="button" disabled={!canManage || busy} onClick={() => requestNavigation({ kind: "new" })} className={`flex h-[36px] items-center gap-[7px] rounded-[7px] bg-plum px-[12px] text-[12px] font-semibold text-white disabled:cursor-not-allowed disabled:opacity-45 ${focusRing}`}>
              <LuPlus aria-hidden /> New idea
            </button>
          </div>
        </div>
        <div className="mt-[12px] grid h-[36px] w-full max-w-[480px] grid-cols-4 rounded-[8px] bg-track-1 p-[3px]" aria-label="Organic workspace view">
          <button type="button" disabled={busy} onClick={() => requestNavigation({ kind: "calendar" })} className={`flex min-w-0 items-center justify-center gap-[5px] rounded-[6px] px-[6px] text-[11px] font-semibold text-ink-400 disabled:opacity-45 sm:text-[12px] ${focusRing}`}><LuCalendarDays aria-hidden /><span className="hidden min-[430px]:inline">Calendar</span></button>
          <button type="button" aria-pressed="true" className={`flex min-w-0 items-center justify-center gap-[5px] rounded-[6px] bg-surface-card px-[6px] text-[11px] font-semibold text-ink-900 shadow-sm sm:text-[12px] ${focusRing}`}><LuLayoutGrid aria-hidden /><span className="hidden min-[430px]:inline">Studio</span></button>
          <button type="button" disabled={busy} onClick={() => requestNavigation({ kind: "seo" })} className={`flex min-w-0 items-center justify-center gap-[5px] rounded-[6px] px-[6px] text-[11px] font-semibold text-ink-400 disabled:opacity-45 sm:text-[12px] ${focusRing}`}><LuChartNoAxesCombined aria-hidden /><span className="hidden min-[430px]:inline">SEO</span></button>
          <button type="button" disabled={busy} onClick={() => requestNavigation({ kind: "influencers" })} className={`flex min-w-0 items-center justify-center gap-[5px] rounded-[6px] px-[6px] text-[11px] font-semibold text-ink-400 disabled:opacity-45 sm:text-[12px] ${focusRing}`}><LuUsers aria-hidden /><span className="hidden min-[430px]:inline">Influencers</span></button>
        </div>
      </header>

      {error && !variant && !imageDraft ? <StudioAlert message={error} needsReload={needsReload} onReload={() => void load()} onDismiss={() => { setError(null); setNeedsReload(false); }} className="mx-[14px] mt-[10px] sm:mx-[20px]" /> : null}

      <div className="grid min-h-0 flex-1 grid-cols-1 overflow-hidden lg:grid-cols-[300px_minmax(0,1fr)]">
        <aside className="min-h-0 border-b border-line-2 bg-surface-card lg:border-b-0 lg:border-r">
          <div className="grid grid-cols-[1fr_112px] gap-[7px] border-b border-line-2 p-[12px]">
            <input aria-label="Search content" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search ideas" className={field} />
            <select aria-label="Filter content status" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as MasterStatus | "all")} className={field}>
              <option value="all">All status</option>
              <option value="idea">Ideas</option>
              <option value="draft">Drafts</option>
              <option value="review">Review</option>
              <option value="approved">Approved</option>
              <option value="archived">Archived</option>
            </select>
          </div>
          <div className="max-h-[230px] overflow-y-auto p-[8px] lg:max-h-none lg:min-h-0 lg:h-[calc(100%-66px)]">
            {loading ? <p role="status" className="m-0 p-[14px] text-[12px] text-ink-400">Loading content…</p> : null}
            {!loading && !filtered.length ? <p className="m-0 p-[14px] text-[12px] text-ink-400">No content found.</p> : null}
            <div className="grid gap-[5px]">
              {filtered.map((item) => {
                const active = item.contentItem.id === selectedId && !creating;
                return (
                  <button key={item.contentItem.id} type="button" disabled={busy} onClick={() => requestNavigation({ kind: "select", contentItemId: item.contentItem.id })} className={`min-w-0 rounded-[7px] border px-[10px] py-[9px] text-left disabled:opacity-45 ${focusRing} ${active ? "border-plum-border bg-plum-soft" : "border-transparent hover:border-line-2 hover:bg-track-1"}`}>
                    <span className="block truncate text-[12.5px] font-semibold text-ink-900">{item.contentItem.title}</span>
                    <span className="mt-[4px] flex items-center justify-between gap-[6px] text-[10.5px] text-ink-400">
                      <span className="capitalize">{item.contentItem.status}</span>
                      <span>{item.publications.length} {item.publications.length === 1 ? "variant" : "variants"}</span>
                    </span>
                  </button>
                );
              })}
            </div>
            {contentCursor ? (
              <button type="button" disabled={loadingMoreContent} onClick={() => void loadMoreContent()} className={`mx-auto mt-[8px] flex h-[34px] items-center gap-[6px] rounded-[7px] border border-line-1 bg-surface-panel px-[11px] text-[11px] font-semibold text-ink-600 disabled:opacity-45 ${focusRing}`}>
                {loadingMoreContent ? <LuRefreshCw aria-hidden className="animate-spin" /> : null}
                {loadingMoreContent ? "Loading…" : "Load more content"}
              </button>
            ) : null}
          </div>
        </aside>

        <div className="min-h-0 overflow-y-auto px-[14px] py-[16px] sm:px-[20px] lg:px-[26px] lg:py-[22px]">
          {!selected && !creating ? (
            <div className="grid min-h-[360px] place-items-center text-center">
              <div><LuLayoutGrid aria-hidden className="mx-auto h-[24px] w-[24px] text-ink-300" /><h2 className="mb-0 mt-[10px] text-[17px] font-semibold text-ink-900">No content yet</h2>{canManage ? <button type="button" disabled={busy} onClick={() => requestNavigation({ kind: "new" })} className={`mt-[14px] h-[36px] rounded-[7px] bg-plum px-[13px] text-[12px] font-semibold text-white disabled:opacity-45 ${focusRing}`}>Create first idea</button> : <p className="mb-0 mt-[6px] text-[12px] text-ink-400">This workspace is read-only for your role.</p>}</div>
            </div>
          ) : (
            <div className="mx-auto max-w-[980px]">
              <form onSubmit={saveMaster} className="border-b border-line-2 pb-[22px]">
                <div className="flex flex-wrap items-start justify-between gap-[10px]">
                  <div><p className="m-0 font-mono text-[9.5px] font-semibold uppercase tracking-[0.08em] text-ink-300">Master content</p><h2 className="mb-0 mt-[2px] text-[18px] font-semibold text-ink-900">{creating ? "New idea" : selected?.contentItem.title}</h2></div>
                  <div className="flex gap-[7px]">
                    {canManage && !creating && selected?.contentItem.status === "review" ? <button type="button" disabled={busy || masterDirty} title={masterDirty ? "Save changes before approval" : "Approve this saved version"} onClick={() => void approveMaster()} className={`flex h-[36px] items-center gap-[7px] rounded-[7px] border border-pos-500 bg-pos-bg px-[12px] text-[12px] font-semibold text-pos-700 disabled:opacity-45 ${focusRing}`}><LuCheck aria-hidden /> Approve</button> : null}
                    <button type="submit" disabled={busy || locked || !draft.title.trim() || (!creating && !masterDirty)} className={`flex h-[36px] items-center gap-[7px] rounded-[7px] bg-ink-900 px-[12px] text-[12px] font-semibold text-white disabled:opacity-45 ${focusRing}`}><LuSave aria-hidden /> {busy ? "Saving…" : "Save master"}</button>
                  </div>
                </div>
                {copyProposal?.kind === "master" ? <div className="mt-[13px]"><CopyProposalPanel proposal={copyProposal} busy={generatingCopy} onUse={useCopyProposal} onDiscard={() => void discardCopyProposal()} /></div> : null}
                <div className="mt-[15px] grid gap-[13px]">
                  <label className="grid gap-[5px]"><span className="text-[11px] font-semibold text-ink-500">Title</span><input required disabled={locked} value={draft.title} onChange={(event) => setDraft((current) => ({ ...current, title: event.target.value, status: current.status === "approved" ? "review" : current.status }))} className={field} /></label>
                  <div className="grid gap-[12px] md:grid-cols-2">
                    <label className="grid gap-[5px]"><span className="text-[11px] font-semibold text-ink-500">Objective</span><input disabled={locked} value={draft.objective} onChange={(event) => setDraft((current) => ({ ...current, objective: event.target.value, status: current.status === "approved" ? "review" : current.status }))} className={field} /></label>
                    <label className="grid gap-[5px]"><span className="text-[11px] font-semibold text-ink-500">Status</span><select disabled={locked} value={draft.status} onChange={(event) => setDraft((current) => ({ ...current, status: event.target.value as MasterStatus }))} className={field}><option value="idea">Idea</option><option value="draft">Draft</option>{canManage ? <option value="review">Review</option> : null}{draft.status === "approved" ? <option value="approved">Approved</option> : null}<option value="archived">Archived</option></select></label>
                  </div>
                  <label className="grid gap-[5px]"><span className="text-[11px] font-semibold text-ink-500">Core copy</span><textarea disabled={locked} rows={5} value={draft.coreCopy} onChange={(event) => setDraft((current) => ({ ...current, coreCopy: event.target.value, status: current.status === "approved" ? "review" : current.status }))} className={`${field} resize-y leading-[1.5]`} /></label>
                  <label className="grid gap-[5px]"><span className="text-[11px] font-semibold text-ink-500">Creative brief</span><textarea disabled={locked} rows={3} value={draft.brief} onChange={(event) => setDraft((current) => ({ ...current, brief: event.target.value, status: current.status === "approved" ? "review" : current.status }))} className={`${field} resize-y leading-[1.5]`} /></label>
                </div>
              </form>

              {selected && !creating ? (
                <>
                  <section className="border-b border-line-2 py-[22px]" aria-labelledby="studio-variants-title">
                    <div className="flex flex-wrap items-center justify-between gap-[10px]"><div><h2 id="studio-variants-title" className="m-0 text-[16px] font-semibold text-ink-900">Channel variants</h2><p className="mb-0 mt-[3px] text-[11px] text-ink-400">{selected.publications.length} destinations</p></div><div className="flex gap-[7px]"><button type="button" disabled={!canManage} onClick={() => void onAskAI(`Discuss how to adapt "${selected.contentItem.title}" across ${ORGANIC_PLATFORMS.map((platform) => PLATFORM_LABELS[platform]).join(", ")} while preserving the core idea.`)} className={`flex h-[34px] items-center gap-[6px] rounded-[7px] border border-plum-border bg-plum-soft px-[10px] text-[11.5px] font-semibold text-plum-deep disabled:cursor-not-allowed disabled:opacity-45 ${focusRing}`}><LuMessageSquare aria-hidden /> Discuss with AI</button><button type="button" disabled={locked} onClick={() => { setCopyProposal(null); setAcceptedVariantProposalId(null); setVariant(variantDraft(null, timezone)); }} className={`flex h-[34px] items-center gap-[6px] rounded-[7px] border border-line-1 bg-surface-card px-[10px] text-[11.5px] font-semibold text-ink-700 disabled:opacity-45 ${focusRing}`}><LuPlus aria-hidden /> Add variant</button></div></div>
                    <div className="mt-[13px] grid gap-[8px] sm:grid-cols-2 xl:grid-cols-3">
                      {selected.publications.map((publication) => {
                        const platform = publication.platform as OrganicPlatform;
                        const editable = publication.status === "draft" || publication.status === "ready";
                        const hasHandoff = publication.status !== "draft";
                        const handoffLabel = publication.status === "ready"
                          ? "Finish externally"
                          : publication.status === "failed"
                            ? "Try assisted handoff"
                            : "View handoff";
                        return (
                          <article key={publication.id} className="min-w-0 overflow-hidden rounded-[7px] border border-line-2 bg-surface-card">
                            <button
                              type="button"
                              disabled={!canManage || !editable}
                              title={editable ? "Edit channel variant" : "Publishing history is read-only"}
                              onClick={() => {
                                setCopyProposal(null);
                                setAcceptedVariantProposalId(null);
                                setVariant(variantDraft(publication, timezone));
                              }}
                              className={`block w-full min-w-0 p-[11px] text-left enabled:hover:bg-track-1 disabled:cursor-default ${focusRing}`}
                            >
                              <span className="flex items-center gap-[6px]"><span className={`h-[7px] w-[7px] rounded-full ${PLATFORM_DOTS[platform] ?? "bg-ink-300"}`} /><span className="text-[11px] font-semibold text-ink-700">{PLATFORM_LABELS[platform] ?? publication.platform} · {publication.format}</span></span>
                              <span className="mt-[7px] block truncate text-[12.5px] font-semibold text-ink-900">{publication.title || selected.contentItem.title}</span>
                              <span className="mt-[5px] flex justify-between text-[10.5px] text-ink-400"><span>{publicationStatusLabel(publication.status)}</span><span>{publication.publishedAt ? "Provider confirmation unavailable" : publication.scheduledAt ? "Planned" : "Unscheduled"}</span></span>
                            </button>
                            {hasHandoff ? (
                              <button
                                type="button"
                                onClick={() => setHandoffPublicationId(publication.id)}
                                className={`flex h-[34px] w-full items-center justify-center gap-[6px] border-t border-line-2 bg-plum-soft px-[9px] text-[11px] font-semibold text-plum-deep hover:bg-plum-soft/70 ${focusRing}`}
                              >
                                <LuExternalLink aria-hidden /> {handoffLabel}
                              </button>
                            ) : null}
                          </article>
                        );
                      })}
                      {!selected.publications.length ? <button type="button" disabled={locked} onClick={() => { setCopyProposal(null); setAcceptedVariantProposalId(null); setVariant(variantDraft(null, timezone)); }} className={`grid min-h-[104px] place-items-center rounded-[7px] border border-dashed border-line-1 text-[12px] text-ink-400 disabled:opacity-45 ${focusRing}`}><span><LuPlus aria-hidden className="mx-auto mb-[5px]" />Add first variant</span></button> : null}
                    </div>
                  </section>

                  <section className="py-[22px]" aria-labelledby="studio-assets-title">
                    <div className="flex flex-wrap items-center justify-between gap-[10px]"><div><h2 id="studio-assets-title" className="m-0 text-[16px] font-semibold text-ink-900">Media</h2><p className="mb-0 mt-[3px] text-[11px] text-ink-400">{assetLibraryError ? `${selected.assets.length} attached · library unavailable` : `${selected.assets.length} attached · ${assets.length} in library`}</p></div><div className="flex gap-[7px]"><button type="button" disabled={!canManage || !imageGenerationAvailable || locked} title={imageGenerationAvailable ? "Generate a private visual" : "Image generation and private media storage are not configured"} onClick={() => { imageRequestRef.current = null; setImageDraft({ prompt: selected.contentItem.brief ?? "", altText: "", aspectRatio: "4:5" }); }} className={`flex h-[34px] items-center gap-[6px] rounded-[7px] border border-plum-border bg-plum-soft px-[10px] text-[11.5px] font-semibold text-plum-deep disabled:cursor-not-allowed disabled:opacity-45 ${focusRing}`}><LuSparkles aria-hidden /> AI visual</button><div><input ref={fileRef} disabled={!canManage} type="file" accept="image/png,image/jpeg,image/webp,image/gif,video/mp4,video/quicktime,video/webm" className="sr-only" onChange={(event) => { const file = event.target.files?.[0]; if (file) void uploadAsset(file); }} /><button type="button" disabled={!canManage || uploading} onClick={() => fileRef.current?.click()} className={`flex h-[34px] items-center gap-[6px] rounded-[7px] border border-line-1 bg-surface-card px-[10px] text-[11.5px] font-semibold text-ink-700 disabled:cursor-not-allowed disabled:opacity-45 ${focusRing}`}>{uploading ? <LuRefreshCw aria-hidden className="animate-spin" /> : <LuUpload aria-hidden />} {uploading ? "Uploading…" : "Upload"}</button></div></div></div>
                    {assetLibraryError ? <StudioAlert message={assetLibraryError} needsReload onReload={() => void loadAssetLibrary()} reloadLabel="Retry media" reloading={loadingAssetLibrary} className="mt-[12px]" /> : null}
                    {selected.assets.length ? <div className="mt-[12px] grid gap-[8px] sm:grid-cols-2 lg:grid-cols-3">{selected.assets.map((link) => <article key={link.id} className="relative overflow-hidden rounded-[7px] border border-line-2 bg-surface-card"><div className="aspect-video bg-track-1">{link.asset.kind === "image" ? <PrivateAssetImage src={link.asset.contentUrl} alt={link.altText ?? ""} /> : <div className="grid h-full place-items-center"><LuFileImage aria-hidden className="text-ink-300" /></div>}</div><div className="flex items-center justify-between gap-[7px] px-[9px] py-[8px]"><span className="min-w-0 truncate text-[10.5px] text-ink-500">{link.altText || link.asset.filename || "Media"}</span><button type="button" disabled={busy || locked} onClick={() => void detachAsset(link.id)} aria-label={`Detach ${link.asset.filename ?? "asset"}`} className={`flex h-[27px] w-[27px] flex-none items-center justify-center rounded-[6px] text-neg-700 disabled:opacity-40 ${focusRing}`}><LuTrash2 aria-hidden /></button></div></article>)}</div> : null}
                    <div className="mt-[14px] grid gap-[9px]">
                      <label className="grid gap-[5px]"><span className="text-[11px] font-semibold text-ink-500">Alt text for next attachment</span><input disabled={locked} value={assetAlt} onChange={(event) => setAssetAlt(event.target.value)} placeholder="Describe the visual" className={field} /></label>
                      <div className="grid gap-[8px] sm:grid-cols-2 lg:grid-cols-4">
                        {assets.map((asset) => {
                          const filename = asset.filename || "Generated media";
                          const attached = selected.assets.some((link) => link.asset.id === asset.id);
                          const confirmingDelete = confirmDeleteAssetId === asset.id;
                          const deleting = deletingAssetId === asset.id;
                          return (
                            <article key={asset.id} className={`overflow-hidden rounded-[7px] border bg-surface-card ${attached ? "border-pos-500" : "border-line-2"}`}>
                              <button
                                type="button"
                                disabled={busy || locked || attached || deleting}
                                onClick={() => void attachAsset(asset)}
                                aria-label={`Attach ${filename}`}
                                className={`block aspect-[4/3] w-full bg-track-1 disabled:cursor-not-allowed disabled:opacity-55 ${focusRing}`}
                              >
                                {asset.kind === "image" ? <PrivateAssetImage src={asset.contentUrl} alt="" /> : <span className="grid h-full place-items-center"><LuFileImage aria-hidden /></span>}
                              </button>
                              {confirmingDelete ? (
                                <div className="grid grid-cols-2 gap-[5px] border-t border-line-2 p-[6px]">
                                  <button type="button" disabled={deleting} onClick={() => setConfirmDeleteAssetId(null)} className={`h-[28px] rounded-[6px] border border-line-1 text-[10px] font-semibold text-ink-600 disabled:opacity-40 ${focusRing}`}>Cancel</button>
                                  <button type="button" disabled={deleting} onClick={() => void deleteAsset(asset)} aria-label={`Confirm delete ${filename}`} className={`flex h-[28px] items-center justify-center gap-[4px] rounded-[6px] bg-neg-700 px-[6px] text-[10px] font-semibold text-white disabled:opacity-40 ${focusRing}`}>{deleting ? <LuRefreshCw aria-hidden className="animate-spin" /> : <LuTrash2 aria-hidden />} Delete</button>
                                </div>
                              ) : (
                                <div className="flex min-h-[36px] items-center justify-between gap-[5px] border-t border-line-2 px-[8px] py-[5px] text-[10px] text-ink-500">
                                  <span className="min-w-0 truncate" title={filename}>{filename}</span>
                                  {attached ? <LuCheck aria-label="Attached" className="flex-none text-pos-700" /> : (
                                    <span className="flex flex-none items-center gap-[3px]">
                                      <span>{bytesLabel(asset.bytes)}</span>
                                      {canManage ? <button type="button" onClick={() => setConfirmDeleteAssetId(asset.id)} aria-label={`Delete ${filename}`} className={`flex h-[26px] w-[26px] items-center justify-center rounded-[6px] text-neg-700 ${focusRing}`}><LuTrash2 aria-hidden /></button> : null}
                                    </span>
                                  )}
                                </div>
                              )}
                            </article>
                          );
                        })}
                      </div>
                      {assetCursor ? <button type="button" disabled={loadingMoreAssets} onClick={() => void loadMoreAssets()} className={`mx-auto flex h-[34px] items-center gap-[6px] rounded-[7px] border border-line-1 bg-surface-card px-[11px] text-[11px] font-semibold text-ink-600 disabled:opacity-45 ${focusRing}`}>{loadingMoreAssets ? <LuRefreshCw aria-hidden className="animate-spin" /> : null}{loadingMoreAssets ? "Loading…" : "Load more media"}</button> : null}
                      {!assets.length && !assetLibraryError ? <button type="button" disabled={uploading} onClick={() => fileRef.current?.click()} className={`grid min-h-[100px] place-items-center rounded-[7px] border border-dashed border-line-1 text-[12px] text-ink-400 ${focusRing}`}><span><LuImagePlus aria-hidden className="mx-auto mb-[5px]" />Upload media</span></button> : null}
                    </div>
                  </section>
                </>
              ) : null}
            </div>
          )}
        </div>
      </div>

      {pendingNavigation ? (
        <div className="fixed inset-0 z-[110] flex items-end justify-center bg-black/25 sm:items-center sm:p-[18px]" role="presentation">
          <section ref={navigationDialogRef} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="discard-master-title" aria-describedby="discard-master-description" className="w-full rounded-t-[8px] border border-line-1 bg-surface-panel shadow-modal sm:max-w-[440px] sm:rounded-[8px]">
            <div className="px-[18px] pb-[8px] pt-[18px]">
              <h2 id="discard-master-title" className="m-0 text-[17px] font-semibold text-ink-900">Discard unsaved changes?</h2>
              <p id="discard-master-description" className="mb-0 mt-[7px] text-[12.5px] leading-[1.55] text-ink-500">Your edits to this master have not been saved. Cancel to keep editing, or discard them and continue.</p>
            </div>
            <footer className="flex justify-end gap-[8px] px-[18px] pb-[18px] pt-[10px]">
              <button type="button" onClick={() => setPendingNavigation(null)} className={`h-[36px] rounded-[7px] border border-line-1 bg-surface-card px-[12px] text-[12px] font-semibold text-ink-600 ${focusRing}`}>Cancel</button>
              <button type="button" onClick={() => { const navigation = pendingNavigation; setPendingNavigation(null); performNavigation(navigation); }} className={`h-[36px] rounded-[7px] bg-neg-700 px-[13px] text-[12px] font-semibold text-white ${focusRing}`}>Discard changes</button>
            </footer>
          </section>
        </div>
      ) : null}

      {variant && selected ? (
        <div className="fixed inset-0 z-[95] flex items-end justify-center bg-black/25 sm:items-center sm:p-[18px]" role="presentation">
          <section ref={variantDialogRef} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="variant-editor-title" className="max-h-[94dvh] w-full overflow-y-auto rounded-t-[8px] border border-line-1 bg-surface-panel shadow-modal sm:max-w-[680px] sm:rounded-[8px]">
            <header className="sticky top-0 z-10 flex items-center justify-between border-b border-line-2 bg-surface-panel px-[18px] py-[13px]"><div><p className="m-0 font-mono text-[9px] font-semibold uppercase tracking-[0.08em] text-ink-300">Channel variant</p><h2 id="variant-editor-title" className="mb-0 mt-[2px] text-[17px] font-semibold text-ink-900">{variant.id ? "Edit variant" : "Add variant"}</h2></div><button type="button" aria-label="Close variant editor" onClick={() => { setCopyProposal(null); setVariant(null); }} className={`flex h-[32px] w-[32px] items-center justify-center rounded-[7px] border border-line-1 bg-surface-card ${focusRing}`}><LuX aria-hidden /></button></header>
            <form onSubmit={saveVariant} className="grid gap-[13px] px-[18px] py-[16px]">
              {error ? <StudioAlert message={error} needsReload={needsReload} onReload={recoverLatest} onDismiss={() => { setError(null); setNeedsReload(false); }} /> : null}
              <div className="flex flex-wrap items-center justify-between gap-[8px] rounded-[7px] border border-line-2 bg-surface-card px-[10px] py-[9px]"><div><p className="m-0 text-[11px] font-semibold text-ink-700">AI copy assist</p><p className="mb-0 mt-[2px] text-[10px] text-ink-400">Uses the master idea and this destination</p></div><button type="button" disabled={locked || generatingCopy} onClick={() => void generateCopyProposal("variant")} className={`flex h-[32px] items-center gap-[6px] rounded-[6px] border border-plum-border bg-plum-soft px-[10px] text-[11px] font-semibold text-plum-deep disabled:opacity-45 ${focusRing}`}>{generatingCopy ? <LuRefreshCw aria-hidden className="animate-spin" /> : <LuSparkles aria-hidden />} {generatingCopy ? "Generating…" : "Generate with AI"}</button></div>
              {copyProposal?.kind === "variant" ? <CopyProposalPanel proposal={copyProposal} busy={generatingCopy} onUse={useCopyProposal} onDiscard={() => void discardCopyProposal()} /> : null}
              <div className="grid gap-[11px] sm:grid-cols-2"><label className="grid gap-[5px]"><span className="text-[11px] font-semibold text-ink-500">Platform</span><select disabled={locked} value={variant.platform} onChange={(event) => { const platform = event.target.value as OrganicPlatform; setCopyProposal(null); setAcceptedVariantProposalId(null); setVariant({ ...variant, platform, format: ORGANIC_FORMATS_BY_PLATFORM[platform][0] }); }} className={field}>{ORGANIC_PLATFORMS.map((platform) => <option key={platform} value={platform}>{PLATFORM_LABELS[platform]}</option>)}</select></label><label className="grid gap-[5px]"><span className="text-[11px] font-semibold text-ink-500">Format</span><select disabled={locked} value={variant.format} onChange={(event) => { setCopyProposal(null); setAcceptedVariantProposalId(null); setVariant({ ...variant, format: event.target.value }); }} className={field}>{ORGANIC_FORMATS_BY_PLATFORM[variant.platform].map((format) => <option key={format} value={format}>{format}</option>)}</select></label></div>
              <label className="grid gap-[5px]"><span className="text-[11px] font-semibold text-ink-500">Variant title</span><input disabled={locked} value={variant.title} onChange={(event) => setVariant({ ...variant, title: event.target.value })} className={field} /></label>
              <label className="grid gap-[5px]"><span className="flex justify-between text-[11px] font-semibold text-ink-500"><span>Copy</span><span>{variant.body.length.toLocaleString()}</span></span><textarea required disabled={locked} rows={7} maxLength={20_000} value={variant.body} onChange={(event) => setVariant({ ...variant, body: event.target.value })} className={`${field} resize-y leading-[1.5]`} /></label>
              <div className="grid gap-[11px] sm:grid-cols-2"><label className="grid gap-[5px]"><span className="text-[11px] font-semibold text-ink-500">First comment</span><textarea disabled={locked} rows={2} value={variant.firstComment} onChange={(event) => setVariant({ ...variant, firstComment: event.target.value })} className={`${field} resize-y`} /></label><label className="grid gap-[5px]"><span className="text-[11px] font-semibold text-ink-500">Link</span><input type="url" disabled={locked} value={variant.linkUrl} onChange={(event) => setVariant({ ...variant, linkUrl: event.target.value })} className={field} /></label></div>
              <div className="grid grid-cols-2 gap-[11px] sm:grid-cols-3"><label className="grid gap-[5px]"><span className="text-[11px] font-semibold text-ink-500">Date</span><input type="date" disabled={locked} value={variant.date} onChange={(event) => setVariant({ ...variant, date: event.target.value })} className={field} /></label><label className="grid gap-[5px]"><span className="text-[11px] font-semibold text-ink-500">Time</span><input type="time" disabled={locked || !variant.date} value={variant.time} onChange={(event) => setVariant({ ...variant, time: event.target.value })} className={field} /></label><label className="col-span-2 grid gap-[5px] sm:col-span-1"><span className="text-[11px] font-semibold text-ink-500">Status</span><select disabled={locked} value={variant.status} onChange={(event) => setVariant({ ...variant, status: event.target.value as "draft" | "ready" })} className={field}><option value="draft">Draft</option>{canManage ? <option value="ready">Ready for review</option> : null}</select></label></div>
              <footer className="mt-[3px] flex items-center justify-between border-t border-line-2 pt-[13px]"><span>{variant.id && !locked ? <button type="button" disabled={busy} onClick={() => void removeVariant()} className={`flex h-[36px] items-center gap-[6px] rounded-[7px] px-[9px] text-[12px] font-semibold text-neg-700 ${focusRing}`}><LuTrash2 aria-hidden /> Remove</button> : null}</span><span className="flex gap-[8px]"><button type="button" onClick={() => { setCopyProposal(null); setVariant(null); }} className={`h-[36px] rounded-[7px] border border-line-1 bg-surface-card px-[12px] text-[12px] font-semibold text-ink-600 ${focusRing}`}>Cancel</button><button type="submit" disabled={busy || locked || !variant.body.trim()} className={`h-[36px] rounded-[7px] bg-plum px-[13px] text-[12px] font-semibold text-white disabled:opacity-45 ${focusRing}`}>{busy ? "Saving…" : "Save variant"}</button></span></footer>
            </form>
          </section>
        </div>
      ) : null}

      {handoffPublicationId ? (
        <AssistedHandoffDialog
          publicationId={handoffPublicationId}
          onClose={() => setHandoffPublicationId(null)}
          onUpdated={updateHandoffPublication}
        />
      ) : null}

      {imageDraft && selected ? (
        <div className="fixed inset-0 z-[96] flex items-end justify-center bg-black/25 sm:items-center sm:p-[18px]" role="presentation">
          <section ref={imageDialogRef} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="image-generator-title" className="max-h-[94dvh] w-full overflow-y-auto rounded-t-[8px] border border-line-1 bg-surface-panel shadow-modal sm:max-w-[590px] sm:rounded-[8px]">
            <header className="flex items-center justify-between border-b border-line-2 px-[18px] py-[13px]"><div><p className="m-0 font-mono text-[9px] font-semibold uppercase tracking-[0.08em] text-ink-300">AI image · private asset</p><h2 id="image-generator-title" className="mb-0 mt-[2px] text-[17px] font-semibold text-ink-900">Generate visual</h2></div><button type="button" aria-label="Close image generator" disabled={generatingImage} onClick={() => setImageDraft(null)} className={`flex h-[32px] w-[32px] items-center justify-center rounded-[7px] border border-line-1 bg-surface-card disabled:opacity-40 ${focusRing}`}><LuX aria-hidden /></button></header>
            <form onSubmit={generateImage} className="grid gap-[13px] px-[18px] py-[16px]">
              {error ? <StudioAlert message={error} needsReload={needsReload} onReload={recoverLatest} onDismiss={() => { setError(null); setNeedsReload(false); }} /> : null}
              <label className="grid gap-[5px]"><span className="flex justify-between text-[11px] font-semibold text-ink-500"><span>Creative direction</span><span>{imageDraft.prompt.length}/2500</span></span><textarea required autoFocus disabled={generatingImage} rows={6} maxLength={2500} value={imageDraft.prompt} onChange={(event) => { imageRequestRef.current = null; setImageDraft({ ...imageDraft, prompt: event.target.value }); }} placeholder="Describe the subject, composition, mood, and details that must appear" className={`${field} resize-y leading-[1.5]`} /></label>
              <div className="grid gap-[11px] sm:grid-cols-2"><label className="grid gap-[5px]"><span className="text-[11px] font-semibold text-ink-500">Aspect ratio</span><select disabled={generatingImage} value={imageDraft.aspectRatio} onChange={(event) => { imageRequestRef.current = null; setImageDraft({ ...imageDraft, aspectRatio: event.target.value as ImageDraft["aspectRatio"] }); }} className={field}><option value="1:1">Square · 1:1</option><option value="4:5">Portrait · 4:5</option><option value="9:16">Story · 9:16</option><option value="16:9">Landscape · 16:9</option></select></label><label className="grid gap-[5px]"><span className="text-[11px] font-semibold text-ink-500">Alt text</span><input disabled={generatingImage} maxLength={500} value={imageDraft.altText} onChange={(event) => { imageRequestRef.current = null; setImageDraft({ ...imageDraft, altText: event.target.value }); }} placeholder="Describe the finished visual" className={field} /></label></div>
              <footer className="mt-[3px] flex items-center justify-between border-t border-line-2 pt-[13px]"><span className="text-[10.5px] text-ink-400">1K image · 4 credits</span><span className="flex gap-[8px]"><button type="button" disabled={generatingImage} onClick={() => setImageDraft(null)} className={`h-[36px] rounded-[7px] border border-line-1 bg-surface-card px-[12px] text-[12px] font-semibold text-ink-600 disabled:opacity-40 ${focusRing}`}>Cancel</button><button type="submit" disabled={generatingImage || !imageDraft.prompt.trim()} className={`flex h-[36px] items-center gap-[7px] rounded-[7px] bg-plum px-[13px] text-[12px] font-semibold text-white disabled:opacity-45 ${focusRing}`}>{generatingImage ? <LuRefreshCw aria-hidden className="animate-spin" /> : <LuSparkles aria-hidden />} {generatingImage ? "Generating…" : "Generate · 4 credits"}</button></span></footer>
            </form>
          </section>
        </div>
      ) : null}
    </section>
  );
}
