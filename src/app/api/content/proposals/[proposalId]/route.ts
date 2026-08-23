import { NextResponse } from "next/server";

import {
  contentApiFailure,
  databaseUnavailable,
  requireContentMutationAccess,
} from "@/app/api/content/_lib/http";
import { dismissContentProposal } from "@/lib/content/proposals";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ proposalId: string }>;
}

export async function DELETE(_request: Request, context: RouteContext): Promise<NextResponse> {
  const unavailable = databaseUnavailable();
  if (unavailable) return unavailable;
  try {
    const access = await requireContentMutationAccess();
    const { proposalId } = await context.params;
    await dismissContentProposal({
      workspaceId: access.workspace.id,
      proposalId,
      actorRole: access.role,
    });
    return NextResponse.json({ proposalId, dismissed: true });
  } catch (error) {
    return contentApiFailure(error, "content_proposal_dismiss");
  }
}
