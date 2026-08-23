import { NextResponse } from "next/server";

import {
  NotAuthenticatedError,
  WorkspaceAuthorizationError,
  requireWorkspaceRole,
} from "@/lib/auth";
import { workspaceSeatLimitResponse } from "@/lib/auth-http";
import { isEntitlementDeniedError } from "@/lib/billing/errors";
import { isDatabaseConfigured } from "@/lib/db";
import {
  RequestBodyError,
  readBoundedJson,
  requestBodyErrorResponse,
} from "@/lib/security/request-body";
import {
  SeoBadRequestError,
  SeoConflictError,
  SeoNotFoundError,
  SeoUnavailableError,
  SeoValidationError,
} from "@/lib/seo/errors";

export function seoDatabaseUnavailable(): NextResponse | null {
  return isDatabaseConfigured()
    ? null
    : NextResponse.json(
        {
          error: "database_unavailable",
          code: "database_unavailable",
          message: "The SEO workspace is temporarily unavailable",
        },
        { status: 503 },
      );
}

export function requireSeoReadAccess() {
  return requireWorkspaceRole(["owner", "admin", "member"]);
}

export function requireSeoManageAccess() {
  return requireWorkspaceRole(["owner", "admin"]);
}

export async function readSeoJson(request: Request): Promise<unknown> {
  try {
    return await readBoundedJson(request);
  } catch (error) {
    if (error instanceof RequestBodyError && error.code === "invalid_body") {
      throw new SeoBadRequestError("invalid_body", "A valid JSON body is required");
    }
    throw error;
  }
}

export function seoApiFailure(error: unknown, operation: string): NextResponse {
  const bodyFailure = requestBodyErrorResponse(error);
  if (bodyFailure) return bodyFailure as NextResponse;
  const admission = workspaceSeatLimitResponse(error);
  if (admission) return admission;
  if (error instanceof NotAuthenticatedError) {
    return NextResponse.json(
      { error: "not_authenticated", code: "not_authenticated", message: error.message },
      { status: 401 },
    );
  }
  if (error instanceof WorkspaceAuthorizationError) {
    return NextResponse.json(
      {
        error: "forbidden",
        code: "forbidden",
        message: "Owner or admin access is required for this SEO operation",
      },
      { status: 403 },
    );
  }
  if (isEntitlementDeniedError(error)) {
    return NextResponse.json(
      {
        error: error.code,
        code: error.code,
        message: error.message,
        actionUrl: error.upgradeUrl,
      },
      { status: 402 },
    );
  }
  if (error instanceof SeoBadRequestError) {
    return NextResponse.json(
      { error: error.code, code: error.code, message: error.message },
      { status: 400 },
    );
  }
  if (error instanceof SeoNotFoundError) {
    return NextResponse.json(
      { error: error.code, code: error.code, message: error.message },
      { status: 404 },
    );
  }
  if (error instanceof SeoConflictError) {
    return NextResponse.json(
      {
        error: error.code,
        code: error.code,
        message: error.message,
        ...(error.currentVersion === undefined
          ? {}
          : { currentVersion: error.currentVersion }),
      },
      { status: 409 },
    );
  }
  if (error instanceof SeoUnavailableError) {
    return NextResponse.json(
      { error: error.code, code: error.code, message: error.message },
      { status: 503 },
    );
  }
  if (error instanceof SeoValidationError) {
    return NextResponse.json(
      { error: error.code, code: error.code, message: error.message },
      { status: 422 },
    );
  }
  console.error(`[seo] ${operation} failed`);
  return NextResponse.json(
    {
      error: `${operation}_failed`,
      code: `${operation}_failed`,
      message: "The SEO request could not be completed",
    },
    { status: 500 },
  );
}
