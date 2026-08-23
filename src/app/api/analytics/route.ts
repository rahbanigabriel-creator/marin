import { NextResponse } from "next/server";

import {
  NotAuthenticatedError,
  WorkspaceAuthorizationError,
  requireWorkspaceRole,
} from "@/lib/auth";
import { workspaceSeatLimitResponse } from "@/lib/auth-http";
import {
  AnalyticsRangeError,
  parseAnalyticsRange,
  readDistributionAnalytics,
} from "@/lib/distribution-analytics";
import { isDatabaseConfigured } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<NextResponse> {
  if (!isDatabaseConfigured()) {
    return NextResponse.json({ error: "persistence_unavailable" }, { status: 503 });
  }

  let access;
  try {
    access = await requireWorkspaceRole(["owner", "admin", "member"]);
  } catch (error) {
    const admission = workspaceSeatLimitResponse(error);
    if (admission) return admission;
    if (error instanceof NotAuthenticatedError) {
      return NextResponse.json({ error: "not_authenticated" }, { status: 401 });
    }
    if (error instanceof WorkspaceAuthorizationError) {
      return NextResponse.json({ error: "forbidden" }, { status: 403 });
    }
    return NextResponse.json({ error: "authentication_unavailable" }, { status: 503 });
  }

  let range;
  try {
    range = parseAnalyticsRange(new URL(request.url).searchParams);
  } catch (error) {
    if (error instanceof AnalyticsRangeError) {
      return NextResponse.json({ error: error.code, message: error.message }, { status: 400 });
    }
    return NextResponse.json({ error: "invalid_date_range" }, { status: 400 });
  }

  try {
    const response = await readDistributionAnalytics(access.workspace.id, range);
    return NextResponse.json(response, {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch {
    console.error("[distribution-analytics] read failed");
    return NextResponse.json({ error: "persistence_unavailable" }, { status: 503 });
  }
}
