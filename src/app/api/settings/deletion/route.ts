import { NextResponse } from "next/server";

import {
  DELETION_NO_STORE,
  deletionApiFailure,
  deletionDatabaseUnavailable,
  deletionOriginFailure,
  readDeletionJson,
  requireClerkIdentity,
} from "@/app/api/settings/deletion/_lib/http";
import {
  createWorkspaceDeletionRequest,
  getDeletionPreparation,
} from "@/lib/privacy/deletion/service";
import { parseCreateDeletionInput } from "@/lib/privacy/deletion/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(): Promise<NextResponse> {
  const unavailable = deletionDatabaseUnavailable();
  if (unavailable) return unavailable;
  try {
    const identity = await requireClerkIdentity();
    const preparation = await getDeletionPreparation(identity);
    if (!preparation) {
      return NextResponse.json(
        {
          error: "workspace_not_found",
          code: "workspace_not_found",
          message: "No workspace is available for this identity",
        },
        { status: 404, headers: DELETION_NO_STORE },
      );
    }
    return NextResponse.json(
      {
        ...preparation,
        canDelete: preparation.role === "owner" || Boolean(preparation.deletion),
      },
      { headers: DELETION_NO_STORE },
    );
  } catch (error) {
    return deletionApiFailure(error, "status");
  }
}

export async function POST(request: Request): Promise<NextResponse> {
  const originFailure = deletionOriginFailure(request);
  if (originFailure) return originFailure;
  const unavailable = deletionDatabaseUnavailable();
  if (unavailable) return unavailable;
  try {
    const identity = await requireClerkIdentity();
    const { enforceWorkspaceDeletionRateLimit } = await import(
      "@/lib/privacy/deletion/rate-limit"
    );
    const limited = await enforceWorkspaceDeletionRateLimit({
      request,
      clerkUserId: identity.clerkUserId,
    });
    if (limited) return limited;
    const result = await createWorkspaceDeletionRequest({
      identity,
      request: parseCreateDeletionInput(await readDeletionJson(request)),
    });
    return NextResponse.json(result, {
      status: result.replayed ? 200 : 201,
      headers: DELETION_NO_STORE,
    });
  } catch (error) {
    return deletionApiFailure(error, "create");
  }
}
