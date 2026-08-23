import { NextResponse } from "next/server";

import {
  readSeoJson,
  requireSeoManageAccess,
  seoApiFailure,
  seoDatabaseUnavailable,
} from "@/app/api/seo/_lib/http";
import { acceptSeoProposal } from "@/lib/seo/proposals";
import { parseAcceptSeoProposalBody } from "@/lib/seo/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ taskId: string; proposalId: string }>;
}

export async function POST(request: Request, context: RouteContext): Promise<NextResponse> {
  const unavailable = seoDatabaseUnavailable();
  if (unavailable) return unavailable;
  try {
    const access = await requireSeoManageAccess();
    const { taskId, proposalId } = await context.params;
    const input = parseAcceptSeoProposalBody(await readSeoJson(request));
    const result = await acceptSeoProposal({
      workspaceId: access.workspace.id,
      taskId,
      proposalId,
      actorId: access.clerkUserId,
      actorRole: access.role,
      ...input,
    });
    return NextResponse.json(result);
  } catch (error) {
    return seoApiFailure(error, "proposal_accept");
  }
}
