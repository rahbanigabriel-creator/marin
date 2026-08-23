import { NextResponse } from "next/server";

import {
  contentApiFailure,
  databaseUnavailable,
  requireContentMutationAccess,
} from "@/app/api/content/_lib/http";
import { createContentVariantResponse } from "@/app/api/content/items/[contentItemId]/variants/_lib/response";

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
    return createContentVariantResponse(request, access, contentItemId);
  } catch (error) {
    return contentApiFailure(error, "content_variant_create");
  }
}
