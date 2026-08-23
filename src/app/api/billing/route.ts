import { NextResponse } from "next/server";

import {
  NotAuthenticatedError,
  WorkspaceAuthorizationError,
  requireWorkspace,
  requireWorkspaceRole,
} from "@/lib/auth";
import { workspaceSeatLimitResponse } from "@/lib/auth-http";
import {
  getBillingSnapshot,
  staticFreeBillingSnapshot,
} from "@/lib/billing/entitlements";
import { isDatabaseConfigured } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  let workspace;
  try {
    workspace = await requireWorkspace();
  } catch (error) {
    const seatLimit = workspaceSeatLimitResponse(error);
    if (seatLimit) return seatLimit;
    if (error instanceof NotAuthenticatedError) {
      return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
    }
    throw error;
  }

  let canManage = false;
  try {
    await requireWorkspaceRole(["owner", "admin"]);
    canManage = true;
  } catch (error) {
    const seatLimit = workspaceSeatLimitResponse(error);
    if (seatLimit) return seatLimit;
    if (!(error instanceof WorkspaceAuthorizationError)) throw error;
  }

  if (!isDatabaseConfigured() || workspace.isDev) {
    return NextResponse.json({ billing: staticFreeBillingSnapshot(canManage) });
  }

  try {
    return NextResponse.json({
      billing: await getBillingSnapshot(workspace.id, canManage),
    });
  } catch {
    console.error("[billing] snapshot failed");
    return NextResponse.json({ error: "billing_unavailable" }, { status: 503 });
  }
}
