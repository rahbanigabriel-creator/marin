import { NextResponse } from "next/server";
import { paidDraftApiFailure, paidDraftDatabaseUnavailable, paidDraftMutationOriginFailure, requirePaidDraftManageAccess } from "@/app/api/paid/drafts/_lib/http";
import { reconcilePaidMetaCreation } from "@/lib/paid-drafts/service";
import { parsePaidDraftId } from "@/lib/paid-drafts/parsers";
import { enforcePaidProviderRateLimit } from "@/lib/security/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function POST(request: Request, context: { params: Promise<{ draftId: string }> }) {
  const forbidden = paidDraftMutationOriginFailure(request) ?? paidDraftDatabaseUnavailable();
  if (forbidden) return forbidden;
  try {
    const access = await requirePaidDraftManageAccess();
    const limited = await enforcePaidProviderRateLimit({ userId: access.clerkUserId, workspaceId: access.workspace.id });
    if (limited) return limited;
    const { draftId } = await context.params;
    const result = await reconcilePaidMetaCreation({ workspaceId: access.workspace.id, draftId: parsePaidDraftId(draftId), actorId: access.clerkUserId, actorRole: access.role });
    return NextResponse.json(result, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return paidDraftApiFailure(error, "meta_reconcile"); }
}
