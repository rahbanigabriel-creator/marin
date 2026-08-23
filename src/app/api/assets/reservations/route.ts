import { NextResponse } from "next/server";

import {
  contentApiFailure,
  databaseUnavailable,
  readJson,
  requireContentMutationAccess,
} from "@/app/api/content/_lib/http";
import {
  releaseAssetStorageReservation,
  reserveAssetStorage,
  StorageLimitExceededError,
  type AssetStorageReservation,
} from "@/lib/billing/storage";
import { ContentValidationError } from "@/lib/content/errors";
import {
  kindForClaimedAssetMime,
  normalizeClaimedAssetMime,
} from "@/lib/storage/asset-file";
import {
  createAssetUploadUrl,
  isAssetStorageConfigured,
  MAX_ASSET_BYTES,
} from "@/lib/storage/blob";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface ReservationInput {
  filename: string;
  bytes: number;
  mimeType: string;
}

function parseReservationInput(value: unknown): ReservationInput {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ContentValidationError("invalid_asset", "Asset details are required.");
  }
  const record = value as Record<string, unknown>;
  const filename = typeof record.filename === "string" ? record.filename.trim() : "";
  const bytes = record.bytes;
  const claimedMime = typeof record.mimeType === "string" ? record.mimeType : "";
  const mimeType = normalizeClaimedAssetMime(claimedMime);
  if (!filename || filename.length > 255) {
    throw new ContentValidationError(
      "invalid_asset_filename",
      "Choose a file with a name shorter than 256 characters.",
    );
  }
  if (!Number.isSafeInteger(bytes) || Number(bytes) <= 0 || Number(bytes) > MAX_ASSET_BYTES) {
    throw new ContentValidationError(
      "invalid_asset_size",
      "Choose a file between 1 byte and 30 MB.",
    );
  }
  if (!mimeType || !kindForClaimedAssetMime(mimeType)) {
    throw new ContentValidationError(
      "invalid_asset_type",
      "Use a PNG, JPEG, WebP, GIF, MP4, MOV, or WebM file.",
    );
  }
  return { filename, bytes: Number(bytes), mimeType };
}

function storageLimitResponse(error: StorageLimitExceededError): NextResponse {
  return NextResponse.json(
    {
      error: error.code,
      code: error.code,
      message: error.message,
      actionUrl: error.actionUrl,
      currentBytes: error.currentBytes,
      requestedBytes: error.requestedBytes,
      limitBytes: error.limitBytes,
    },
    { status: 402 },
  );
}

export async function POST(request: Request): Promise<NextResponse> {
  const unavailable = databaseUnavailable();
  if (unavailable) return unavailable;
  if (!isAssetStorageConfigured()) {
    return NextResponse.json(
      { error: "asset_storage_unavailable", message: "Asset storage is not configured." },
      { status: 503 },
    );
  }

  let reservation: AssetStorageReservation | null = null;
  try {
    const access = await requireContentMutationAccess();
    const input = parseReservationInput(await readJson(request));
    const kind = kindForClaimedAssetMime(input.mimeType);
    if (!kind) {
      throw new ContentValidationError("invalid_asset_type", "Unsupported asset type.");
    }
    reservation = await reserveAssetStorage({
      workspaceId: access.workspace.id,
      kind,
      mimeType: input.mimeType,
      bytes: input.bytes,
      filename: input.filename,
      source: "upload",
      metadata: { uploadMode: "direct" },
    });
    const upload = await createAssetUploadUrl({
      workspaceId: access.workspace.id,
      assetId: reservation.id,
      filename: input.filename,
      mimeType: input.mimeType,
      maximumSizeInBytes: input.bytes,
    });
    return NextResponse.json(
      {
        reservationId: reservation.id,
        pathname: upload.pathname,
        uploadUrl: upload.uploadUrl,
        validUntil: new Date(upload.validUntil).toISOString(),
      },
      { status: 201 },
    );
  } catch (error) {
    if (reservation) {
      await releaseAssetStorageReservation(reservation).catch(() => undefined);
    }
    if (error instanceof StorageLimitExceededError) return storageLimitResponse(error);
    return contentApiFailure(error, "asset_upload_reserve");
  }
}
