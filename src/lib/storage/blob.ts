import "server-only";
import { put } from "@vercel/blob";

/**
 * Asset storage on Vercel Blob. Graceful-without-keys: gated on
 * BLOB_READ_WRITE_TOKEN (mirrors isVaultConfigured). Without it, uploads are
 * refused cleanly and `needsAsset` action steps degrade to "Copy brief".
 */
export function isAssetStorageConfigured(): boolean {
  return Boolean(process.env.BLOB_READ_WRITE_TOKEN);
}

export interface StoredBlob {
  url: string;
  pathname: string;
}

/** Max upload size (bytes) — 30 MB covers images + short videos. */
export const MAX_ASSET_BYTES = 30 * 1024 * 1024;

/** Store bytes under the workspace namespace; returns the (unguessable) URL. */
export async function putAsset(
  workspaceId: string,
  filename: string,
  body: ArrayBuffer | Buffer,
  contentType: string,
): Promise<StoredBlob> {
  const safe = filename.replace(/[^a-zA-Z0-9._-]/g, "_").slice(-80) || "asset";
  const res = await put(`ws/${workspaceId}/${safe}`, body, {
    access: "public",
    addRandomSuffix: true, // unguessable URL
    contentType,
    token: process.env.BLOB_READ_WRITE_TOKEN,
  });
  return { url: res.url, pathname: res.pathname };
}
