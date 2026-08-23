import { NextResponse } from "next/server";

import {
  contentApiFailure,
  databaseUnavailable,
  readJson,
  requireContentMutationAccess,
} from "@/app/api/content/_lib/http";
import {
  DirectUploadPendingError,
  DirectUploadReservationInactiveError,
  completeDirectAssetUpload,
  parseDirectUploadCompletionInput,
} from "@/lib/storage/direct-upload";
import { toContentAssetDto } from "@/lib/content/service";
import { isAssetStorageConfigured } from "@/lib/storage/blob";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ reservationId: string }>;
}

export async function POST(request: Request, context: RouteContext): Promise<NextResponse> {
  const unavailable = databaseUnavailable();
  if (unavailable) return unavailable;
  if (!isAssetStorageConfigured()) {
    return NextResponse.json(
      { error: "asset_storage_unavailable", message: "Asset storage is not configured." },
      { status: 503 },
    );
  }

  try {
    const access = await requireContentMutationAccess();
    const { reservationId } = await context.params;
    const input = parseDirectUploadCompletionInput(await readJson(request));
    const completed = await completeDirectAssetUpload({
      workspaceId: access.workspace.id,
      reservationId,
      pathname: input.pathname,
    });
    return NextResponse.json(
      { asset: toContentAssetDto(completed.asset), ...(completed.reused ? { reused: true } : {}) },
      { status: completed.reused ? 200 : 201 },
    );
  } catch (error) {
    if (error instanceof DirectUploadReservationInactiveError) {
      return NextResponse.json(
        { error: error.code, message: error.message },
        { status: 409 },
      );
    }
    if (error instanceof DirectUploadPendingError) {
      return NextResponse.json(
        { error: error.code, message: error.message },
        { status: 503 },
      );
    }
    return contentApiFailure(error, "asset_upload_complete");
  }
}
