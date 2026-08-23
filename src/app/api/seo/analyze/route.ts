import { NextResponse } from "next/server";

import {
  readSeoJson,
  requireSeoManageAccess,
  seoApiFailure,
  seoDatabaseUnavailable,
} from "@/app/api/seo/_lib/http";
import { analyzeSeo } from "@/lib/seo/service";
import { parseSeoAnalyzeBody } from "@/lib/seo/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<NextResponse> {
  const unavailable = seoDatabaseUnavailable();
  if (unavailable) return unavailable;
  try {
    const access = await requireSeoManageAccess();
    const input = parseSeoAnalyzeBody(await readSeoJson(request));
    const workspace = await analyzeSeo({
      workspaceId: access.workspace.id,
      actorId: access.clerkUserId,
      actorRole: access.role,
      ...input,
    });
    return NextResponse.json(workspace);
  } catch (error) {
    return seoApiFailure(error, "analysis_run");
  }
}
