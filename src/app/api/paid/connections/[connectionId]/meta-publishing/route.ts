import { NextResponse } from "next/server";
import { paidDraftApiFailure, paidDraftDatabaseUnavailable, requirePaidDraftManageAccess } from "@/app/api/paid/drafts/_lib/http";
import { getMetaPublishingAccess } from "@/lib/connectors/meta-publishing-access";
import { prisma } from "@/lib/db";
import { PaidDraftNotFoundError } from "@/lib/paid-drafts/errors";
import { enforcePaidProviderRateLimit } from "@/lib/security/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(_request: Request, context: { params: Promise<{ connectionId: string }> }) {
  const unavailable = paidDraftDatabaseUnavailable();
  if (unavailable) return unavailable;
  try {
    const access = await requirePaidDraftManageAccess();
    const limited = await enforcePaidProviderRateLimit({ userId: access.clerkUserId, workspaceId: access.workspace.id });
    if (limited) return limited;
    const { connectionId } = await context.params;
    const connection = await prisma.connection.findFirst({ where: { id: connectionId, workspaceId: access.workspace.id, platform: "meta_ads", status: "connected" } });
    if (!connection) throw new PaidDraftNotFoundError();
    return NextResponse.json(await getMetaPublishingAccess(connection), { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return paidDraftApiFailure(error, "meta_publishing_access"); }
}
