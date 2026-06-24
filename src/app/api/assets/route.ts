import { NextResponse, type NextRequest } from "next/server";

import { getCurrentWorkspace } from "@/lib/auth";
import { isDatabaseConfigured, prisma } from "@/lib/db";
import { isAssetStorageConfigured, putAsset, MAX_ASSET_BYTES } from "@/lib/storage/blob";

/**
 * POST /api/assets — upload one creative (image/video) for the current workspace,
 * to attach to an action step. Multipart form-data with a `file` field. Graceful:
 * returns { ok:false, reason } (not a throw) when storage/DB isn't configured, so
 * the action card can fall back to "Copy brief".
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest): Promise<Response> {
  if (!isAssetStorageConfigured()) {
    return NextResponse.json({ ok: false, reason: "Asset storage isn't configured yet." });
  }
  if (!isDatabaseConfigured()) {
    return NextResponse.json({ ok: false, reason: "Database not configured." });
  }
  const workspace = await getCurrentWorkspace();
  if (!workspace) return NextResponse.json({ ok: false, reason: "unauthenticated" }, { status: 401 });

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ ok: false, reason: "bad upload" }, { status: 400 });
  }
  const file = form.get("file");
  if (!(file instanceof File)) return NextResponse.json({ ok: false, reason: "no file" }, { status: 400 });

  const type = file.type || "application/octet-stream";
  const kind = type.startsWith("image/") ? "image" : type.startsWith("video/") ? "video" : null;
  if (!kind) return NextResponse.json({ ok: false, reason: "Only images and videos are allowed." }, { status: 400 });
  if (file.size > MAX_ASSET_BYTES) {
    return NextResponse.json({ ok: false, reason: "File too large (max 30 MB)." }, { status: 400 });
  }

  let stored;
  try {
    const buf = Buffer.from(await file.arrayBuffer());
    stored = await putAsset(workspace.id, file.name || "asset", buf, type);
  } catch (err) {
    console.warn(`[assets] upload failed: ${err instanceof Error ? err.message : "error"}`);
    return NextResponse.json({ ok: false, reason: "Upload failed." }, { status: 500 });
  }

  const row = await prisma.asset.create({
    data: { workspaceId: workspace.id, kind, mimeType: type, bytes: file.size, storageKey: stored.url },
    select: { id: true },
  });
  return NextResponse.json({ ok: true, id: row.id, url: stored.url, kind });
}
