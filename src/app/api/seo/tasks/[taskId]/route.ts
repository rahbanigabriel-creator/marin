import { NextResponse } from "next/server";

import {
  readSeoJson,
  requireSeoManageAccess,
  seoApiFailure,
  seoDatabaseUnavailable,
} from "@/app/api/seo/_lib/http";
import { patchSeoTask } from "@/lib/seo/service";
import { parsePatchSeoTaskBody } from "@/lib/seo/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ taskId: string }>;
}

export async function PATCH(request: Request, context: RouteContext): Promise<NextResponse> {
  const unavailable = seoDatabaseUnavailable();
  if (unavailable) return unavailable;
  try {
    const access = await requireSeoManageAccess();
    const { taskId } = await context.params;
    const input = parsePatchSeoTaskBody(await readSeoJson(request));
    const task = await patchSeoTask({
      workspaceId: access.workspace.id,
      taskId,
      actorId: access.clerkUserId,
      actorRole: access.role,
      ...input,
    });
    return NextResponse.json({ task });
  } catch (error) {
    return seoApiFailure(error, "task_update");
  }
}
