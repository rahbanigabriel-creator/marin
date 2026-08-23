import { NextResponse } from "next/server";

import {
  contentApiFailure,
  databaseUnavailable,
  requireContentAccess,
  requireContentMutationAccess,
} from "@/app/api/content/_lib/http";
import { patchContentItemResponse } from "@/app/api/content/items/_lib/responses";
import { getContentItem } from "@/lib/content/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ contentItemId: string }>;
}

export async function GET(_request: Request, context: RouteContext): Promise<NextResponse> {
  const unavailable = databaseUnavailable();
  if (unavailable) return unavailable;
  try {
    const access = await requireContentAccess();
    const { contentItemId } = await context.params;
    const contentItem = await getContentItem(access.workspace.id, contentItemId);
    return NextResponse.json({ contentItem });
  } catch (error) {
    return contentApiFailure(error, "content_item_load");
  }
}

export async function PATCH(request: Request, context: RouteContext): Promise<NextResponse> {
  const unavailable = databaseUnavailable();
  if (unavailable) return unavailable;
  try {
    const access = await requireContentMutationAccess();
    const { contentItemId } = await context.params;
    return patchContentItemResponse(request, access, contentItemId);
  } catch (error) {
    return contentApiFailure(error, "content_item_update");
  }
}
