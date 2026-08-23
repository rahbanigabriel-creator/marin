import { NextResponse } from "next/server";

import {
  contentApiFailure,
  databaseUnavailable,
  readJson,
  requireContentMutationAccess,
} from "@/app/api/content/_lib/http";
import { detachContentAsset } from "@/lib/content/assets";
import { parseExpectedVersionBody } from "@/lib/content/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ contentItemId: string; linkId: string }>;
}

export async function DELETE(
  request: Request,
  context: RouteContext,
): Promise<NextResponse> {
  const unavailable = databaseUnavailable();
  if (unavailable) return unavailable;
  try {
    const access = await requireContentMutationAccess();
    const { contentItemId, linkId } = await context.params;
    const input = parseExpectedVersionBody(await readJson(request));
    const result = await detachContentAsset({
      workspaceId: access.workspace.id,
      contentItemId,
      linkId,
      actorRole: access.role,
      ...input,
    });
    return NextResponse.json(result);
  } catch (error) {
    return contentApiFailure(error, "content_asset_detach");
  }
}
