import { NextResponse } from "next/server";

import {
  contentApiFailure,
  databaseUnavailable,
  readJson,
  requireContentMutationAccess,
} from "@/app/api/content/_lib/http";
import { deleteContentPost, patchContentPost } from "@/lib/content/posts";
import { canSetContentStatus } from "@/lib/content/permissions";
import { parseContentPostPatchBody, parseExpectedVersionBody } from "@/lib/content/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ publicationId: string }>;
}


export async function DELETE(
  request: Request,
  context: RouteContext,
): Promise<NextResponse> {
  const unavailable = databaseUnavailable();
  if (unavailable) return unavailable;

  try {
    const access = await requireContentMutationAccess();
    const input = parseExpectedVersionBody(await readJson(request));
    const { publicationId } = await context.params;
    const result = await deleteContentPost({
      workspaceId: access.workspace.id,
      actorRole: access.role,
      publicationId,
      ...input,
    });
    return NextResponse.json(result);
  } catch (error) {
    return contentApiFailure(error, "content_post_delete");
  }
}

export async function PATCH(
  request: Request,
  context: RouteContext,
): Promise<NextResponse> {
  const unavailable = databaseUnavailable();
  if (unavailable) return unavailable;

  try {
    const access = await requireContentMutationAccess();
    const input = parseContentPostPatchBody(await readJson(request));
    if (!canSetContentStatus(access.role, input.status)) {
      return NextResponse.json({ error: "forbidden" }, { status: 403 });
    }
    const { publicationId } = await context.params;
    const post = await patchContentPost({
      workspaceId: access.workspace.id,
      actorId: access.clerkUserId,
      actorRole: access.role,
      publicationId,
      ...input,
    });
    return NextResponse.json({ post });
  } catch (error) {
    return contentApiFailure(error, "content_post_update");
  }
}
