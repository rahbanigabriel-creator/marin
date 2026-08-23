import { NextResponse } from "next/server";

import {
  readSeoJson,
  requireSeoManageAccess,
  seoApiFailure,
  seoDatabaseUnavailable,
} from "@/app/api/seo/_lib/http";
import { createSeoTask } from "@/lib/seo/service";
import { parseCreateSeoTaskBody } from "@/lib/seo/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<NextResponse> {
  const unavailable = seoDatabaseUnavailable();
  if (unavailable) return unavailable;
  try {
    const access = await requireSeoManageAccess();
    const input = parseCreateSeoTaskBody(await readSeoJson(request));
    const task = await createSeoTask({
      workspaceId: access.workspace.id,
      actorId: access.clerkUserId,
      actorRole: access.role,
      ...input,
    });
    return NextResponse.json({ task }, { status: 201 });
  } catch (error) {
    return seoApiFailure(error, "task_create");
  }
}
