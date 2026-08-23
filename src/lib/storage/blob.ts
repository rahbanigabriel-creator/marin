import "server-only";
import {
  del,
  get,
  issueSignedToken,
  list,
  presignUrl,
  put,
  type GetBlobResult,
} from "@vercel/blob";

import { assetBlobPath, assetBlobPrefix } from "@/lib/storage/asset-path";

export { MAX_ASSET_BYTES, MAX_SERVER_ASSET_BYTES } from "@/lib/storage/limits";
export { assetBlobPath, assetBlobPrefix } from "@/lib/storage/asset-path";

/**
 * Asset storage on Vercel Blob. Graceful-without-keys: gated on
 * BLOB_READ_WRITE_TOKEN (mirrors isVaultConfigured). Without it, uploads are
 * refused cleanly and `needsAsset` action steps degrade to "Copy brief".
 */
export function isAssetStorageConfigured(): boolean {
  return Boolean(
    process.env.BLOB_READ_WRITE_TOKEN ||
      (process.env.VERCEL_OIDC_TOKEN && process.env.BLOB_STORE_ID),
  );
}

export interface StoredBlob {
  url: string;
  pathname: string;
}

/** Store user content in a private workspace namespace. */
export async function putAsset(
  workspaceId: string,
  assetId: string,
  filename: string,
  body: ArrayBuffer | Buffer,
  contentType: string,
): Promise<StoredBlob> {
  const res = await put(assetBlobPath(workspaceId, assetId, filename), body, {
    access: "private",
    addRandomSuffix: false,
    allowOverwrite: false,
    contentType,
    token: process.env.BLOB_READ_WRITE_TOKEN,
  });
  return { url: res.url, pathname: res.pathname };
}

/** Issue a short-lived, pathname-bound private PUT URL for browser-to-Blob uploads. */
export async function createAssetUploadUrl(input: {
  workspaceId: string;
  assetId: string;
  filename: string;
  mimeType: string;
  maximumSizeInBytes: number;
}): Promise<{ pathname: string; uploadUrl: string; validUntil: number }> {
  const pathname = assetBlobPath(input.workspaceId, input.assetId, input.filename);
  const validUntil = Date.now() + 15 * 60 * 1_000;
  const token = await issueSignedToken({
    pathname,
    operations: ["put"],
    allowedContentTypes: [input.mimeType],
    maximumSizeInBytes: input.maximumSizeInBytes,
    validUntil,
    token: process.env.BLOB_READ_WRITE_TOKEN,
  });
  const { presignedUrl } = await presignUrl(token, {
    operation: "put",
    pathname,
    access: "private",
    allowedContentTypes: [input.mimeType],
    maximumSizeInBytes: input.maximumSizeInBytes,
    validUntil,
    addRandomSuffix: false,
    allowOverwrite: false,
  });
  return { pathname, uploadUrl: presignedUrl, validUntil };
}

/** Delete every object belonging to a reservation, including an interrupted put. */
export async function deleteAssetReservationBlobs(
  workspaceId: string,
  assetId: string,
): Promise<number> {
  const prefix = assetBlobPrefix(workspaceId, assetId);
  let cursor: string | undefined;
  let deleted = 0;
  for (let page = 0; page < 20; page += 1) {
    const result = await list({
      prefix,
      cursor,
      limit: 100,
      token: process.env.BLOB_READ_WRITE_TOKEN,
    });
    if (result.blobs.length) {
      await del(result.blobs.map((blob) => blob.pathname), {
        token: process.env.BLOB_READ_WRITE_TOKEN,
      });
      deleted += result.blobs.length;
    }
    if (!result.hasMore || !result.cursor) break;
    cursor = result.cursor;
  }
  return deleted;
}

export async function getAssetBlob(
  storageKey: string,
  ifNoneMatch?: string,
): Promise<GetBlobResult | null> {
  return get(storageKey, {
    access: "private",
    ifNoneMatch,
    token: process.env.BLOB_READ_WRITE_TOKEN,
  });
}

export async function inspectAssetBlob(
  storageKey: string,
  prefixBytes = 64,
): Promise<{ size: number; contentType: string; prefix: Buffer } | null> {
  const result = await getAssetBlob(storageKey);
  if (!result || result.statusCode !== 200) return null;
  const reader = result.stream.getReader();
  const chunks: Uint8Array[] = [];
  let collected = 0;
  try {
    while (collected < prefixBytes) {
      const next = await reader.read();
      if (next.done) break;
      chunks.push(next.value);
      collected += next.value.byteLength;
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }
  return {
    size: result.blob.size,
    contentType: result.blob.contentType,
    prefix: Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))).subarray(0, prefixBytes),
  };
}

/** Best-effort callers should catch failures so cleanup never masks the primary error. */
export async function deleteAssetBlob(urlOrPathname: string): Promise<void> {
  await del(urlOrPathname, { token: process.env.BLOB_READ_WRITE_TOKEN });
}

/**
 * Delete the object(s) represented by a server-owned Asset row. Pending upload
 * reservations are prefixes rather than object keys, while deletion markers
 * wrap the original private key. Successful resolution is idempotent.
 */
export async function deleteWorkspaceAssetObject(input: {
  workspaceId: string;
  assetId: string;
  storageKey: string;
}): Promise<void> {
  const pendingPrefix = "marpin:storage-reservation:";
  const deletingPrefix = "marpin:storage-delete:";
  if (input.storageKey.startsWith(pendingPrefix)) {
    await deleteAssetReservationBlobs(input.workspaceId, input.assetId);
    return;
  }
  const key = input.storageKey.startsWith(deletingPrefix)
    ? input.storageKey.slice(deletingPrefix.length)
    : input.storageKey;
  if (!key) throw new Error("Asset storage key is unavailable");
  await deleteAssetBlob(key);
}
