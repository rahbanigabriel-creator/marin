import { PaidProviderError } from "./paid-errors";
import type { ConnectorPlatform } from "./types";

/** Missing/blank/invalid values stay null; an explicit numeric zero stays zero. */
export function parseProviderNumber(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "string" || value.trim() === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function normalizeCurrency(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const currency = value.trim().toUpperCase();
  return /^[A-Z]{3}$/.test(currency) ? currency : null;
}

export function utcDay(value: string): Date | null {
  const normalized = /^\d{8}$/.test(value)
    ? `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}`
    : value.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) return null;
  const date = new Date(`${normalized}T00:00:00.000Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function observedRange<T>(
  items: T[],
  dateOf: (item: T) => Date | null,
): { observedFrom: Date | null; observedTo: Date | null } {
  const timestamps = items
    .map(dateOf)
    .filter((date): date is Date => date != null && !Number.isNaN(date.getTime()))
    .map((date) => date.getTime());
  if (timestamps.length === 0) return { observedFrom: null, observedTo: null };
  return {
    observedFrom: new Date(Math.min(...timestamps)),
    observedTo: new Date(Math.max(...timestamps)),
  };
}

export async function boundedPages<T>(input: {
  platform: ConnectorPlatform;
  first: string;
  fetchPage: (url: string, page: number) => Promise<{ items: T[]; next: string | null }>;
  maxPages?: number;
}): Promise<T[]> {
  const maxPages = input.maxPages ?? 100;
  const items: T[] = [];
  const seen = new Set<string>();
  let next: string | null = input.first;
  for (let page = 1; next && page <= maxPages; page += 1) {
    if (seen.has(next)) {
      throw new PaidProviderError(input.platform, "pagination_incomplete", true);
    }
    seen.add(next);
    const result = await input.fetchPage(next, page);
    items.push(...result.items);
    next = result.next;
    if (next && page === maxPages) {
      throw new PaidProviderError(input.platform, "pagination_incomplete", true);
    }
  }
  return items;
}
