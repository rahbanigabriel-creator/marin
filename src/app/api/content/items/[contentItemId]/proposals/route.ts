import { NextResponse } from "next/server";

import {
  contentApiFailure,
  databaseUnavailable,
  readJson,
  requireContentMutationAccess,
} from "@/app/api/content/_lib/http";
import { ContentValidationError } from "@/lib/content/errors";
import { generateContentProposal } from "@/lib/content/proposals";
import { parseGenerateContentProposalBody } from "@/lib/content/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

interface RouteContext {
  params: Promise<{ contentItemId: string }>;
}

export async function POST(request: Request, context: RouteContext): Promise<NextResponse> {
  const unavailable = databaseUnavailable();
  if (unavailable) return unavailable;
  try {
    const access = await requireContentMutationAccess();
    const { contentItemId } = await context.params;
    const input = parseGenerateContentProposalBody(await readJson(request));
    const result = await generateContentProposal({
      workspaceId: access.workspace.id,
      actorId: access.clerkUserId,
      actorRole: access.role,
      contentItemId,
      ...input,
    });
    return NextResponse.json(result, { status: result.reused ? 200 : 201 });
  } catch (error) {
    if (
      error instanceof ContentValidationError &&
      error.code === "copy_generation_unavailable"
    ) {
      return NextResponse.json(
        { error: error.code, code: error.code, message: error.message },
        { status: 503 },
      );
    }
    if (
      error instanceof ContentValidationError &&
      (error.code === "idempotency_conflict" || error.code === "request_in_progress")
    ) {
      return NextResponse.json(
        { error: error.code, code: error.code, message: error.message },
        { status: 409 },
      );
    }
    return contentApiFailure(error, "content_proposal_generate");
  }
}
