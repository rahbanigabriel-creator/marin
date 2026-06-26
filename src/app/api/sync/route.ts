import { NextResponse } from "next/server";

import { getCurrentWorkspace } from "@/lib/auth";
import { isDatabaseConfigured } from "@/lib/db";
import { backfillWorkspace, syncWorkspace } from "@/lib/jobs/inngest";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Above this requested depth (days) we run the chunked historical backfill. */
const BACKFILL_THRESHOLD_DAYS = 30;

/**
 * On-demand metric sync for the current workspace — the same `syncWorkspace`
 * the Inngest job runs, exposed so connecting a platform pulls data immediately
 * (and a "Sync now" button can refresh it) without depending on Inngest being
 * fully wired. Authenticated + workspace-scoped; safe-fails without a DB.
 *
 * `?days=N` pulls history N days back: ≤30 is the quick recent sync, >30 runs
 * the chunked historical backfill so the date picker gains real depth. Runs
 * synchronously (the user's data is small); Inngest does the same in background.
 */
export async function POST(request: Request): Promise<Response> {
  const workspace = await getCurrentWorkspace();
  if (!workspace) {
    return NextResponse.json({ ok: false, error: "no_workspace" }, { status: 401 });
  }
  if (!isDatabaseConfigured()) {
    return NextResponse.json({ ok: false, error: "database_not_configured" }, { status: 200 });
  }

  const daysRaw = new URL(request.url).searchParams.get("days");
  const days = daysRaw ? Number(daysRaw) : null;
  const backfill = days != null && Number.isFinite(days) && days > BACKFILL_THRESHOLD_DAYS;

  try {
    if (backfill) {
      const result = await backfillWorkspace(workspace.id, { days: days as number });
      return NextResponse.json({ ok: true, backfill: true, ...result });
    }
    const result = await syncWorkspace(workspace.id);
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn("[sync] manual sync failed", message);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
