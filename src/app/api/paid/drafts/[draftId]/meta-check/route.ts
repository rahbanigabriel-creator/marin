import { NextResponse } from "next/server";
import { paidDraftApiFailure, paidDraftDatabaseUnavailable, paidDraftMutationOriginFailure, requirePaidDraftManageAccess } from "@/app/api/paid/drafts/_lib/http";
import { prisma } from "@/lib/db";
import { PaidDraftNotFoundError } from "@/lib/paid-drafts/errors";
import { checkMetaPausedAccess } from "@/lib/paid-drafts/meta-paused-execution";
import { parsePaidCampaignSnapshotV1 } from "@/lib/paid-drafts/validation";
import { requireMetaCreationEntitlement } from "@/lib/paid-drafts/meta-entitlements";
import { verifySnapshotAssets } from "@/lib/paid-drafts/service";
import { enforcePaidProviderRateLimit } from "@/lib/security/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(request: Request, context: { params: Promise<{ draftId: string }> }) {
  const forbidden = paidDraftMutationOriginFailure(request) ?? paidDraftDatabaseUnavailable();
  if (forbidden) return forbidden;
  try {
    const access = await requirePaidDraftManageAccess();
    const limited = await enforcePaidProviderRateLimit({ userId: access.clerkUserId, workspaceId: access.workspace.id });
    if (limited) return limited;
    const { draftId } = await context.params;
    const draft = await prisma.paidCampaignDraft.findFirst({ where: { id: draftId, workspaceId: access.workspace.id }, include: { connection: true } });
    if (!draft || !draft.connection || draft.connection.workspaceId !== access.workspace.id || draft.connection.status !== "connected" || draft.connection.externalAccountId !== draft.accountId || draft.connection.platform !== "meta_ads") throw new PaidDraftNotFoundError();
    const snapshot = parsePaidCampaignSnapshotV1(draft.snapshot);
    await requireMetaCreationEntitlement(access.workspace.id);
    await verifySnapshotAssets(prisma, access.workspace.id, snapshot);
    await checkMetaPausedAccess(draft.connection, snapshot);
    return NextResponse.json({ ready: true, version: draft.version, snapshotHash: draft.snapshotHash, checkedAt: new Date().toISOString() }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return paidDraftApiFailure(error, "meta_check"); }
}
