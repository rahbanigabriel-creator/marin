import { NextResponse } from "next/server";

import {
  readSeoJson,
  requireSeoManageAccess,
  seoApiFailure,
  seoDatabaseUnavailable,
} from "@/app/api/seo/_lib/http";
import { generateSeoProposal } from "@/lib/seo/proposals";
import { parseGenerateSeoProposalBody } from "@/lib/seo/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

interface RouteContext {
  params: Promise<{ taskId: string }>;
}

export async function POST(request: Request, context: RouteContext): Promise<NextResponse> {
  const unavailable = seoDatabaseUnavailable();
  if (unavailable) return unavailable;
  try {
    const access = await requireSeoManageAccess();
    const { taskId } = await context.params;
    const input = parseGenerateSeoProposalBody(await readSeoJson(request));
    const result = await generateSeoProposal({
      workspaceId: access.workspace.id,
      taskId,
      actorId: access.clerkUserId,
      actorRole: access.role,
      ...input,
    });
    return NextResponse.json(result, { status: result.reused ? 200 : 201 });
  } catch (error) {
    return seoApiFailure(error, "proposal_generate");
  }
}
