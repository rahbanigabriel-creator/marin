import { NextResponse } from "next/server";

import {
  influencerApiFailure,
  influencerDatabaseUnavailable,
  readInfluencerJson,
  requireInfluencerManageAccess,
} from "@/app/api/influencers/_lib/http";
import {
  parseInfluencerIdentifier,
  parsePatchInfluencerBody,
} from "@/lib/influencers/parsers";
import { patchInfluencerProfile } from "@/lib/influencers/service";
import { enforceInfluencerMutationRateLimit } from "@/lib/security/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function PATCH(
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
    const result = await patchInfluencerProfile({
      workspaceId: access.workspace.id,
      profileId: parseInfluencerIdentifier(id),
      actorId: access.clerkUserId,
      actorRole: access.role,
      patch: parsePatchInfluencerBody(await readInfluencerJson(request)),
    });
    return NextResponse.json(
      { profile: result.profile },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return influencerApiFailure(error, "profile_update");
  }
}
