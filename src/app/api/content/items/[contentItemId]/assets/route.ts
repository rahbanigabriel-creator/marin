import { NextResponse } from "next/server";

import {
  contentApiFailure,
  databaseUnavailable,
  readJson,
  requireContentMutationAccess,
} from "@/app/api/content/_lib/http";
import { attachContentAsset } from "@/lib/content/assets";
import { parseContentAssetAttachBody } from "@/lib/content/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ contentItemId: string }>;
}

export async function POST(
  request: Request,
  context: RouteContext,
): Promise<NextResponse> {
  const unavailable = databaseUnavailable();
  if (unavailable) return unavailable;
  try {
    const access = await requireContentMutationAccess();
    const { contentItemId } = await context.params;
    const input = parseContentAssetAttachBody(await readJson(request));
    const result = await attachContentAsset({
      workspaceId: access.workspace.id,
      contentItemId,
      actorRole: access.role,
      ...input,
    });
    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    return contentApiFailure(error, "content_asset_attach");
  }
}
