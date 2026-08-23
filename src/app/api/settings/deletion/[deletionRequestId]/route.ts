import { NextResponse } from "next/server";

import {
  DELETION_NO_STORE,
  deletionApiFailure,
  deletionDatabaseUnavailable,
  requireClerkIdentity,
} from "@/app/api/settings/deletion/_lib/http";
import { getDeletionRequestForRequester } from "@/lib/privacy/deletion/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  context: { params: Promise<{ deletionRequestId: string }> },
): Promise<NextResponse> {
  const unavailable = deletionDatabaseUnavailable();
  if (unavailable) return unavailable;
  try {
    const identity = await requireClerkIdentity();
    const { deletionRequestId } = await context.params;
    const deletion = await getDeletionRequestForRequester({
      deletionRequestId,
      clerkUserId: identity.clerkUserId,
    });
    return NextResponse.json({ deletion }, { headers: DELETION_NO_STORE });
  } catch (error) {
    return deletionApiFailure(error, "status");
  }
}
