import { NextResponse } from "next/server";

import {
  influencerApiFailure,
  influencerDatabaseUnavailable,
  readInfluencerJson,
  requireInfluencerManageAccess,
  requireInfluencerReadAccess,
} from "@/app/api/influencers/_lib/http";
import {
  parseCreateInfluencerBody,
  parseInfluencerBrandQuery,
} from "@/lib/influencers/parsers";
import {
  createInfluencerProfile,
  getInfluencerWorkspace,
} from "@/lib/influencers/service";
import { enforceInfluencerMutationRateLimit } from "@/lib/security/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<NextResponse> {
  const unavailable = influencerDatabaseUnavailable();
  if (unavailable) return unavailable;
  try {
    const access = await requireInfluencerReadAccess();
    const workspace = await getInfluencerWorkspace({
      workspaceId: access.workspace.id,
      brandId: parseInfluencerBrandQuery(request),
      actorRole: access.role,
    });
    return NextResponse.json(workspace, {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (error) {
    return influencerApiFailure(error, "workspace_load");
  }
}

export async function POST(request: Request): Promise<NextResponse> {
  const unavailable = influencerDatabaseUnavailable();
  if (unavailable) return unavailable;
  try {
    const access = await requireInfluencerManageAccess();
    const rateLimited = await enforceInfluencerMutationRateLimit({
      userId: access.clerkUserId,
      workspaceId: access.workspace.id,
    });
    if (rateLimited) return rateLimited;
    const body = parseCreateInfluencerBody(await readInfluencerJson(request));
    const result = await createInfluencerProfile({
      workspaceId: access.workspace.id,
      actorId: access.clerkUserId,
      actorRole: access.role,
      ...body,
    });
    return NextResponse.json(
      { profile: result.profile, replayed: result.replayed },
      {
        status: result.replayed ? 200 : 201,
        headers: { "Cache-Control": "no-store" },
      },
    );
  } catch (error) {
    return influencerApiFailure(error, "profile_create");
  }
}
