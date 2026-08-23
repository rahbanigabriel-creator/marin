import { NextResponse } from "next/server";

import { getCurrentWorkspace } from "@/lib/auth";
import { workspaceSeatLimitResponse } from "@/lib/auth-http";
import { isDatabaseConfigured } from "@/lib/db";
import { readPaidDashboard } from "@/lib/metrics/paid-dashboard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DEFAULT_DAYS = 30;
const MAX_DAYS = 366;

function todayUtc(): Date {
  const date = new Date();
  date.setUTCHours(0, 0, 0, 0);
  return date;
}

function parseDay(value: string | null): Date | null {
  if (!value) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!match) return null;
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  return date.getUTCFullYear() === Number(match[1])
    && date.getUTCMonth() === Number(match[2]) - 1
    && date.getUTCDate() === Number(match[3])
    ? date
    : null;
}

function daysBetween(from: Date, to: Date): number {
  return Math.round((to.getTime() - from.getTime()) / 86_400_000) + 1;
}

function resolvePaidDashboardRange(url: URL): { from: Date; to: Date } | null {
  const rawFrom = url.searchParams.get("from");
  const rawTo = url.searchParams.get("to");
  const today = todayUtc();
  const to = rawTo ? parseDay(rawTo) : today;
  if (!to || to.getTime() > today.getTime()) return null;
  let from = rawFrom ? parseDay(rawFrom) : null;
  if (rawFrom && !from) return null;
  if (!from) {
    from = new Date(to);
    from.setUTCDate(from.getUTCDate() - (DEFAULT_DAYS - 1));
  }
  if (from.getTime() > to.getTime() || daysBetween(from, to) > MAX_DAYS) return null;
  return { from, to };
}

export async function GET(request: Request): Promise<Response> {
  let workspace;
  try {
    workspace = await getCurrentWorkspace();
  } catch (error) {
    const seatLimit = workspaceSeatLimitResponse(error);
    if (seatLimit) return seatLimit;
    return NextResponse.json({ error: "authentication_unavailable" }, { status: 503 });
  }
  if (!workspace) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }
  if (!isDatabaseConfigured()) {
    return NextResponse.json({ error: "persistence_unavailable" }, { status: 503 });
  }
  const range = resolvePaidDashboardRange(new URL(request.url));
  if (!range) {
    return NextResponse.json({ error: "invalid_date_range" }, { status: 400 });
  }

  try {
    const data = await readPaidDashboard(workspace.id, range);
    const mode = data.campaigns.length > 0 || data.sources.some((source) => source.state !== "unavailable")
      ? "live"
      : "empty";
    return NextResponse.json({ mode, state: data.state, data });
  } catch {
    return NextResponse.json({ error: "persistence_unavailable" }, { status: 503 });
  }
}
