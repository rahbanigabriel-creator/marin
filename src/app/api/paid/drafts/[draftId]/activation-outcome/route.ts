import { NextResponse } from "next/server";

import {
  paidDraftApiFailure,
  paidDraftDatabaseUnavailable,
  paidDraftMutationOriginFailure,
  readPaidDraftJson,
  requirePaidDraftManageAccess,
} from "@/app/api/paid/drafts/_lib/http";
import {
  parsePaidDraftId,
  parseRecordExternalActivationOutcomeBody,
} from "@/lib/paid-drafts/parsers";
import { recordPaidCampaignDraftExternalActivationOutcome } from "@/lib/paid-drafts/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ draftId: string }>;
}

export async function POST(
  request: Request,
  context: RouteContext,
): Promise<NextResponse> {
  const originFailure = paidDraftMutationOriginFailure(request);
  if (originFailure) return originFailure;
  const unavailable = paidDraftDatabaseUnavailable();
  if (unavailable) return unavailable;
  try {
    const access = await requirePaidDraftManageAccess();
    const { draftId } = await context.params;
    const result = await recordPaidCampaignDraftExternalActivationOutcome({
      workspaceId: access.workspace.id,
      draftId: parsePaidDraftId(draftId),
      actorId: access.clerkUserId,
      actorRole: access.role,
      body: parseRecordExternalActivationOutcomeBody(await readPaidDraftJson(request)),
    });
    return NextResponse.json(result, {
      status: result.replayed ? 200 : 201,
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (error) {
    return paidDraftApiFailure(error, "record_activation_outcome");
  }
}
