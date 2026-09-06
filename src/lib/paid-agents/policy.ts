export const GOALS = ["min_roas", "max_cpa", "max_spend"] as const;
export type PaidGoal = (typeof GOALS)[number];
export const WINDOWS = [1, 7, 14, 30] as const;
export const CADENCES = [6, 12, 24] as const;
export const MAX_POLICIES = 20;
export const CHECK_TTL_MS = 15 * 60_000;
export const MANUAL_COOLDOWN_MS = 60 * 60_000;
export const MAX_FACTS = 5_000;
export const BATCH_SIZE = 10;
export const PAID_AGENT_EVENT = "paid-agent/check.requested";

export interface PolicyInput {
  name: string;
  connectionId: string;
  goal: PaidGoal;
  threshold: number;
  windowDays: number;
  minSpend: number;
  minConversions: number;
  cadenceHours: number;
}

export class PaidAgentError extends Error {
  constructor(readonly code: string, message: string, readonly status = 409) {
    super(message);
  }
}

export function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new PaidAgentError("invalid_request", "A JSON object is required", 422);
  }
  return value as Record<string, unknown>;
}

export function exactKeys(row: Record<string, unknown>, keys: string[]) {
  if (Object.keys(row).some((key) => !keys.includes(key))) {
    throw new PaidAgentError("invalid_request", "Unexpected request fields", 422);
  }
}

export function identifier(value: unknown): string {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]{1,191}$/.test(value)) {
    throw new PaidAgentError("invalid_request", "Invalid identifier", 422);
  }
  return value;
}

export function version(value: unknown): number {
  if (!Number.isSafeInteger(value) || (value as number) < 1) {
    throw new PaidAgentError("invalid_request", "A policy version is required", 422);
  }
  return value as number;
}

export function parsePolicy(value: unknown): PolicyInput {
  const row = object(value);
  exactKeys(row, ["name", "connectionId", "goal", "threshold", "windowDays", "minSpend", "minConversions", "cadenceHours"]);
  if (typeof row.name !== "string" || !row.name.trim() || row.name.trim().length > 100 ||
    !GOALS.includes(row.goal as PaidGoal) || !WINDOWS.includes(row.windowDays as 1) ||
    !CADENCES.includes(row.cadenceHours as 6) ||
    typeof row.threshold !== "number" || !Number.isFinite(row.threshold) || row.threshold <= 0 || row.threshold > 1e9 ||
    typeof row.minSpend !== "number" || !Number.isFinite(row.minSpend) || row.minSpend < 1 || row.minSpend > 1e9 ||
    !Number.isSafeInteger(row.minConversions) || (row.minConversions as number) < 1 || (row.minConversions as number) > 1e6) {
    throw new PaidAgentError("invalid_policy", "Choose a valid goal, positive threshold and minimum sample, and supported window and cadence", 422);
  }
  return { ...row, name: row.name.trim(), connectionId: identifier(row.connectionId) } as unknown as PolicyInput;
}

export function completedWindow(now: Date, timezone: string, days: number) {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now);
  const part = (type: string) => parts.find((p) => p.type === type)!.value;
  const today = Date.parse(`${part("year")}-${part("month")}-${part("day")}T00:00:00.000Z`);
  return { from: new Date(today - days * 86_400_000), to: new Date(today - 86_400_000) };
}

export const goalLabel = (goal: string) => goal === "min_roas" ? "Minimum ROAS" : goal === "max_cpa" ? "Maximum CPA" : "Window spend alert";
