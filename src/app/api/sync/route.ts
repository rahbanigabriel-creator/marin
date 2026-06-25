import { NextResponse } from "next/server";

import { getCurrentWorkspace } from "@/lib/auth";
import { isDatabaseConfigured } from "@/lib/db";
import { syncWorkspace } from "@/lib/jobs/inngest";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * On-demand metric sync for the current workspace — the same `syncWorkspace`
 * the Inngest job runs, exposed so connecting a platform pulls data immediately
 * (and a "Sync now" button can refresh it) without depending on Inngest being
 * fully wired. Authenticated + workspace-scoped; safe-fails without a DB.
 */
export async function POST(): Promise<Response> {
  const workspace = await getCurrentWorkspace();
  if (!workspace) {
    return NextResponse.json({ ok: false, error: "no_workspace" }, { status: 401 });
  }
  if (!isDatabaseConfigured()) {
    return NextResponse.json({ ok: false, error: "database_not_configured" }, { status: 200 });
  }
  try {
    const result = await syncWorkspace(workspace.id);
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn("[sync] manual sync failed", message);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
