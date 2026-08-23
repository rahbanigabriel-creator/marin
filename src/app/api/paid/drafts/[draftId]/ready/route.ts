import { NextResponse } from "next/server";

import {
  paidDraftApiFailure,
  paidDraftDatabaseUnavailable,
  paidDraftMutationOriginFailure,
  readPaidDraftJson,
  requirePaidDraftManageAccess,
} from "@/app/api/paid/drafts/_lib/http";
import {
  parseMarkPaidDraftReadyBody,
  parsePaidDraftId,
} from "@/lib/paid-drafts/parsers";
import { markPaidCampaignDraftReady } from "@/lib/paid-drafts/service";

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
    const result = await markPaidCampaignDraftReady({
      workspaceId: access.workspace.id,
      draftId: parsePaidDraftId(draftId),
      actorId: access.clerkUserId,
      actorRole: access.role,
      body: parseMarkPaidDraftReadyBody(await readPaidDraftJson(request)),
    });
    return NextResponse.json(result, {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (error) {
    return paidDraftApiFailure(error, "mark_ready");
  }
}
