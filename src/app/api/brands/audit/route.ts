import { NextRequest, NextResponse } from "next/server";

import {
  AUDIT_HANDOFF_COOKIE_NAME,
  expiredAuditHandoffCookieOptions,
  persistWorkspaceAudit,
} from "@/lib/audit/audit-handoff";
import { SiteAuditError } from "@/lib/audit/site";
import {
  NotAuthenticatedError,
  WorkspaceAuthorizationError,
  requireWorkspaceRole,
} from "@/lib/auth";
import { workspaceSeatLimitResponse } from "@/lib/auth-http";
import { getPrimaryBrand } from "@/lib/brand/service";
import { isPersistenceModelUnavailable } from "@/lib/persistence/errors";
import { enforceEndpointRateLimit } from "@/lib/security/rate-limit";
import {
  readBoundedJson,
  requestBodyErrorResponse,
} from "@/lib/security/request-body";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function failure(error: unknown): NextResponse {
  const bodyFailure = requestBodyErrorResponse(error);
  if (bodyFailure) return bodyFailure as NextResponse;
  const seatLimit = workspaceSeatLimitResponse(error);
  if (seatLimit) return seatLimit;
  if (error instanceof NotAuthenticatedError) {
    return NextResponse.json({ error: "not_authenticated" }, { status: 401 });
  }
  if (error instanceof WorkspaceAuthorizationError) {
    return NextResponse.json(
      { error: "forbidden", message: "Owner or admin access is required to audit a brand." },
      { status: 403 },
    );
  }
  if (isPersistenceModelUnavailable(error)) {
    return NextResponse.json(
      { error: "Brand persistence is being prepared. Retry shortly." },
      { status: 503 },
    );
  }
  if (error instanceof SiteAuditError) {
    const status = error.code === "UNSAFE_URL" || error.code === "INVALID_URL" ? 400 : 422;
    return NextResponse.json({ error: error.message, code: error.code }, { status });
  }
  return NextResponse.json({ error: "Marpin could not audit this website." }, { status: 500 });
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const rateLimited = await enforceEndpointRateLimit(request, "audit");
  if (rateLimited) return rateLimited;

  try {
    const { workspace } = await requireWorkspaceRole(["owner", "admin"]);
    if (workspace.isDev) {
      return NextResponse.json({ error: "Brand persistence is not configured." }, { status: 503 });
    }
    const body = await readBoundedJson<{ url?: unknown }>(request, 4 * 1024);
    if (typeof body.url !== "string" || !body.url.trim()) {
      return NextResponse.json({ error: "Website URL is required." }, { status: 400 });
    }

    // Fail before a fallback crawl when the additive Brand migration has not
    // landed. A valid handoff is still consumed in one later transaction.
    await getPrimaryBrand(workspace.id);
    const persisted = await persistWorkspaceAudit(
      {
        workspaceId: workspace.id,
        requestedUrl: body.url,
        token: request.cookies.get(AUDIT_HANDOFF_COOKIE_NAME)?.value,
      },
    );
    const response = NextResponse.json(
      {
        brand: persisted.brand,
        audit: persisted.audit,
        reusedPublicAudit: persisted.source === "handoff",
      },
      { status: 201, headers: { "Cache-Control": "no-store, private" } },
    );
    response.cookies.set(
      AUDIT_HANDOFF_COOKIE_NAME,
      "",
      expiredAuditHandoffCookieOptions(request.url),
    );
    return response;
  } catch (error) {
    return failure(error);
  }
}
