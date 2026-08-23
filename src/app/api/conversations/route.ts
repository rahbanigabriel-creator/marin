import { NextResponse } from "next/server";

import {
  NotAuthenticatedError,
  WorkspaceAuthorizationError,
  requireWorkspace,
  requireWorkspaceRole,
} from "@/lib/auth";
import { workspaceSeatLimitResponse } from "@/lib/auth-http";
import { CHAT_MUTATION_ROLES } from "@/app/api/chat/_lib/auth";
import { createConversation, listConversations } from "@/lib/conversations/service";
import {
  manualCreationErrorResult,
  parseManualCreationRequestId,
  runManualCreation,
} from "@/lib/idempotency/manual-creation";
import { isPersistenceModelUnavailable } from "@/lib/persistence/errors";
import {
  readBoundedJson,
  requestBodyErrorResponse,
} from "@/lib/security/request-body";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function failure(error: unknown, operation: "load" | "create"): NextResponse {
  const bodyFailure = requestBodyErrorResponse(error);
  if (bodyFailure) return bodyFailure as NextResponse;
  const idempotencyFailure = manualCreationErrorResult(error);
  if (idempotencyFailure) {
    return NextResponse.json(idempotencyFailure.body, { status: idempotencyFailure.status });
  }
  const seatLimit = workspaceSeatLimitResponse(error);
  if (seatLimit) return seatLimit;
  if (error instanceof NotAuthenticatedError) {
    return NextResponse.json({ error: "not_authenticated" }, { status: 401 });
  }
  if (error instanceof WorkspaceAuthorizationError) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  if (isPersistenceModelUnavailable(error)) {
    return operation === "load"
      ? NextResponse.json({ available: false, conversations: [] }, { status: 503 })
      : NextResponse.json({ error: "persistence_unavailable" }, { status: 503 });
  }
  console.error(`[conversations] ${operation} failed`);
  return NextResponse.json(
    { error: operation === "load" ? "conversations_load_failed" : "conversation_create_failed" },
    { status: 500 },
  );
}

export async function GET(): Promise<NextResponse> {
  try {
    const workspace = await requireWorkspace();
    const conversations = workspace.isDev ? [] : await listConversations(workspace.id);
    return NextResponse.json({ available: !workspace.isDev, conversations });
  } catch (error) {
    return failure(error, "load");
  }
}

export async function POST(request: Request): Promise<NextResponse> {
  try {
    const access = await requireWorkspaceRole(CHAT_MUTATION_ROLES);
    if (access.workspace.isDev) {
      return NextResponse.json({ error: "persistence_unavailable" }, { status: 503 });
    }
    const body = await readBoundedJson<{
      requestId?: string;
      brandId?: string | null;
      title?: string;
      question?: string;
      mode?: string;
    }>(request);
    const requestId = parseManualCreationRequestId(body);
    const creation = {
      brandId: body.brandId,
      title: body.title,
      question: body.question,
      mode: body.mode,
    };
    const result = await runManualCreation({
      workspaceId: access.workspace.id,
      operation: "conversation_create",
      requestId,
      request: creation,
      create: async (tx) => {
        const conversation = await createConversation({
          workspaceId: access.workspace.id,
          createdBy: access.clerkUserId,
          ...creation,
        }, tx);
        return { body: { conversation }, status: 201 };
      },
    });
    return NextResponse.json(result.body, { status: result.status });
  } catch (error) {
    return failure(error, "create");
  }
}
