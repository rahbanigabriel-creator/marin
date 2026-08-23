import { NextResponse } from "next/server";

import {
  DELETION_NO_STORE,
  deletionApiFailure,
  deletionDatabaseUnavailable,
  deletionOriginFailure,
  readDeletionJson,
  requireClerkIdentity,
} from "@/app/api/settings/deletion/_lib/http";
import { retryWorkspaceDeletion } from "@/lib/privacy/deletion/service";
import { parseRetryDeletionInput } from "@/lib/privacy/deletion/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  context: { params: Promise<{ deletionRequestId: string }> },
): Promise<NextResponse> {
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
    const { deletionRequestId } = await context.params;
    const result = await retryWorkspaceDeletion({
      identity,
      deletionRequestId,
      request: parseRetryDeletionInput(await readDeletionJson(request)),
    });
    return NextResponse.json(result, {
      status: result.replayed ? 200 : 202,
      headers: DELETION_NO_STORE,
    });
  } catch (error) {
    return deletionApiFailure(error, "retry");
  }
}
