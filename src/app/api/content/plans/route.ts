import { NextResponse } from "next/server";

import {
  contentApiFailure,
  databaseUnavailable,
  readJson,
  requireContentAccess,
} from "@/app/api/content/_lib/http";
import { requireWorkspaceRole } from "@/lib/auth";
import { createContentPlan, listContentPlans } from "@/lib/content/service";
import { parsePlanCreateBody } from "@/lib/content/validation";
import {
  manualCreationErrorResult,
  parseManualCreationRequestId,
  runManualCreation,
} from "@/lib/idempotency/manual-creation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(): Promise<NextResponse> {
  const unavailable = databaseUnavailable();
  if (unavailable) return unavailable;
  try {
    const access = await requireContentAccess();
    const plans = await listContentPlans(access.workspace.id);
    return NextResponse.json({ plans });
  } catch (error) {
    return contentApiFailure(error, "plans_load");
  }
}

export async function POST(request: Request): Promise<NextResponse> {
  const unavailable = databaseUnavailable();
  if (unavailable) return unavailable;
  try {
    const access = await requireWorkspaceRole(["owner", "admin"]);
    const body = await readJson(request);
    const requestId = parseManualCreationRequestId(body);
    const input = parsePlanCreateBody(body);
    const result = await runManualCreation({
      workspaceId: access.workspace.id,
      operation: "content_plan_create",
      requestId,
      request: input,
      create: async (tx) => {
        const plan = await createContentPlan({
          workspaceId: access.workspace.id,
          createdBy: access.clerkUserId,
          ...input,
        }, tx);
        return { body: { plan }, status: 201 };
      },
    });
    return NextResponse.json(result.body, { status: result.status });
  } catch (error) {
    const idempotencyFailure = manualCreationErrorResult(error);
    if (idempotencyFailure) {
      return NextResponse.json(idempotencyFailure.body, { status: idempotencyFailure.status });
    }
    return contentApiFailure(error, "plan_create");
  }
}
