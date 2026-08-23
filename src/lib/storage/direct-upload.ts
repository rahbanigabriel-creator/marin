import type { Asset } from "@prisma/client";

import {
  commitAssetStorageReservation,
  isPendingAssetStorageKey,
  PENDING_ASSET_STORAGE_PREFIX,
  releaseAssetStorageReservation,
} from "@/lib/billing/storage";
import { ContentNotFoundError, ContentValidationError } from "@/lib/content/errors";
import { prisma } from "@/lib/db";
import { verifyStoredAsset } from "@/lib/storage/asset-file";
import { assetBlobPath } from "@/lib/storage/asset-path";

type StoredAssetInspection = {
  size: number;
  contentType: string;
  prefix: Buffer;
};

export interface DirectUploadCompletionDependencies {
  inspectAssetBlob?: (storageKey: string) => Promise<StoredAssetInspection | null>;
  deleteReservationBlobs?: (workspaceId: string, assetId: string) => Promise<number>;
}

export class DirectUploadPendingError extends Error {
  constructor(
    readonly code: "asset_storage_pending" | "asset_settlement_unknown",
    message: string,
  ) {
    super(message);
    this.name = "DirectUploadPendingError";
  }
}

export class DirectUploadReservationInactiveError extends Error {
  readonly code = "reservation_not_active" as const;

  constructor() {
    super("This upload reservation is no longer active.");
    this.name = "DirectUploadReservationInactiveError";
  }
}

export function parseDirectUploadCompletionInput(value: unknown): { pathname: string } {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ContentValidationError("invalid_asset_completion", "Upload details are required.");
  }
  const pathname = typeof (value as Record<string, unknown>).pathname === "string"
    ? String((value as Record<string, unknown>).pathname).trim()
    : "";
  if (!pathname || pathname.length > 512) {
    throw new ContentValidationError("invalid_asset_path", "The uploaded asset path is invalid.");
  }
  return { pathname };
}

export async function completeDirectAssetUpload(
  input: {
    workspaceId: string;
    reservationId: string;
    pathname: string;
  },
  dependencies: DirectUploadCompletionDependencies = {},
): Promise<{ asset: Asset; reused: boolean }> {
  const asset = await prisma.asset.findFirst({
    where: { id: input.reservationId, workspaceId: input.workspaceId },
  });
  if (!asset) throw new ContentNotFoundError("asset");

  const expectedPath = assetBlobPath(
    input.workspaceId,
    asset.id,
    asset.filename || "asset",
  );
  if (input.pathname !== expectedPath) {
    throw new ContentValidationError(
      "invalid_asset_path",
      "The uploaded object does not belong to this reservation.",
    );
  }

  const activeReservationKey = `${PENDING_ASSET_STORAGE_PREFIX}${asset.id}`;
  if (!isPendingAssetStorageKey(asset.storageKey) || asset.storageKey !== activeReservationKey) {
    if (asset.storageKey === expectedPath) return { asset, reused: true };
    throw new DirectUploadReservationInactiveError();
  }

  const inspectAssetBlob = dependencies.inspectAssetBlob ??
    (await import("@/lib/storage/blob")).inspectAssetBlob;
  let inspected: StoredAssetInspection | null;
  try {
    inspected = await inspectAssetBlob(expectedPath);
  } catch {
    throw new DirectUploadPendingError(
      "asset_storage_pending",
      "The upload is still being verified. Try again shortly.",
    );
  }
  if (!inspected) {
    throw new DirectUploadPendingError(
      "asset_storage_pending",
      "The upload is not visible yet. Try again shortly.",
    );
  }

  const verified = verifyStoredAsset({
    expectedBytes: asset.bytes,
    expectedKind: asset.kind === "video" ? "video" : "image",
    expectedMimeType: asset.mimeType,
    storedBytes: inspected.size,
    storedContentType: inspected.contentType,
    prefix: inspected.prefix,
  });
  if (!verified) {
    await releaseAssetStorageReservation(
      {
        id: asset.id,
        workspaceId: asset.workspaceId,
        pendingStorageKey: asset.storageKey,
      },
      dependencies.deleteReservationBlobs
        ? { deleteReservationBlobs: dependencies.deleteReservationBlobs }
        : {},
    );
    throw new ContentValidationError(
      "asset_verification_failed",
      "The uploaded bytes did not match the reserved file.",
    );
  }

  try {
    await commitAssetStorageReservation(
      {
        id: asset.id,
        workspaceId: asset.workspaceId,
        pendingStorageKey: asset.storageKey,
      },
      expectedPath,
    );
  } catch {
    const settled = await prisma.asset.findFirst({
      where: { id: asset.id, workspaceId: asset.workspaceId },
    }).catch(() => null);
    if (settled?.storageKey === expectedPath) return { asset: settled, reused: true };
    throw new DirectUploadPendingError(
      "asset_settlement_unknown",
      "The upload is still being reconciled. Try again shortly.",
    );
  }

  const committed = await prisma.asset.findFirstOrThrow({
    where: { id: asset.id, workspaceId: asset.workspaceId, storageKey: expectedPath },
  });
  return { asset: committed, reused: false };
}
