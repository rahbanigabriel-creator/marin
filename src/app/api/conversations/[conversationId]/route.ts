import { NextResponse } from "next/server";

import {
  NotAuthenticatedError,
  WorkspaceAuthorizationError,
  requireWorkspace,
  requireWorkspaceRole,
} from "@/lib/auth";
import { CHAT_MUTATION_ROLES } from "@/app/api/chat/_lib/auth";
import { workspaceSeatLimitResponse } from "@/lib/auth-http";
import { archiveConversation, getConversation } from "@/lib/conversations/service";
import { isPersistenceModelUnavailable } from "@/lib/persistence/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Context = { params: Promise<{ conversationId: string }> };

function failure(error: unknown): NextResponse {
  const seatLimit = workspaceSeatLimitResponse(error);
  if (seatLimit) return seatLimit;
  if (error instanceof NotAuthenticatedError) {
    return NextResponse.json({ error: "not_authenticated" }, { status: 401 });
  }
  if (error instanceof WorkspaceAuthorizationError) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  if (isPersistenceModelUnavailable(error)) {
    return NextResponse.json({ error: "persistence_unavailable" }, { status: 503 });
  }
  return NextResponse.json({ error: "Unable to load conversation" }, { status: 400 });
}

export async function GET(_request: Request, context: Context): Promise<NextResponse> {
  try {
    const workspace = await requireWorkspace();
    const { conversationId } = await context.params;
    const conversation = await getConversation(workspace.id, conversationId);
    if (!conversation) return NextResponse.json({ error: "not_found" }, { status: 404 });
    return NextResponse.json({ conversation });
  } catch (error) {
    return failure(error);
  }
}

export async function DELETE(_request: Request, context: Context): Promise<NextResponse> {
  try {
    const { workspace } = await requireWorkspaceRole(CHAT_MUTATION_ROLES);
    const { conversationId } = await context.params;
    const archived = await archiveConversation(workspace.id, conversationId);
    return archived
      ? NextResponse.json({ archived: true })
      : NextResponse.json({ error: "not_found" }, { status: 404 });
  } catch (error) {
    return failure(error);
  }
}
