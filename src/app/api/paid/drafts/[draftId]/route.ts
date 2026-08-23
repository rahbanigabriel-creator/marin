import { NextResponse } from "next/server";

import {
  paidDraftApiFailure,
  paidDraftDatabaseUnavailable,
  paidDraftMutationOriginFailure,
  readPaidDraftJson,
  requirePaidDraftManageAccess,
  requirePaidDraftReadAccess,
} from "@/app/api/paid/drafts/_lib/http";
import {
  parsePaidDraftId,
  parseUpdatePaidDraftBody,
} from "@/lib/paid-drafts/parsers";
import {
  getPaidCampaignDraft,
  updatePaidCampaignDraft,
} from "@/lib/paid-drafts/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ draftId: string }>;
}

export async function GET(
  _request: Request,
  context: RouteContext,
): Promise<NextResponse> {
  const unavailable = paidDraftDatabaseUnavailable();
  if (unavailable) return unavailable;
  try {
    const access = await requirePaidDraftReadAccess();
    const { draftId } = await context.params;
    const draft = await getPaidCampaignDraft({
      workspaceId: access.workspace.id,
      draftId: parsePaidDraftId(draftId),
      actorRole: access.role,
    });
    return NextResponse.json({ draft }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return paidDraftApiFailure(error, "detail");
  }
}

export async function PATCH(
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
    const result = await updatePaidCampaignDraft({
      workspaceId: access.workspace.id,
      draftId: parsePaidDraftId(draftId),
      actorId: access.clerkUserId,
      actorRole: access.role,
      body: parseUpdatePaidDraftBody(await readPaidDraftJson(request)),
    });
    return NextResponse.json(result, {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (error) {
    return paidDraftApiFailure(error, "update");
  }
}
