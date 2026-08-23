import { NextResponse } from "next/server";

import {
  influencerApiFailure,
  influencerDatabaseUnavailable,
  readInfluencerJson,
  requireInfluencerManageAccess,
} from "@/app/api/influencers/_lib/http";
import {
  parseDisableInfluencerTrackingBody,
  parseInfluencerIdentifier,
} from "@/lib/influencers/parsers";
import { disableInfluencerTracking } from "@/lib/influencers/service";
import { enforceInfluencerMutationRateLimit } from "@/lib/security/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ id: string; linkId: string }>;
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
    const { id, linkId } = await context.params;
    const body = parseDisableInfluencerTrackingBody(
      await readInfluencerJson(request),
    );
    const result = await disableInfluencerTracking({
      workspaceId: access.workspace.id,
      profileId: parseInfluencerIdentifier(id),
      trackingLinkId: parseInfluencerIdentifier(linkId),
      actorId: access.clerkUserId,
      actorRole: access.role,
      expectedVersion: body.expectedVersion,
    });
    return NextResponse.json(
      { profile: result.profile },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return influencerApiFailure(error, "tracking_disable");
  }
}
