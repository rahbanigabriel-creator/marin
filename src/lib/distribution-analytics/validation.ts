import type { AnalyticsRangeInternal } from "./types";

export const DEFAULT_ANALYTICS_DAYS = 30;
export const MAX_ANALYTICS_DAYS = 366;

export class AnalyticsRangeError extends Error {
  readonly code = "invalid_date_range";

  constructor(message: string) {
    super(message);
    this.name = "AnalyticsRangeError";
  }
}

function utcDay(value: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  if (parsed.getUTCFullYear() !== year || parsed.getUTCMonth() !== month - 1 || parsed.getUTCDate() !== day) {
    return null;
  }
  return parsed;
}

function startOfUtcDay(value: Date): Date {
  return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()));
}

function addUtcDays(value: Date, days: number): Date {
  const result = new Date(value);
  result.setUTCDate(result.getUTCDate() + days);
  return result;
}

export function analyticsDayKey(value: Date): string {
  return value.toISOString().slice(0, 10);
}

export function parseAnalyticsRange(searchParams: URLSearchParams, now = new Date()): AnalyticsRangeInternal {
  for (const key of searchParams.keys()) {
    if (key !== "from" && key !== "to") throw new AnalyticsRangeError("Only from and to are supported.");
  }
  if (searchParams.getAll("from").length > 1 || searchParams.getAll("to").length > 1) {
    throw new AnalyticsRangeError("Date parameters must not be repeated.");
  }

  const rawFrom = searchParams.get("from");
  const rawTo = searchParams.get("to");
  if ((rawFrom === null) !== (rawTo === null)) {
    throw new AnalyticsRangeError("Provide both from and to, or neither.");
  }

  const to = rawTo === null ? startOfUtcDay(now) : utcDay(rawTo);
  if (!to) throw new AnalyticsRangeError("to must be a real YYYY-MM-DD UTC date.");
  const from = rawFrom === null ? addUtcDays(to, -(DEFAULT_ANALYTICS_DAYS - 1)) : utcDay(rawFrom);
  if (!from) throw new AnalyticsRangeError("from must be a real YYYY-MM-DD UTC date.");
  if (from.getTime() > to.getTime()) throw new AnalyticsRangeError("from must not be after to.");

  const days = Math.round((to.getTime() - from.getTime()) / 86_400_000) + 1;
  if (days > MAX_ANALYTICS_DAYS) throw new AnalyticsRangeError(`Date range cannot exceed ${MAX_ANALYTICS_DAYS} days.`);
  return { from, to, toExclusive: addUtcDays(to, 1), days };
}

export function analyticsRangeParams(range: AnalyticsRangeInternal) {
  return {
    from: analyticsDayKey(range.from),
    to: analyticsDayKey(range.to),
    days: range.days,
    timezone: "UTC" as const,
  };
}
