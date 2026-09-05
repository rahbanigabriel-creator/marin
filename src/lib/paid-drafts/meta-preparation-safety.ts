import { createHash, timingSafeEqual } from "node:crypto";
import type { Connection, Prisma } from "@prisma/client";

import { assetBlobPrefix } from "@/lib/storage/asset-path";
import { detectAssetFile } from "@/lib/storage/asset-file";
import { assertPaidDraftAssetSuitability, paidDraftAssetIds } from "./assets";
import { PaidDraftConflictError } from "./errors";
import { assertMetaPausedSnapshot } from "./meta-paused-contract";
import type { PaidCampaignSnapshotV1 } from "./types";

export const META_PREPARATION_TIMEOUT_MS = 45_000;
export const META_PREPARATION_MAX_IN_FLIGHT = 8;
export const META_PREPARATION_MAX_IMAGE_BYTES = 8 * 1_024 * 1_024;

export interface MetaCompletedAsset {
  id: string;
  kind: string;
  mimeType: string;
  bytes: number;
  storageKey: string;
}

export function assertMetaCompletedAssets(
  workspaceId: string,
  snapshot: PaidCampaignSnapshotV1,
  assets: readonly MetaCompletedAsset[],
): void {
  if (snapshot.platform !== "meta_ads" || !snapshot.metaDelivery) return;
  assertMetaPausedSnapshot(snapshot);
  assertPaidDraftAssetSuitability(snapshot, assets);
  const expectedIds = new Set(paidDraftAssetIds(snapshot));
  const safeId = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,190}$/;
  if (!safeId.test(workspaceId) || assets.length !== expectedIds.size
    || new Set(assets.map((asset) => asset.id)).size !== assets.length) {
    throw unavailableAsset();
  }
  for (const asset of assets) {
    const prefix = assetBlobPrefix(workspaceId, asset.id);
    const filename = asset.storageKey.slice(prefix.length);
    // Completed uploads use immutable, non-overwritable private keys. Reservation/deletion markers cannot match.
    if (!expectedIds.has(asset.id) || !safeId.test(asset.id) || asset.kind !== "image"
      || !["image/png", "image/jpeg"].includes(asset.mimeType)
      || !Number.isSafeInteger(asset.bytes) || asset.bytes < 1 || asset.bytes > META_PREPARATION_MAX_IMAGE_BYTES
      || !asset.storageKey.startsWith(prefix) || !/^[A-Za-z0-9._-]{1,80}$/.test(filename)
      || filename === "." || filename === "..") {
      throw unavailableAsset();
    }
  }
}

function unavailableAsset(): PaidDraftConflictError {
  return new PaidDraftConflictError("meta_asset_unavailable", "Use a completed private JPG or PNG upload of 8 MB or less.");
}

function changedAsset(): PaidDraftConflictError {
  return new PaidDraftConflictError("meta_asset_changed", "The approved image no longer matches the saved asset.");
}

function changedConnection(): PaidDraftConflictError {
  return new PaidDraftConflictError("meta_connection_changed", "The Meta connection changed or expired. Refresh the connection and review the draft again.");
}

export type MetaConnectionGenerationFields = Pick<Connection,
  "id" | "workspaceId" | "platform" | "externalAccountId" | "encAccessToken" | "encRefreshToken" | "expiresAt" | "status"
>;

/** Server-only credential-generation fingerprint; never include it or its input in a client DTO. */
export function metaConnectionGeneration(connection: MetaConnectionGenerationFields): string {
  try {
    return createHash("sha256").update(JSON.stringify([
      "meta-connection-generation-v1", connection.id, connection.workspaceId, connection.platform,
      connection.externalAccountId, connection.encAccessToken, connection.encRefreshToken,
      connection.expiresAt?.toISOString() ?? null, connection.status,
    ])).digest("hex");
  } catch {
    throw changedConnection();
  }
}

export async function assertMetaConnectionGeneration(
  db: Pick<Prisma.TransactionClient, "connection">,
  connectionId: string,
  workspaceId: string,
  expectedGeneration: string,
): Promise<void> {
  if (!/^[a-f0-9]{64}$/.test(expectedGeneration)) throw changedConnection();
  const current = await db.connection.findFirst({
    where: { id: connectionId, workspaceId },
    select: {
      id: true, workspaceId: true, platform: true, externalAccountId: true, encAccessToken: true,
      encRefreshToken: true, expiresAt: true, status: true,
    },
  });
  if (!current || current.id !== connectionId || current.workspaceId !== workspaceId
    || current.platform !== "meta_ads" || current.status !== "connected" || !current.encAccessToken
    || (current.expiresAt !== null && (!Number.isFinite(current.expiresAt.getTime()) || current.expiresAt.getTime() <= Date.now()))
    || !timingSafeEqual(Buffer.from(metaConnectionGeneration(current), "hex"), Buffer.from(expectedGeneration, "hex"))) {
    throw changedConnection();
  }
}

