import { NextResponse, type NextRequest } from "next/server";

import { getCurrentWorkspace } from "@/lib/auth";
import { workspaceSeatLimitResponse } from "@/lib/auth-http";
import { isUnavailableAssetStorageKey } from "@/lib/billing/storage";
import { isDatabaseConfigured, prisma } from "@/lib/db";
import {
  getAssetBlob,
  isAssetStorageConfigured,
} from "@/lib/storage/blob";
import { safeAssetDownloadFilename } from "@/lib/storage/asset-file";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ assetId: string }>;
}

export async function GET(
  request: NextRequest,
  context: RouteContext,
): Promise<Response> {
  if (!isDatabaseConfigured() || !isAssetStorageConfigured()) {
    return NextResponse.json({ error: "asset_storage_unavailable" }, { status: 503 });
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
  const { assetId } = await context.params;
  const asset = await prisma.asset.findFirst({
    where: { id: assetId, workspaceId: workspace.id },
  });
  if (!asset || isUnavailableAssetStorageKey(asset.storageKey)) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  try {
    const result = await getAssetBlob(
      asset.storageKey,
      request.headers.get("if-none-match") ?? undefined,
    );
    if (!result) return NextResponse.json({ error: "not_found" }, { status: 404 });
    const attachment = request.nextUrl.searchParams.get("disposition") === "attachment";
    const disposition = attachment
      ? `attachment; filename="${safeAssetDownloadFilename(asset.filename)}"`
      : "inline";
    const headers = {
      "Cache-Control": "private, no-cache",
      ETag: result.blob.etag,
      "X-Content-Type-Options": "nosniff",
      "Content-Disposition": disposition,
    };
    if (result.statusCode === 304) {
      return new NextResponse(null, { status: 304, headers });
    }
    return new NextResponse(result.stream, {
      headers: {
        ...headers,
        "Content-Type": asset.mimeType,
        "Content-Length": String(result.blob.size),
      },
    });
  } catch {
    console.warn("[assets] private delivery failed");
    return NextResponse.json({ error: "asset_unavailable" }, { status: 502 });
  }
}
