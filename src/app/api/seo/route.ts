import { NextResponse } from "next/server";

import {
  requireSeoReadAccess,
  seoApiFailure,
  seoDatabaseUnavailable,
} from "@/app/api/seo/_lib/http";
import { getSeoWorkspace } from "@/lib/seo/service";
import { parseSeoBrandQuery } from "@/lib/seo/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<NextResponse> {
  const unavailable = seoDatabaseUnavailable();
  if (unavailable) return unavailable;
  try {
    const access = await requireSeoReadAccess();
    const workspace = await getSeoWorkspace({
      workspaceId: access.workspace.id,
      brandId: parseSeoBrandQuery(request),
      actorRole: access.role,
    });
    return NextResponse.json(workspace);
  } catch (error) {
    return seoApiFailure(error, "workspace_load");
  }
}