export function metaPreparationTimeout(): PaidDraftConflictError {
  return new PaidDraftConflictError("meta_preparation_timeout", "Preparing the approved images took too long. Nothing was created in Meta. Try again.");
}

/** All asynchronous preparation stages share one deadline, including late SDK/database completions. */
export class MetaPreparationDeadline {
  readonly controller = new AbortController();
  readonly expiresAt: number;
  private readonly expired: Promise<never>;
  private readonly timer: ReturnType<typeof setTimeout>;

  constructor(timeoutMs = META_PREPARATION_TIMEOUT_MS) {
    this.expiresAt = Date.now() + timeoutMs;
    let rejectExpired!: (error: Error) => void;
    this.expired = new Promise<never>((_, reject) => {
      rejectExpired = reject;
    });
    this.timer = setTimeout(() => {
      this.controller.abort();
      rejectExpired(metaPreparationTimeout());
    }, timeoutMs);
    // A caller can synchronously reject before starting its first guarded stage.
    void this.expired.catch(() => {});
  }

  get signal(): AbortSignal { return this.controller.signal; }

  assertCurrent(): void {
    if (this.signal.aborted || Date.now() >= this.expiresAt) throw metaPreparationTimeout();
  }

  async wait<T>(load: () => Promise<T>, disposeLate?: (value: T) => void): Promise<T> {
    this.assertCurrent();
    const pending = Promise.resolve().then(() => {
      this.assertCurrent();
      return load();
    }).then((value) => {
      if (this.signal.aborted || Date.now() >= this.expiresAt) {
        disposeLate?.(value);
        throw metaPreparationTimeout();
      }
      return value;
    });
    return Promise.race([pending, this.expired]);
  }

  dispose(): void { clearTimeout(this.timer); }
}

/** Only in-flight promises are retained; settled buffers/results are never cached. */
export function createMetaPreparationGate<T>(maximum = META_PREPARATION_MAX_IN_FLIGHT) {
  const flights = new Map<string, Promise<T>>();
  return (key: string, load: (deadline: MetaPreparationDeadline) => Promise<T>): Promise<T> => {
    const existing = flights.get(key);
    if (existing) return existing;
    if (flights.size >= maximum) {
      return Promise.reject(new PaidDraftConflictError("meta_preparation_busy", "Too many campaign preparations are in progress. Try again shortly."));
    }
    const deadline = new MetaPreparationDeadline();
    const pending = deadline.wait(() => load(deadline)).finally(() => {
      deadline.dispose();
      if (flights.get(key) === pending) flights.delete(key);
    });
    flights.set(key, pending);
    return pending;
  };
}

export interface MetaPrivateAssetBlob {
  statusCode: number;
  stream: ReadableStream<Uint8Array> | null;
  blob: { pathname: string; contentType: string | null; size: number | null };
}

export function cancelMetaAssetBlob(blob: MetaPrivateAssetBlob | null): void {
  void blob?.stream?.cancel().catch(() => {});
}

export async function readMetaPreparedImage(
  asset: MetaCompletedAsset,
  blob: MetaPrivateAssetBlob | null,
  deadline: MetaPreparationDeadline,
): Promise<Buffer> {
  try {
    deadline.assertCurrent();
    if (!blob || blob.statusCode !== 200 || !blob.stream) throw unavailableAsset();
    if (blob.blob.pathname !== asset.storageKey || blob.blob.size !== asset.bytes || blob.blob.contentType !== asset.mimeType) {
      throw changedAsset();
    }
  } catch (error) {
    cancelMetaAssetBlob(blob);
    throw error;
  }
  const reader = blob.stream.getReader();
  const cancel = () => { void reader.cancel().catch(() => {}); };
  deadline.signal.addEventListener("abort", cancel, { once: true });
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const next = await deadline.wait(() => reader.read());
      if (next.done) break;
      size += next.value.byteLength;
      if (size > asset.bytes || size > META_PREPARATION_MAX_IMAGE_BYTES) throw changedAsset();
      chunks.push(next.value);
    }
    const bytes = Buffer.concat(chunks, size);
    const detected = detectAssetFile(bytes);
    if (size !== asset.bytes || detected?.mimeType !== asset.mimeType || detected?.kind !== "image") throw changedAsset();
    return bytes;
  } catch (error) {
    if (error instanceof PaidDraftConflictError) throw error;
    throw unavailableAsset();
  } finally {
    deadline.signal.removeEventListener("abort", cancel);
    cancel(); // A misbehaving stream's cancel promise must not extend the deadline.
    reader.releaseLock();
  }
}
