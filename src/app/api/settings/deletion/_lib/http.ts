import { NextResponse } from "next/server";

import {
  AuthConfigurationRequiredError,
  NotAuthenticatedError,
  WorkspaceAuthorizationError,
  requireClerkIdentity,
} from "@/lib/auth";
import { isDatabaseConfigured } from "@/lib/db";
import {
  DeletionConflictError,
  DeletionNotFoundError,
  DeletionUnavailableError,
  DeletionValidationError,
} from "@/lib/privacy/deletion/errors";
import { readBoundedJson, requestBodyErrorResponse } from "@/lib/security/request-body";
import {
  getSameOriginForbiddenDecision,
  validateSameOriginMutation,
} from "@/lib/security/request-origin";

export const DELETION_NO_STORE = { "Cache-Control": "private, no-store" };
const DELETION_BODY_LIMIT_BYTES = 8 * 1024;

export function deletionDatabaseUnavailable(): NextResponse | null {
  return isDatabaseConfigured()
    ? null
    : NextResponse.json(
        {
          error: "database_unavailable",
          code: "database_unavailable",
          message: "Workspace deletion is temporarily unavailable",
        },
        { status: 503, headers: DELETION_NO_STORE },
      );
}

export function deletionOriginFailure(request: Request): NextResponse | null {
  const isVercel = process.env.VERCEL === "1";
  const preview =
    process.env.VERCEL_ENV === "preview" && process.env.VERCEL_URL
      ? `https://${process.env.VERCEL_URL}`
      : null;
  const local = !isVercel ? new URL(request.url).origin : null;
  const decision = validateSameOriginMutation({
    headers: request.headers,
    appUrl: process.env.APP_URL ?? preview ?? local,
    nextPublicAppUrl: process.env.NEXT_PUBLIC_APP_URL ?? preview ?? local,
    isProduction: isVercel,
    allowMissingProvenanceInDevelopment: !isVercel,
  });
  if (decision.allowed) return null;
  const forbidden = getSameOriginForbiddenDecision();
  return NextResponse.json(forbidden.body, {
    status: forbidden.status,
    headers: DELETION_NO_STORE,
  });
}

export function readDeletionJson(request: Request): Promise<unknown> {
  return readBoundedJson(request, DELETION_BODY_LIMIT_BYTES);
}

export { requireClerkIdentity };

export function deletionApiFailure(error: unknown, operation: string): NextResponse {
  const bodyFailure = requestBodyErrorResponse(error);
  if (bodyFailure) return bodyFailure as NextResponse;
  if (error instanceof NotAuthenticatedError) {
    return NextResponse.json(
      { error: "not_authenticated", code: "not_authenticated", message: error.message },
      { status: 401, headers: DELETION_NO_STORE },
    );
  }
  if (error instanceof AuthConfigurationRequiredError) {
    return NextResponse.json(
      {
        error: error.code,
        code: error.code,
        message: "Production authentication is required for workspace deletion",
      },
      { status: 503, headers: DELETION_NO_STORE },
    );
  }
  if (error instanceof WorkspaceAuthorizationError) {
    return NextResponse.json(
      {
        error: "forbidden",
        code: "owner_required",
        message: "Only the workspace owner can delete this workspace",
      },
      { status: 403, headers: DELETION_NO_STORE },
    );
  }
  if (error instanceof DeletionNotFoundError) {
    return NextResponse.json(
      { error: error.code, code: error.code, message: error.message },
      { status: 404, headers: DELETION_NO_STORE },
    );
  }
  if (error instanceof DeletionConflictError) {
    return NextResponse.json(
      { error: error.code, code: error.code, message: error.message },
      { status: 409, headers: DELETION_NO_STORE },
    );
  }
  if (error instanceof DeletionValidationError) {
    return NextResponse.json(
      { error: error.code, code: error.code, message: error.message },
      { status: 422, headers: DELETION_NO_STORE },
    );
  }
  if (error instanceof DeletionUnavailableError) {
    return NextResponse.json(
      { error: error.code, code: error.code, message: error.message },
      { status: 503, headers: DELETION_NO_STORE },
    );
  }
  console.error(`[privacy-deletion] ${operation} failed`);
  return NextResponse.json(
    {
      error: `${operation}_failed`,
      code: `${operation}_failed`,
      message: "The deletion request could not be completed",
    },
    { status: 500, headers: DELETION_NO_STORE },
  );
}
