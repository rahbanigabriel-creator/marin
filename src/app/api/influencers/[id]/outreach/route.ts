import { NextResponse } from "next/server";

import {
  influencerApiFailure,
  influencerDatabaseUnavailable,
  readInfluencerJson,
  requireInfluencerManageAccess,
} from "@/app/api/influencers/_lib/http";
import {
  parseCreateInfluencerOutreachBody,
  parseInfluencerIdentifier,
} from "@/lib/influencers/parsers";
import { createInfluencerOutreachDraft } from "@/lib/influencers/service";
import { enforceInfluencerMutationRateLimit } from "@/lib/security/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function POST(
  request: Request,
  context: RouteContext,
): Promise<NextResponse> {
  const unavailable = influencerDatabaseUnavailable();
  if (unavailable) return unavailable;
  try {
    const access = await requireInfluencerManageAccess();
    const rateLimited = await enforceInfluencerMutationRateLimit({
      userId: access.clerkUserId,
      workspaceId: access.workspace.id,
    });
    if (rateLimited) return rateLimited;
    const { id } = await context.params;
    const result = await createInfluencerOutreachDraft({
      workspaceId: access.workspace.id,
      profileId: parseInfluencerIdentifier(id),
      actorId: access.clerkUserId,
      actorRole: access.role,
      body: parseCreateInfluencerOutreachBody(await readInfluencerJson(request)),
    });
    return NextResponse.json(
      {
        profile: result.profile,
        outreachDraftId: result.outreachDraftId,
        replayed: result.replayed,
      },
      {
        status: result.replayed ? 200 : 201,
        headers: { "Cache-Control": "no-store" },
      },
    );
  } catch (error) {
    return influencerApiFailure(error, "outreach_create");
  }
}
