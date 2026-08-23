import assert from "node:assert/strict";
import test from "node:test";

import { PLANS } from "@/lib/billing/plans";
import {
  cleanupDeletingAssets,
  cleanupStaleAssetStorageReservations,
  commitAssetStorageReservation,
  deletingAssetStorageKey,
  PENDING_ASSET_STORAGE_PREFIX,
  releaseAssetStorageReservation,
  reserveAssetStorage,
  STALE_ASSET_STORAGE_RESERVATION_MS,
  StorageLimitExceededError,
} from "@/lib/billing/storage";
import { ContentNotFoundError, ContentValidationError } from "@/lib/content/errors";
import { prisma } from "@/lib/db";
import { assetBlobPath } from "@/lib/storage/asset-path";
import { completeDirectAssetUpload } from "@/lib/storage/direct-upload";

function disposableDatabaseEnabled(): boolean {
  if (process.env.MARPIN_INTEGRATION_DATABASE !== "1") return false;
  try {
    const url = new URL(process.env.DATABASE_URL ?? "");
    return (
      (url.hostname === "127.0.0.1" || url.hostname === "localhost") &&
      /(?:_test|_ci)$/.test(url.pathname.slice(1))
    );
  } catch {
    return false;
  }
}

const integrationTest = disposableDatabaseEnabled() ? test : test.skip;

integrationTest("asset reservations serialize aggregate caps and clean stale rows per tenant", async () => {
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const workspace = await prisma.workspace.create({
    data: { name: "Storage entitlement", slug: `storage-${suffix}` },
  });
  const otherWorkspace = await prisma.workspace.create({
    data: { name: "Other storage tenant", slug: `other-storage-${suffix}` },
  });
  const freeLimit = PLANS.free.entitlements.storageBytes;

  try {
    await prisma.asset.createMany({
      data: [
        {
          workspaceId: workspace.id,
          kind: "image",
          mimeType: "image/png",
          bytes: freeLimit,
          storageKey: `${PENDING_ASSET_STORAGE_PREFIX}stale`,
          createdAt: new Date(Date.now() - STALE_ASSET_STORAGE_RESERVATION_MS - 1_000),
        },
        {
          workspaceId: otherWorkspace.id,
          kind: "video",
          mimeType: "video/mp4",
          bytes: freeLimit,
          storageKey: "https://blob.example/other-tenant.mp4",
        },
      ],
    });

    const staleCleanup = await cleanupStaleAssetStorageReservations({
      workspaceId: workspace.id,
      deleteReservationBlobs: async () => 0,
    });
    assert.deepEqual(staleCleanup, {
      claimed: 1,
      deletedRows: 1,
      deletedBlobs: 0,
      failed: 0,
    });

    const base = await reserveAssetStorage({
      workspaceId: workspace.id,
      kind: "image",
      mimeType: "image/png",
      bytes: freeLimit - 10,
      filename: "base.png",
    });
    assert.equal(base.currentBytes, 0, "the stale pending row must not consume the cap");
    await commitAssetStorageReservation(base, "https://blob.example/base.png");
    let finalizedBlobDeletes = 0;
    await releaseAssetStorageReservation(base, {
      deleteReservationBlobs: async () => {
        finalizedBlobDeletes += 1;
        return 1;
      },
    });
    assert.equal(finalizedBlobDeletes, 0, "a finalized asset must never enter Blob cleanup");
    assert.equal(
      await prisma.asset.count({
        where: {
          id: base.id,
          workspaceId: workspace.id,
          storageKey: "https://blob.example/base.png",
        },
      }),
      1,
    );

    const attempts = await Promise.allSettled([
      reserveAssetStorage({
        workspaceId: workspace.id,
        kind: "image",
        mimeType: "image/png",
        bytes: 10,
        filename: "race-a.png",
      }),
      reserveAssetStorage({
        workspaceId: workspace.id,
        kind: "image",
        mimeType: "image/png",
        bytes: 10,
        filename: "race-b.png",
      }),
    ]);

    const winners = attempts.filter(
      (attempt): attempt is PromiseFulfilledResult<Awaited<ReturnType<typeof reserveAssetStorage>>> =>
        attempt.status === "fulfilled",
    );
    const denied = attempts.filter(
      (attempt): attempt is PromiseRejectedResult => attempt.status === "rejected",
    );
    assert.equal(winners.length, 1);
    assert.equal(denied.length, 1);
    assert.ok(denied[0]?.reason instanceof StorageLimitExceededError);

    const pending = await prisma.asset.findMany({
      where: {
        workspaceId: workspace.id,
        storageKey: { startsWith: PENDING_ASSET_STORAGE_PREFIX },
      },
    });
    assert.equal(pending.length, 1);
    await releaseAssetStorageReservation(winners[0]!.value, {
      deleteReservationBlobs: async () => 0,
    });

    await assert.rejects(
      () =>
        reserveAssetStorage({
          workspaceId: workspace.id,
          kind: "image",
          mimeType: "image/png",
          bytes: 11,
          filename: "over-cap.png",
        }),
      StorageLimitExceededError,
    );

    const originalStorageKey = "ws/storage-test/deleting/unused.png";
    await prisma.asset.create({
      data: {
        workspaceId: workspace.id,
        kind: "image",
        mimeType: "image/png",
        bytes: 0,
        storageKey: deletingAssetStorageKey(originalStorageKey),
      },
    });
    const linkedStorageKey = "ws/storage-test/deleting/still-linked.png";
    const linkedAsset = await prisma.asset.create({
      data: {
        workspaceId: workspace.id,
        kind: "image",
        mimeType: "image/png",
        bytes: 0,
        storageKey: deletingAssetStorageKey(linkedStorageKey),
      },
    });
    const linkedItem = await prisma.contentItem.create({
      data: {
        workspaceId: workspace.id,
        status: "draft",
        source: "manual",
        title: "Keep linked media",
      },
    });
    await prisma.contentItemAsset.create({
      data: { contentItemId: linkedItem.id, assetId: linkedAsset.id },
    });
    const deletedKeys: string[] = [];
    const deletionCleanup = await cleanupDeletingAssets({
      workspaceId: workspace.id,
      deleteBlob: async (storageKey) => { deletedKeys.push(storageKey); },
    });
    assert.deepEqual(deletionCleanup, { deletedRows: 1, deletedBlobs: 1, failed: 0 });
    assert.deepEqual(deletedKeys, [originalStorageKey]);
    assert.equal(
      (await prisma.asset.findUniqueOrThrow({ where: { id: linkedAsset.id } })).storageKey,
      linkedStorageKey,
      "cleanup must restore a legacy deletion marker when the asset is still referenced",
    );
    assert.equal(
      await prisma.asset.count({ where: { workspaceId: otherWorkspace.id } }),
      1,
      "storage cleanup and accounting must remain tenant-scoped",
    );
  } finally {
    await prisma.workspace.delete({ where: { id: workspace.id } }).catch(() => undefined);
    await prisma.workspace.delete({ where: { id: otherWorkspace.id } }).catch(() => undefined);
    await prisma.$disconnect();
  }
});

