import { deletingAssetStorageKey, isUnavailableAssetStorageKey } from "@/lib/billing/storage";
import { ContentNotFoundError } from "@/lib/content/errors";
import { prisma } from "@/lib/db";

export class AssetInUseError extends Error {
  readonly code = "asset_in_use" as const;

  constructor() {
    super("Detach this asset from every content item before deleting it.");
    this.name = "AssetInUseError";
  }
}

export interface MarkedAssetDeletion {
  assetId: string;
  workspaceId: string;
  storageKey: string;
  deletionKey: string;
}

/**
 * Serialize deletion with attachment on the asset row. Once marked, no new
 * attachment can pass the availability check; if attachment wins, deletion
 * observes the durable link and fails without touching the blob.
 */
export async function markAssetForDeletion(
  workspaceId: string,
  assetId: string,
): Promise<MarkedAssetDeletion> {
  return prisma.$transaction(async (tx) => {
    const locked = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT "id"
      FROM "assets"
      WHERE "id" = ${assetId}
        AND "workspace_id" = ${workspaceId}
      FOR UPDATE
    `;
    if (!locked.length) throw new ContentNotFoundError("asset");

    const asset = await tx.asset.findFirst({
      where: { id: assetId, workspaceId },
      include: { _count: { select: { contentLinks: true } } },
    });
    if (!asset || isUnavailableAssetStorageKey(asset.storageKey)) {
      throw new ContentNotFoundError("asset");
    }
    if (asset._count.contentLinks > 0) throw new AssetInUseError();

    const deletionKey = deletingAssetStorageKey(asset.storageKey);
    await tx.asset.update({
      where: { id: asset.id },
      data: { storageKey: deletionKey },
    });
    return {
      assetId: asset.id,
      workspaceId,
      storageKey: asset.storageKey,
      deletionKey,
    };
  });
}

export async function finalizeAssetDeletion(
  deletion: MarkedAssetDeletion,
): Promise<boolean> {
  const deleted = await prisma.asset.deleteMany({
    where: {
      id: deletion.assetId,
      workspaceId: deletion.workspaceId,
      storageKey: deletion.deletionKey,
      contentLinks: { none: {} },
    },
  });
  return deleted.count === 1;
}
