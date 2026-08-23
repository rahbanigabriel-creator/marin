import { NextResponse } from "next/server";

import {
  contentApiFailure,
  databaseUnavailable,
  readJson,
} from "@/app/api/content/_lib/http";
import { requireWorkspaceRole } from "@/lib/auth";
import { createContentPost } from "@/lib/content/posts";
import { canSetContentStatus } from "@/lib/content/permissions";
import { parseContentPostCreateBody } from "@/lib/content/validation";
import {
  manualCreationErrorResult,
  parseManualCreationRequestId,
  runManualCreation,
} from "@/lib/idempotency/manual-creation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<NextResponse> {
  const unavailable = databaseUnavailable();
  if (unavailable) return unavailable;

  try {
    const access = await requireWorkspaceRole(["owner", "admin"]);
    const body = await readJson(request);
    const requestId = parseManualCreationRequestId(body);
    const input = parseContentPostCreateBody(body);
    if (!canSetContentStatus(access.role, input.status)) {
      return NextResponse.json({ error: "forbidden" }, { status: 403 });
    }
    const result = await runManualCreation({
      workspaceId: access.workspace.id,
      operation: "content_post_create",
      requestId,
      request: input,
      create: async (tx) => {
        const post = await createContentPost({
          workspaceId: access.workspace.id,
          actorId: access.clerkUserId,
          actorRole: access.role,
          ...input,
        }, tx);
        return { body: { post }, status: 201 };
      },
    });
    return NextResponse.json(result.body, { status: result.status });
  } catch (error) {
    const idempotencyFailure = manualCreationErrorResult(error);
    if (idempotencyFailure) {
      return NextResponse.json(idempotencyFailure.body, { status: idempotencyFailure.status });
    }
    return contentApiFailure(error, "content_post_create");
  }
}