integrationTest("direct upload completion enforces tenant, path, bytes, MIME, and replay boundaries", async () => {
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const workspace = await prisma.workspace.create({
    data: { name: "Direct upload", slug: `direct-upload-${suffix}` },
  });
  const otherWorkspace = await prisma.workspace.create({
    data: { name: "Direct upload other", slug: `direct-upload-other-${suffix}` },
  });
  const png = Buffer.alloc(16);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(png);

  try {
    const valid = await reserveAssetStorage({
      workspaceId: workspace.id,
      kind: "image",
      mimeType: "image/png",
      bytes: png.length,
      filename: "launch visual.png",
    });
    const validPath = assetBlobPath(workspace.id, valid.id, "launch visual.png");

    await assert.rejects(
      () => completeDirectAssetUpload(
        {
          workspaceId: otherWorkspace.id,
          reservationId: valid.id,
          pathname: validPath,
        },
        { inspectAssetBlob: async () => ({ size: png.length, contentType: "image/png", prefix: png }) },
      ),
      ContentNotFoundError,
    );
    await assert.rejects(
      () => completeDirectAssetUpload(
        {
          workspaceId: workspace.id,
          reservationId: valid.id,
          pathname: `${validPath}.forged`,
        },
        { inspectAssetBlob: async () => ({ size: png.length, contentType: "image/png", prefix: png }) },
      ),
      (error) => error instanceof ContentValidationError && error.code === "invalid_asset_path",
    );

    let inspections = 0;
    const completed = await completeDirectAssetUpload(
      { workspaceId: workspace.id, reservationId: valid.id, pathname: validPath },
      {
        inspectAssetBlob: async (pathname) => {
          inspections += 1;
          assert.equal(pathname, validPath);
          return { size: png.length, contentType: "image/png", prefix: png };
        },
      },
    );
    assert.equal(completed.reused, false);
    assert.equal(completed.asset.storageKey, validPath);

    const replayed = await completeDirectAssetUpload(
      { workspaceId: workspace.id, reservationId: valid.id, pathname: validPath },
      {
        inspectAssetBlob: async () => {
          inspections += 1;
          throw new Error("a finalized replay must not inspect Blob again");
        },
      },
    );
    assert.equal(replayed.reused, true);
    assert.equal(replayed.asset.storageKey, validPath);
    assert.equal(inspections, 1);

    for (const invalid of [
      { label: "size", size: png.length - 1, contentType: "image/png" },
      { label: "mime", size: png.length, contentType: "image/jpeg" },
    ]) {
      const reservation = await reserveAssetStorage({
        workspaceId: workspace.id,
        kind: "image",
        mimeType: "image/png",
        bytes: png.length,
        filename: `invalid-${invalid.label}.png`,
      });
      const pathname = assetBlobPath(
        workspace.id,
        reservation.id,
        `invalid-${invalid.label}.png`,
      );
      const deleted: Array<{ workspaceId: string; assetId: string }> = [];
      await assert.rejects(
        () => completeDirectAssetUpload(
          { workspaceId: workspace.id, reservationId: reservation.id, pathname },
          {
            inspectAssetBlob: async () => ({
              size: invalid.size,
              contentType: invalid.contentType,
              prefix: png,
            }),
            deleteReservationBlobs: async (workspaceId, assetId) => {
              deleted.push({ workspaceId, assetId });
              return 1;
            },
          },
        ),
        (error) =>
          error instanceof ContentValidationError && error.code === "asset_verification_failed",
      );
      assert.deepEqual(deleted, [{ workspaceId: workspace.id, assetId: reservation.id }]);
      assert.equal(
        await prisma.asset.count({ where: { id: reservation.id, workspaceId: workspace.id } }),
        0,
      );
    }
  } finally {
    await prisma.workspace.delete({ where: { id: workspace.id } }).catch(() => undefined);
    await prisma.workspace.delete({ where: { id: otherWorkspace.id } }).catch(() => undefined);
    await prisma.$disconnect();
  }
});
