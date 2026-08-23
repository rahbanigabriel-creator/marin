import { NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";

import { contentApiFailure, readJson } from "@/app/api/content/_lib/http";
import type { WorkspaceAccess } from "@/lib/auth";
import { canSetContentStatus } from "@/lib/content/permissions";
import { createContentItem, patchContentItem } from "@/lib/content/service";
import type {
  ContentItemDto,
  CreateContentItemInput,
  PatchContentItemInput,
} from "@/lib/content/types";
import {
  parseContentItemCreateBody,
  parseContentItemPatchBody,
} from "@/lib/content/validation";
import {
  manualCreationErrorResult,
  parseManualCreationRequestId,
  runManualCreation,
  type ManualCreationOperation,
  type ManualCreationResult,
} from "@/lib/idempotency/manual-creation";

type ContentItemCreationBody = { contentItem: ContentItemDto };
type CreateOperation = (
  input: CreateContentItemInput,
  transaction?: Prisma.TransactionClient,
) => Promise<ContentItemDto>;
type PatchOperation = (input: PatchContentItemInput) => Promise<ContentItemDto>;
type ContentItemCreationRunner = (input: {
  workspaceId: string;
  operation: ManualCreationOperation;
  requestId: string;
  request: unknown;
  create: (
    tx: Prisma.TransactionClient,
  ) => Promise<{ body: ContentItemCreationBody; status: number }>;
}) => Promise<ManualCreationResult<ContentItemCreationBody>>;

const CONTENT_ITEM_LEDGER_OPERATION: ManualCreationOperation = "content_item_create";

export async function createContentItemResponse(
  request: Request,
  access: WorkspaceAccess,
  operation: CreateOperation = createContentItem,
  ledger: ContentItemCreationRunner = runManualCreation,
): Promise<NextResponse> {
  try {
    const body = await readJson(request);
    const requestId = parseManualCreationRequestId(body);
    const input = parseContentItemCreateBody(body);
    if (!canSetContentStatus(access.role, input.status)) {
      return NextResponse.json({ error: "forbidden" }, { status: 403 });
    }
    const result = await ledger({
      workspaceId: access.workspace.id,
      operation: CONTENT_ITEM_LEDGER_OPERATION,
      requestId,
      request: { kind: "content_item", input },
      create: async (tx) => {
        const contentItem = await operation({
          workspaceId: access.workspace.id,
          createdBy: access.clerkUserId,
          actorRole: access.role,
          ...input,
        }, tx);
        return { body: { contentItem }, status: 201 };
      },
    });
    return NextResponse.json(result.body, { status: result.status });
  } catch (error) {
    const idempotencyFailure = manualCreationErrorResult(error);
    if (idempotencyFailure) {
      return NextResponse.json(idempotencyFailure.body, { status: idempotencyFailure.status });
    }
    return contentApiFailure(error, "content_item_create");
  }
}

export async function patchContentItemResponse(
  request: Request,
  access: WorkspaceAccess,
  contentItemId: string,
  operation: PatchOperation = patchContentItem,
): Promise<NextResponse> {
  try {
    const input = parseContentItemPatchBody(await readJson(request));
    if (!canSetContentStatus(access.role, input.status)) {
      return NextResponse.json({ error: "forbidden" }, { status: 403 });
    }
    const contentItem = await operation({
      workspaceId: access.workspace.id,
      contentItemId,
      actorId: access.clerkUserId,
      actorRole: access.role,
      ...input,
    });
    return NextResponse.json({ contentItem });
  } catch (error) {
    return contentApiFailure(error, "content_item_update");
  }
}
