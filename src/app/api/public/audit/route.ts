import { NextResponse } from "next/server";

import {
  AUDIT_HANDOFF_COOKIE_NAME,
  auditHandoffCookieOptions,
  issueAuditHandoff,
} from "@/lib/audit/audit-handoff";
import { toPublicAuditPreview } from "@/lib/audit/public-preview";
import { auditSite, SiteAuditError } from "@/lib/audit/site";
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
  if (error instanceof SiteAuditError) {
    const status = error.code === "UNSAFE_URL" || error.code === "INVALID_URL" ? 400 : 422;
    return NextResponse.json(
      { error: error.message, code: error.code },
      { status, headers: { "Cache-Control": "no-store" } },
    );
  }
  if (isPersistenceModelUnavailable(error)) {
    return NextResponse.json(
      { error: "Audit handoff persistence is being prepared. Retry shortly." },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
  return NextResponse.json(
    { error: "Marpin could not audit this website." },
    { status: 500, headers: { "Cache-Control": "no-store" } },
  );
}

export async function POST(request: Request): Promise<NextResponse> {
  const rateLimited = await enforceEndpointRateLimit(request, "audit");
  if (rateLimited) return rateLimited;

  try {
    const body = await readBoundedJson<{ url?: unknown }>(request, 4 * 1024);
    if (typeof body.url !== "string" || !body.url.trim()) {
      return NextResponse.json(
        { error: "Website URL is required." },
        { status: 400, headers: { "Cache-Control": "no-store" } },
      );
    }
    const audit = await auditSite(body.url);
    const handoff = await issueAuditHandoff(audit);
    const preview = toPublicAuditPreview(audit);
    const response = NextResponse.json(
      { audit: preview },
      { status: 200, headers: { "Cache-Control": "no-store, private" } },
    );
    response.cookies.set(
      AUDIT_HANDOFF_COOKIE_NAME,
      handoff.token,
      auditHandoffCookieOptions(request.url, handoff.expiresAt),
    );
    return response;
  } catch (error) {
    return failure(error);
  }
}
