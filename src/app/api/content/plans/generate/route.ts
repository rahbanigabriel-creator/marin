import { NextResponse } from "next/server";

import {
  contentApiFailure,
  databaseUnavailable,
  readJson,
  requireContentMutationAccess,
} from "@/app/api/content/_lib/http";
import { generateWeeklyContentPlan } from "@/lib/content/generation";
import { parseGenerateWeeklyPlanBody } from "@/lib/content/validation";
import { enforceEndpointRateLimit } from "@/lib/security/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<NextResponse> {
  const rateLimited = await enforceEndpointRateLimit(request, "plan_generation");
  if (rateLimited) return rateLimited;
  const unavailable = databaseUnavailable();
  if (unavailable) return unavailable;
  try {
    const access = await requireContentMutationAccess();
    const input = parseGenerateWeeklyPlanBody(await readJson(request));
    const result = await generateWeeklyContentPlan({
      workspaceId: access.workspace.id,
      actorId: access.clerkUserId,
      ...input,
    });
    return NextResponse.json(result, { status: result.reused ? 200 : 201 });
  } catch (error) {
    return contentApiFailure(error, "weekly_plan_generate");
  }
}
