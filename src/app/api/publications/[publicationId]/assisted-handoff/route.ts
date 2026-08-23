import { NextResponse } from "next/server";

import {
  contentApiFailure,
  databaseUnavailable,
  readJson,
  requireContentAccess,
} from "@/app/api/content/_lib/http";
import { requireWorkspaceRole } from "@/lib/auth";
import {
  getAssistedHandoff,
  recordAssistedHandoff,
} from "@/lib/content/assisted-handoff";
import { parseAssistedHandoffBody } from "@/lib/content/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ publicationId: string }>;
}

export async function GET(_request: Request, context: RouteContext): Promise<NextResponse> {
  const unavailable = databaseUnavailable();
  if (unavailable) return unavailable;
  try {
    const access = await requireContentAccess();
    const { publicationId } = await context.params;
    const handoff = await getAssistedHandoff({
      workspaceId: access.workspace.id,
      publicationId,
      actorRole: access.role,
    });
    return NextResponse.json(handoff);
  } catch (error) {
    return contentApiFailure(error, "assisted_handoff_load");
  }
}

export async function POST(request: Request, context: RouteContext): Promise<NextResponse> {
  const unavailable = databaseUnavailable();
  if (unavailable) return unavailable;
  try {
    const access = await requireWorkspaceRole(["owner", "admin"]);
    const { publicationId } = await context.params;
    const body = parseAssistedHandoffBody(await readJson(request));
    const result = await recordAssistedHandoff({
      workspaceId: access.workspace.id,
      publicationId,
      actorId: access.clerkUserId,
      actorRole: access.role,
      ...body,
    });
    return NextResponse.json(
      { ...result.handoff, reused: result.reused },
      { status: result.reused ? 200 : 201 },
    );
  } catch (error) {
    return contentApiFailure(error, "assisted_handoff_record");
  }
}
