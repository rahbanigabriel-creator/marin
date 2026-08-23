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
  parseCreatePaidDraftBody,
  parsePaidDraftListQuery,
} from "@/lib/paid-drafts/parsers";
import {
  createPaidCampaignDraft,
  listPaidCampaignDrafts,
} from "@/lib/paid-drafts/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<NextResponse> {
  const unavailable = paidDraftDatabaseUnavailable();
  if (unavailable) return unavailable;
  try {
    const access = await requirePaidDraftReadAccess();
    const drafts = await listPaidCampaignDrafts({
      workspaceId: access.workspace.id,
      actorRole: access.role,
      query: parsePaidDraftListQuery(request),
    });
    return NextResponse.json({ drafts }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return paidDraftApiFailure(error, "list");
  }
}

export async function POST(request: Request): Promise<NextResponse> {
  const originFailure = paidDraftMutationOriginFailure(request);
  if (originFailure) return originFailure;
  const unavailable = paidDraftDatabaseUnavailable();
  if (unavailable) return unavailable;
  try {
    const access = await requirePaidDraftManageAccess();
    const result = await createPaidCampaignDraft({
      workspaceId: access.workspace.id,
      actorId: access.clerkUserId,
      actorRole: access.role,
      body: parseCreatePaidDraftBody(await readPaidDraftJson(request)),
    });
    return NextResponse.json(result, {
      status: result.replayed ? 200 : 201,
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (error) {
    return paidDraftApiFailure(error, "create");
  }
}
