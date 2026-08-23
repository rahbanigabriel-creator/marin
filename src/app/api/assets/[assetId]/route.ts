import { NextResponse } from "next/server";

import {
  contentApiFailure,
  databaseUnavailable,
  requireContentMutationAccess,
} from "@/app/api/content/_lib/http";
import {
  AssetInUseError,
  finalizeAssetDeletion,
  markAssetForDeletion,
} from "@/lib/storage/asset-deletion";
import { deleteAssetBlob, isAssetStorageConfigured } from "@/lib/storage/blob";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ assetId: string }>;
}

export async function DELETE(_request: Request, context: RouteContext): Promise<NextResponse> {
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
    const { assetId } = await context.params;
    const deletion = await markAssetForDeletion(access.workspace.id, assetId);

    try {
      await deleteAssetBlob(deletion.storageKey);
    } catch {
      return NextResponse.json(
        {
          error: "asset_delete_pending",
          code: "asset_delete_pending",
          message: "Asset deletion is queued and will retry automatically.",
        },
        { status: 202 },
      );
    }
    await finalizeAssetDeletion(deletion);
    return NextResponse.json({ assetId: deletion.assetId, deleted: true });
  } catch (error) {
    if (error instanceof AssetInUseError) {
      return NextResponse.json(
        { error: error.code, code: error.code, message: error.message },
        { status: 409 },
      );
    }
    return contentApiFailure(error, "asset_delete");
  }
}
