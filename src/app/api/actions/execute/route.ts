import { NextResponse, type NextRequest } from "next/server";

import {
  NotAuthenticatedError,
  WorkspaceAuthorizationError,
  requireWorkspaceRole,
} from "@/lib/auth";
import { workspaceSeatLimitResponse } from "@/lib/auth-http";
import { isDatabaseConfigured, prisma } from "@/lib/db";
import { deepLinkFor, executeApi, type ExecuteResult } from "@/lib/actions/executors";
import { requiresExecutionEntitlement } from "@/lib/actions/capability";
import { resolveWorkspaceBillingPolicy } from "@/lib/billing/entitlements";
import {
  readBoundedJson,
  requestBodyErrorResponse,
} from "@/lib/security/request-body";

/**
 * POST /api/actions/execute — run ONE proposed action.
 *
 * Security spine: the client sends ONLY { actionId }. The server loads the
 * persisted Action (written at propose-time with a SERVER-computed execMode +
 * approval flag), asserts it belongs to the caller's workspace, and runs it.
 * The click IS the approval; money/public-posting never auto-execute (paid actions
 * are execMode "guided" = prepare + open, which moves no money). Idempotent: only
 * a "proposed" row can start, so a double-click never double-posts.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest): Promise<Response> {
  if (!isDatabaseConfigured()) {
    return NextResponse.json({ ok: false, reason: "Actions need the database configured." });
  }

  let body: { actionId?: string };
  try {
    body = await readBoundedJson<{ actionId?: string }>(req, 4 * 1024);
  } catch (error) {
    const bodyFailure = requestBodyErrorResponse(error);
    if (bodyFailure) return bodyFailure;
    return NextResponse.json({ ok: false, reason: "bad request" }, { status: 400 });
  }
  const actionId = body.actionId;
  if (!actionId) return NextResponse.json({ ok: false, reason: "missing actionId" }, { status: 400 });

  let access;
  try {
    access = await requireWorkspaceRole(["owner", "admin"]);
  } catch (error) {
    const seatLimit = workspaceSeatLimitResponse(error);
    if (seatLimit) return seatLimit;
    if (error instanceof NotAuthenticatedError) {
      return NextResponse.json({ ok: false, reason: "unauthenticated" }, { status: 401 });
    }
    if (error instanceof WorkspaceAuthorizationError) {
      return NextResponse.json({ ok: false, reason: "forbidden" }, { status: 403 });
    }
    throw error;
  }
  const { workspace, clerkUserId } = access;

  const action = await prisma.action.findUnique({ where: { id: actionId } });
  if (!action || action.workspaceId !== workspace.id) {
    return NextResponse.json({ ok: false, reason: "not found" }, { status: 404 });
  }

  if (requiresExecutionEntitlement(action.execMode)) {
    const policy = await resolveWorkspaceBillingPolicy(workspace.id);
    if (!policy.entitlements.canExecuteActions) {
      return NextResponse.json(
        {
          ok: false,
          reason: "Provider execution is available on the Solo Founder plan.",
          code: "actions_not_in_plan",
          actionUrl: "/settings/billing",
        },
        { status: 402 },
      );
    }
  }

  // Idempotent transition — only a "proposed" row can begin executing.
  const claimed = await prisma.action.updateMany({
    where: { id: actionId, status: "proposed" },
    data: { status: "executing" },
  });
  if (claimed.count === 0) {
    const r = (action.result ?? {}) as { resultUrl?: string };
    return NextResponse.json({
      ok: true,
      status: action.status,
      resultUrl: r.resultUrl,
      error: action.error ?? undefined,
    });
  }

  // Dispatch by the server-computed exec mode.
  let outcome: ExecuteResult;
  if (action.execMode === "api") {
    outcome = await executeApi(action);
  } else if (action.execMode === "guided") {
    outcome = { status: "manual", resultUrl: deepLinkFor(action) };
  } else {
    outcome = { status: "manual" }; // prepare — content is copied client-side
  }

  // Executor refused (e.g. not connected) → reset to proposed so retry works.
  if (outcome.ok === false) {
    await prisma.action.update({ where: { id: actionId }, data: { status: "proposed" } });
    return NextResponse.json({ ok: false, reason: outcome.reason });
  }

  const status = outcome.status ?? "succeeded";
  await prisma.action.update({
    where: { id: actionId },
    data: {
      status,
      result: outcome.resultUrl ? { resultUrl: outcome.resultUrl } : undefined,
      error: outcome.error ?? null,
      executedBy: clerkUserId,
      executedAt: new Date(),
    },
  });
  return NextResponse.json({ ok: true, status, resultUrl: outcome.resultUrl, error: outcome.error });
}
