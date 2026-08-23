import type {
  CalendarPublicationDto,
  ContentItemDto,
  OrganicCalendarPost,
  OrganicCalendarResponse,
  OrganicPlannerStatus,
  OrganicPlatform,
} from "./types";
import { ORGANIC_PLATFORMS } from "./types";

import {
  calendarDateKey,
  wallClockFromIso,
  zonedDateTimeToIso,
} from "@/lib/time/zoned";

export { calendarDateKey, wallClockFromIso, zonedDateTimeToIso };

const DATE_KEY = /^\d{4}-\d{2}-\d{2}$/;

export function todayKey(timezone: string): string {
  return calendarDateKey(new Date(), timezone);
}

function parseDateKey(date: string): Date {
  if (!DATE_KEY.test(date)) throw new Error(`Invalid calendar date: ${date}`);
  const [year, month, day] = date.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day));
}

export function addCalendarDays(date: string, days: number): string {
  const value = parseDateKey(date);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

export function addCalendarMonths(date: string, months: number): string {
  const value = parseDateKey(date);
  const day = value.getUTCDate();
  value.setUTCDate(1);
  value.setUTCMonth(value.getUTCMonth() + months);
  const lastDay = new Date(
    Date.UTC(value.getUTCFullYear(), value.getUTCMonth() + 1, 0),
  ).getUTCDate();
  value.setUTCDate(Math.min(day, lastDay));
  return value.toISOString().slice(0, 10);
}

export function startOfCalendarWeek(date: string): string {
  const value = parseDateKey(date);
  const mondayOffset = (value.getUTCDay() + 6) % 7;
  return addCalendarDays(date, -mondayOffset);
}

export function monthGridStart(date: string): string {
  const value = parseDateKey(date);
  const first = `${value.getUTCFullYear()}-${String(value.getUTCMonth() + 1).padStart(2, "0")}-01`;
  return startOfCalendarWeek(first);
}

export function isSameCalendarMonth(left: string, right: string): boolean {
  return left.slice(0, 7) === right.slice(0, 7);
}

export function formatCalendarDate(
  date: string,
  locale: string,
  options: Intl.DateTimeFormatOptions,
): string {
  return new Intl.DateTimeFormat(locale, { ...options, timeZone: "UTC" }).format(parseDateKey(date));
}

export function formatWallTime(value: string, timezone: string, locale: string): string {
  return new Intl.DateTimeFormat(locale, {
    timeZone: timezone,
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function isPlatform(value: string): value is OrganicPlatform {
  return (ORGANIC_PLATFORMS as readonly string[]).includes(value);
}

function isPublicationStatus(value: string): value is OrganicPlannerStatus {
  return [
    "draft",
    "ready",
    "scheduled",
    "publishing",
    "published",
    "failed",
    "cancelled",
  ].includes(value);
}

function normalizePublication(
  publication: CalendarPublicationDto,
  fallbackItem?: ContentItemDto,
): OrganicCalendarPost | null {
  if (!publication.scheduledAt || !isPlatform(publication.platform)) return null;
  const content = publication.contentItem ?? fallbackItem;
  return {
    publicationId: publication.id,
    contentItemId: publication.contentItemId,
    title: publication.title || content?.title || "Untitled post",
    copy: publication.body ?? content?.coreCopy ?? "",
    platform: publication.platform,
    format: publication.format,
    status: isPublicationStatus(publication.status) ? publication.status : "draft",
    scheduledAt: publication.scheduledAt,
    expectedVersion: content?.version ?? 1,
    planId: content?.planId ?? null,
  };
}

export function startOfCalendarMonth(date: string): string {
  const value = parseDateKey(date);
  return `${value.getUTCFullYear()}-${String(value.getUTCMonth() + 1).padStart(2, "0")}-01`;
}

export function normalizeCalendarResponse(payload: OrganicCalendarResponse): OrganicCalendarPost[] {
  const root = payload.calendar ?? payload.data ?? payload;
  const direct = root.publications ?? [];
  const items = root.contentItems ?? root.items ?? [];
  const itemById = new Map(items.map((item) => [item.id, item]));
  const nested = (root.items ?? []).flatMap((item) =>
    (item.publications ?? []).map((publication) => ({ publication, item })),
  );
  const byPublication = new Map<string, OrganicCalendarPost>();
  for (const publication of direct) {
    const post = normalizePublication(publication, itemById.get(publication.contentItemId));
    if (post) byPublication.set(post.publicationId, post);
  }
  for (const { publication, item } of nested) {
    const post = normalizePublication(publication, item);
    if (post) byPublication.set(post.publicationId, post);
  }
  return [...byPublication.values()].sort((left, right) =>
    left.scheduledAt.localeCompare(right.scheduledAt),
  );
}
