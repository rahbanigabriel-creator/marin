import { NextResponse } from "next/server";

import { requireWorkspaceRole } from "@/lib/auth";
import { workspaceSeatLimitResponse } from "@/lib/auth-http";
import {
  PaidSyncInProgressError,
  PaidSyncPersistenceError,
  syncPaidWorkspace,
} from "@/lib/connectors/paid-sync";
import { paidSyncAuthFailure } from "@/lib/connectors/paid-http";
import { isDatabaseConfigured } from "@/lib/db";
import { enforceEndpointRateLimit } from "@/lib/security/rate-limit";
import { requestBodyErrorResponse } from "@/lib/security/request-body";
import { readSyncRange } from "./_lib/request";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  let access;
  try {
    access = await requireWorkspaceRole(["owner", "admin"]);
  } catch (error) {
    const seatLimit = workspaceSeatLimitResponse(error);
    if (seatLimit) return seatLimit;
    const authFailure = paidSyncAuthFailure(error);
    if (authFailure) {
      return NextResponse.json({ ok: false, error: authFailure.error }, { status: authFailure.status });
    }
    return NextResponse.json({ ok: false, error: "authentication_unavailable" }, { status: 503 });
  }
  const rateLimited = await enforceEndpointRateLimit(request, "sync");
  if (rateLimited) return rateLimited;
  let range;
  try {
    range = await readSyncRange(request);
  } catch (error) {
    const bodyFailure = requestBodyErrorResponse(error);
    if (bodyFailure) return bodyFailure;
    throw error;
  }
  if (!range) {
    return NextResponse.json({ ok: false, error: "invalid_sync_request" }, { status: 400 });
  }
  if (!isDatabaseConfigured()) {
    return NextResponse.json({ ok: false, error: "persistence_unavailable" }, { status: 503 });
  }

  try {
    const result = await syncPaidWorkspace({
      workspaceId: access.workspace.id,
      range,
      trigger: "manual",
    });
    if (result.state === "failed") {
      return NextResponse.json({ ok: false, ...result }, { status: 502 });
    }
    if (result.state === "partial") {
      return NextResponse.json({ ok: true, ...result }, { status: 207 });
    }
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    if (error instanceof PaidSyncInProgressError) {
      return NextResponse.json({ ok: false, error: error.code }, { status: 409 });
    }
    if (error instanceof PaidSyncPersistenceError) {
      return NextResponse.json({ ok: false, error: error.code }, { status: 503 });
    }
    return NextResponse.json({ ok: false, error: "provider_sync_failed" }, { status: 502 });
  }
}
