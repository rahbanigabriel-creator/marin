import { NextResponse, type NextRequest } from "next/server";

import {
  contentApiFailure,
  requireContentMutationAccess,
} from "@/app/api/content/_lib/http";
import { readAssetUploadForm } from "@/app/api/assets/_lib/request";
import { getCurrentWorkspace } from "@/lib/auth";
import { workspaceSeatLimitResponse } from "@/lib/auth-http";
import {
  commitAssetStorageReservation,
  DELETING_ASSET_STORAGE_PREFIX,
  isUnavailableAssetStorageKey,
  PENDING_ASSET_STORAGE_PREFIX,
  releaseAssetStorageReservation,
  reserveAssetStorage,
  StorageLimitExceededError,
  type AssetStorageReservation,
} from "@/lib/billing/storage";
import { toContentAssetDto } from "@/lib/content/service";
import { isImageGenerationConfigured } from "@/lib/creative/image-provider";
import { isDatabaseConfigured, prisma } from "@/lib/db";
import { claimedMimeMatches, detectAssetFile } from "@/lib/storage/asset-file";
import { requestBodyErrorResponse } from "@/lib/security/request-body";
import {
  isAssetStorageConfigured,
  putAsset,
  MAX_ASSET_BYTES,
  MAX_SERVER_ASSET_BYTES,
  type StoredBlob,
} from "@/lib/storage/blob";

