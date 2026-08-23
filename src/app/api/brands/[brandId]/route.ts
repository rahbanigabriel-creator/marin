import { NextResponse } from "next/server";

import {
  brandItemFailure,
  requireBrandMutationAccess,
} from "@/app/api/brands/_lib/http";
import { requireWorkspace } from "@/lib/auth";
import { getBrand, updateBrand } from "@/lib/brand/service";
import type { BrandWriteInput } from "@/lib/brand/types";
import { readBoundedJson } from "@/lib/security/request-body";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Context = { params: Promise<{ brandId: string }> };

export async function GET(_request: Request, context: Context): Promise<NextResponse> {
  try {
    const workspace = await requireWorkspace();
    const { brandId } = await context.params;
    const brand = await getBrand(workspace.id, brandId);
    if (!brand) return NextResponse.json({ error: "not_found" }, { status: 404 });
    return NextResponse.json({ brand });
  } catch (error) {
    return brandItemFailure(error);
  }
}

export async function PATCH(request: Request, context: Context): Promise<NextResponse> {
  try {
    const { workspace } = await requireBrandMutationAccess();
    const { brandId } = await context.params;
    const input = await readBoundedJson<BrandWriteInput>(request);
    const brand = await updateBrand(workspace.id, brandId, input);
    if (!brand) return NextResponse.json({ error: "not_found" }, { status: 404 });
    return NextResponse.json({ brand });
  } catch (error) {
    return brandItemFailure(error);
  }
}
