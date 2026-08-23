import { NextResponse } from "next/server";

import {
  brandCollectionFailure,
  requireBrandMutationAccess,
} from "@/app/api/brands/_lib/http";
import { requireWorkspace } from "@/lib/auth";
import { listBrands, upsertPrimaryBrand } from "@/lib/brand/service";
import type { BrandWriteInput } from "@/lib/brand/types";
import { readBoundedJson } from "@/lib/security/request-body";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(): Promise<NextResponse> {
  try {
    const workspace = await requireWorkspace();
    const brands = workspace.isDev ? [] : await listBrands(workspace.id);
    return NextResponse.json({ available: !workspace.isDev, brands });
  } catch (error) {
    return brandCollectionFailure(error);
  }
}

export async function POST(request: Request): Promise<NextResponse> {
  try {
    const { workspace } = await requireBrandMutationAccess();
    if (workspace.isDev) {
      return NextResponse.json({ error: "persistence_unavailable" }, { status: 503 });
    }
    const input = await readBoundedJson<BrandWriteInput>(request);
    const brand = await upsertPrimaryBrand(workspace.id, input);
    return NextResponse.json({ brand }, { status: 201 });
  } catch (error) {
    return brandCollectionFailure(error);
  }
}
