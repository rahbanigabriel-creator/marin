import type { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";

import {
  contentApiFailure,
  readJson,
} from "@/app/api/content/_lib/http";
import type { WorkspaceAccess } from "@/lib/auth";
import { createContentVariant } from "@/lib/content/variants";
import type {
  ContentPostDto,
  CreateContentVariantInput,
} from "@/lib/content/types";
import { parseContentVariantCreateBody } from "@/lib/content/validation";
import {
  manualCreationErrorResult,
  parseManualCreationRequestId,
  runManualCreation,
  type ManualCreationOperation,
  type ManualCreationResult,
} from "@/lib/idempotency/manual-creation";

type ContentVariantCreationBody = { post: ContentPostDto };
type CreateOperation = (
  input: CreateContentVariantInput,
  transaction?: Prisma.TransactionClient,
) => Promise<ContentPostDto>;
type ContentVariantCreationRunner = (input: {
  workspaceId: string;
  operation: ManualCreationOperation;
  requestId: string;
  request: unknown;
  create: (
    tx: Prisma.TransactionClient,
  ) => Promise<{ body: ContentVariantCreationBody; status: number }>;
}) => Promise<ManualCreationResult<ContentVariantCreationBody>>;

const CONTENT_VARIANT_LEDGER_OPERATION: ManualCreationOperation = "content_variant_create";

export async function createContentVariantResponse(
  request: Request,
  access: WorkspaceAccess,
  contentItemId: string,
  operation: CreateOperation = createContentVariant,
  ledger: ContentVariantCreationRunner = runManualCreation,
): Promise<NextResponse> {
  try {
    const body = await readJson(request);
    const requestId = parseManualCreationRequestId(body);
    const input = parseContentVariantCreateBody(body);
    const result = await ledger({
      workspaceId: access.workspace.id,
      operation: CONTENT_VARIANT_LEDGER_OPERATION,
      requestId,
      request: { kind: "content_variant", contentItemId, input },
      create: async (tx) => {
        const post = await operation({
          workspaceId: access.workspace.id,
          contentItemId,
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
    return contentApiFailure(error, "content_variant_create");
  }
}
