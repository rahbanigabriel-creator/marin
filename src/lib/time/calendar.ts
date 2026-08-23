const DEFAULT_TIME_ZONE = "UTC";

export interface AgentCalendarContext {
  timeZone: string;
  today: string;
  nextWeekStart: string;
  nextWeekEnd: string;
}

function validTimeZone(value: string | undefined): string {
  if (!value) return DEFAULT_TIME_ZONE;
  try {
    new Intl.DateTimeFormat("en-GB", { timeZone: value }).format(new Date());
    return value;
  } catch {
    return DEFAULT_TIME_ZONE;
  }
}

export function resolvePlanningTimeZone(input: {
  brand?: string | null;
  workspace?: string | null;
  browser?: string | null;
}): string {
  for (const candidate of [input.brand, input.workspace, input.browser]) {
    if (!candidate) continue;
    try {
      new Intl.DateTimeFormat("en-GB", { timeZone: candidate }).format(new Date());
      return candidate;
    } catch {
      // Continue to the next persisted/fallback source.
    }
  }
  return DEFAULT_TIME_ZONE;
}

function zonedDateParts(date: Date, timeZone: string): { year: number; month: number; day: number } {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((part) => part.type === type)?.value);
  return { year: value("year"), month: value("month"), day: value("day") };
}

function dateOnly(year: number, month: number, day: number): Date {
  return new Date(Date.UTC(year, month - 1, day, 12));
}

function addDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function formatDateOnly(date: Date): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "UTC",
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  }).format(date);
}

/**
 * Build an explicit planning clock for the model. Date-only arithmetic happens
 * at UTC noon, so DST transitions cannot shift a calendar day.
 */
export function buildAgentCalendarContext(
  now: Date = new Date(),
  requestedTimeZone?: string,
): AgentCalendarContext {
  const timeZone = validTimeZone(requestedTimeZone);
  const parts = zonedDateParts(now, timeZone);
  const today = dateOnly(parts.year, parts.month, parts.day);
  const day = today.getUTCDay();
  const daysUntilNextMonday = ((8 - day) % 7) || 7;
  const nextWeekStart = addDays(today, daysUntilNextMonday);
  const nextWeekEnd = addDays(nextWeekStart, 6);
  return {
    timeZone,
    today: formatDateOnly(today),
    nextWeekStart: formatDateOnly(nextWeekStart),
    nextWeekEnd: formatDateOnly(nextWeekEnd),
  };
}

/** Weekday validation for structured calendar output and tests. */
export function weekdayForIsoDate(isoDate: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate);
  if (!match) throw new Error("Expected an ISO date in YYYY-MM-DD format");
  return new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", weekday: "long" }).format(
    dateOnly(Number(match[1]), Number(match[2]), Number(match[3])),
  );
}
