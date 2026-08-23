import { NextResponse } from "next/server";

import {
  contentApiFailure,
  databaseUnavailable,
  requireContentAccess,
  requireContentMutationAccess,
} from "@/app/api/content/_lib/http";
import { createContentItemResponse } from "@/app/api/content/items/_lib/responses";
import { listContentStudioItems } from "@/lib/content/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<NextResponse> {
  const unavailable = databaseUnavailable();
  if (unavailable) return unavailable;
  try {
    const access = await requireContentAccess();
    const url = new URL(request.url);
    const brandId = url.searchParams.get("brandId")?.trim() || undefined;
    const planId = url.searchParams.get("planId")?.trim() || undefined;
    const cursor = url.searchParams.get("cursor")?.trim() || undefined;
    const limitValue = url.searchParams.get("limit");
    const page = await listContentStudioItems({
      workspaceId: access.workspace.id,
      brandId,
      planId,
      cursor,
      take: limitValue === null ? undefined : Number(limitValue),
    });
    return NextResponse.json(page);
  } catch (error) {
    return contentApiFailure(error, "content_item_list");
  }
}

export async function POST(request: Request): Promise<NextResponse> {
  const unavailable = databaseUnavailable();
  if (unavailable) return unavailable;
  try {
    const access = await requireContentMutationAccess();
    return createContentItemResponse(request, access);
  } catch (error) {
    return contentApiFailure(error, "content_item_create");
  }
}
