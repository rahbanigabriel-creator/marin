import { NextResponse } from "next/server";

import {
  contentApiFailure,
  databaseUnavailable,
  readJson,
  requireContentMutationAccess,
} from "@/app/api/content/_lib/http";
import {
  deleteContentVariant,
  patchContentVariant,
} from "@/lib/content/variants";
import {
  parseContentVariantPatchBody,
  parseExpectedVersionBody,
} from "@/lib/content/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ publicationId: string }>;
}

export async function PATCH(
  request: Request,
  context: RouteContext,
): Promise<NextResponse> {
  const unavailable = databaseUnavailable();
  if (unavailable) return unavailable;
  try {
    const access = await requireContentMutationAccess();
    const { publicationId } = await context.params;
    const input = parseContentVariantPatchBody(await readJson(request));
    const post = await patchContentVariant({
      workspaceId: access.workspace.id,
      publicationId,
      actorId: access.clerkUserId,
      actorRole: access.role,
      ...input,
    });
    return NextResponse.json({ post });
  } catch (error) {
    return contentApiFailure(error, "content_variant_update");
  }
}

export async function DELETE(
  request: Request,
  context: RouteContext,
): Promise<NextResponse> {
  const unavailable = databaseUnavailable();
  if (unavailable) return unavailable;
  try {
    const access = await requireContentMutationAccess();
    const { publicationId } = await context.params;
    const input = parseExpectedVersionBody(await readJson(request));
    const result = await deleteContentVariant({
      workspaceId: access.workspace.id,
      publicationId,
      actorRole: access.role,
      ...input,
    });
    return NextResponse.json(result);
  } catch (error) {
    return contentApiFailure(error, "content_variant_delete");
  }
}
