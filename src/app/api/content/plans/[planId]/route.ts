import { NextResponse } from "next/server";

import {
  contentApiFailure,
  databaseUnavailable,
  readJson,
  requireContentMutationAccess,
} from "@/app/api/content/_lib/http";
import { deleteContentPlan, patchContentPlan } from "@/lib/content/service";
import { parseExpectedVersionBody, parsePlanPatchBody } from "@/lib/content/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ planId: string }>;
}

export async function PATCH(request: Request, context: RouteContext): Promise<NextResponse> {
  const unavailable = databaseUnavailable();
  if (unavailable) return unavailable;
  try {
    const access = await requireContentMutationAccess();
    const { planId } = await context.params;
    const input = parsePlanPatchBody(await readJson(request));
    const plan = await patchContentPlan({
      workspaceId: access.workspace.id,
      planId,
      actorRole: access.role,
      ...input,
    });
    return NextResponse.json({ plan });
  } catch (error) {
    return contentApiFailure(error, "plan_update");
  }
}


export async function DELETE(request: Request, context: RouteContext): Promise<NextResponse> {
  const unavailable = databaseUnavailable();
  if (unavailable) return unavailable;
  try {
    const access = await requireContentMutationAccess();
    const { planId } = await context.params;
    const input = parseExpectedVersionBody(await readJson(request));
    const result = await deleteContentPlan({
      workspaceId: access.workspace.id,
      planId,
      actorRole: access.role,
      ...input,
    });
    return NextResponse.json(result);
  } catch (error) {
    return contentApiFailure(error, "plan_delete");
  }
}