/**
 * POST /api/assets — upload one creative (image/video) for the current workspace,
 * to attach to an action step. Multipart form-data with a `file` field. Graceful:
 * returns { ok:false, reason } (not a throw) when storage/DB isn't configured, so
 * the action card can fall back to "Copy brief".
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const ASSET_PAGE_SIZE = 48;

export async function GET(req: NextRequest): Promise<Response> {
  if (!isDatabaseConfigured()) {
    return NextResponse.json({ error: "database_unavailable" }, { status: 503 });
  }
  let workspace;
  try {
    workspace = await getCurrentWorkspace();
  } catch (error) {
    const seatLimit = workspaceSeatLimitResponse(error);
    if (seatLimit) return seatLimit;
    throw error;
  }
  if (!workspace) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }
  const cursor = req.nextUrl.searchParams.get("cursor")?.trim() || null;
  if (cursor && !/^[A-Za-z0-9_-]{1,191}$/.test(cursor)) {
    return NextResponse.json({ error: "invalid_cursor" }, { status: 400 });
  }
  const rows = await prisma.asset.findMany({
    where: {
      workspaceId: workspace.id,
      NOT: [
        { storageKey: { startsWith: PENDING_ASSET_STORAGE_PREFIX } },
        { storageKey: { startsWith: DELETING_ASSET_STORAGE_PREFIX } },
      ],
    },
    orderBy: [{ createdAt: "desc" }, { id: "asc" }],
    take: ASSET_PAGE_SIZE + 1,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
  });
  const hasMore = rows.length > ASSET_PAGE_SIZE;
  const assets = rows.slice(0, ASSET_PAGE_SIZE);
  return NextResponse.json({
    capabilities: {
      imageGeneration: isAssetStorageConfigured() && isImageGenerationConfigured(),
    },
    assets: assets
      .filter((asset) => !isUnavailableAssetStorageKey(asset.storageKey))
      .map(toContentAssetDto),
    nextCursor: hasMore ? assets.at(-1)?.id ?? null : null,
  });
}

export async function POST(req: NextRequest): Promise<Response> {
  if (!isAssetStorageConfigured()) {
    return NextResponse.json({ ok: false, reason: "Asset storage isn't configured yet." });
  }
  if (!isDatabaseConfigured()) {
    return NextResponse.json({ ok: false, reason: "Database not configured." });
  }
  let workspace;
  try {
    workspace = (await requireContentMutationAccess()).workspace;
  } catch (error) {
    const seatLimit = workspaceSeatLimitResponse(error);
    if (seatLimit) return seatLimit;
    return contentApiFailure(error, "asset_upload");
  }

  let form: FormData;
  try {
    form = await readAssetUploadForm(req);
  } catch (error) {
    const bodyFailure = requestBodyErrorResponse(error);
    if (bodyFailure) return bodyFailure;
    return NextResponse.json({ ok: false, reason: "bad upload" }, { status: 400 });
  }
  const file = form.get("file");
  if (!(file instanceof File)) return NextResponse.json({ ok: false, reason: "no file" }, { status: 400 });

  if (file.size <= 0) {
    return NextResponse.json({ ok: false, reason: "The file is empty." }, { status: 400 });
  }
  if (file.size > MAX_ASSET_BYTES) {
    return NextResponse.json({ ok: false, reason: "File too large (max 30 MB)." }, { status: 400 });
  }
  if (file.size > MAX_SERVER_ASSET_BYTES) {
    return NextResponse.json(
      {
        ok: false,
        code: "direct_upload_required",
        reason: "Files larger than 4 MB must use the direct upload flow.",
      },
      { status: 413 },
    );
  }

  let body: Buffer;
  try {
    body = Buffer.from(await file.arrayBuffer());
  } catch {
    return NextResponse.json({ ok: false, reason: "Could not read upload." }, { status: 400 });
  }
  const detected = detectAssetFile(body);
  if (!detected) {
    return NextResponse.json(
      { ok: false, reason: "Use a PNG, JPEG, WebP, GIF, MP4, MOV, or WebM file." },
      { status: 400 },
    );
  }
  if (!claimedMimeMatches(file.type, detected.mimeType)) {
    return NextResponse.json(
      { ok: false, reason: "The file contents do not match its declared type." },
      { status: 400 },
    );
  }
  const { kind, mimeType: type } = detected;

  let reservation: AssetStorageReservation;
  try {
    reservation = await reserveAssetStorage({
      workspaceId: workspace.id,
      kind,
      mimeType: type,
      bytes: file.size,
      filename: file.name || null,
    });
  } catch (error) {
    if (error instanceof StorageLimitExceededError) {
      return NextResponse.json(
        {
          ok: false,
          reason: error.message,
          code: error.code,
          actionUrl: error.actionUrl,
          currentBytes: error.currentBytes,
          requestedBytes: error.requestedBytes,
          limitBytes: error.limitBytes,
        },
        { status: 402 },
      );
    }
    console.warn("[assets] storage reservation failed");
    return NextResponse.json({ ok: false, reason: "Upload failed." }, { status: 500 });
  }

  let stored: StoredBlob | null = null;
  try {
    stored = await putAsset(
      workspace.id,
      reservation.id,
      file.name || "asset",
      body,
      type,
    );
    await commitAssetStorageReservation(reservation, stored.pathname);
  } catch {
    console.warn("[assets] upload failed");
    if (stored) {
      try {
        const committed = await prisma.asset.findFirst({
          where: {
            id: reservation.id,
            workspaceId: reservation.workspaceId,
            storageKey: stored.pathname,
          },
        });
        if (committed) {
          const dto = toContentAssetDto(committed);
          return NextResponse.json({
            ok: true,
            id: dto.id,
            kind: dto.kind,
            contentUrl: dto.contentUrl,
            asset: dto,
            reused: true,
          });
        }
      } catch {
        return NextResponse.json(
          {
            ok: false,
            reason: "The upload is still being reconciled. Refresh the asset library shortly.",
            code: "asset_settlement_unknown",
          },
          { status: 503 },
        );
      }
    }
    await releaseAssetStorageReservation(reservation).catch(() => {
      console.warn("[assets] failed to release storage reservation");
    });
    return NextResponse.json({ ok: false, reason: "Upload failed." }, { status: 500 });
  }

  const asset = await prisma.asset.findFirstOrThrow({
    where: { id: reservation.id, workspaceId: workspace.id },
  });
  const dto = toContentAssetDto(asset);
  return NextResponse.json({
    ok: true,
    id: dto.id,
    kind: dto.kind,
    contentUrl: dto.contentUrl,
    asset: dto,
  });
}
