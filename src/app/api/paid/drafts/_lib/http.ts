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
  PaidDraftBadRequestError,
  PaidDraftConflictError,
  PaidDraftNotFoundError,
  PaidDraftUnavailableError,
} from "@/lib/paid-drafts/errors";
import { PaidDraftValidationError } from "@/lib/paid-drafts/validation";
import { isPersistenceModelUnavailable } from "@/lib/persistence/errors";
import {
  readBoundedJson,
  requestBodyErrorResponse,
} from "@/lib/security/request-body";
import {
  getSameOriginForbiddenDecision,
  validateSameOriginMutation,
} from "@/lib/security/request-origin";

const NO_STORE = { "Cache-Control": "private, no-store" };
const PAID_DRAFT_JSON_LIMIT_BYTES = 512 * 1024;
const PAID_DRAFT_GENERATION_JSON_LIMIT_BYTES = 16 * 1024;

export function paidDraftDatabaseUnavailable(): NextResponse | null {
  return isDatabaseConfigured()
    ? null
    : NextResponse.json(
        {
          error: "database_unavailable",
          code: "database_unavailable",
          message: "Paid campaign drafts are temporarily unavailable",
        },
        { status: 503, headers: NO_STORE },
      );
}

export function paidDraftMutationOriginFailure(request: Request): NextResponse | null {
  const isVercelDeployment = process.env.VERCEL === "1";
  const previewUrl =
    process.env.VERCEL_ENV === "preview" && process.env.VERCEL_URL
      ? `https://${process.env.VERCEL_URL}`
      : null;
  const localOrigin = !isVercelDeployment ? new URL(request.url).origin : null;
  const decision = validateSameOriginMutation({
    headers: request.headers,
    appUrl: process.env.APP_URL ?? previewUrl ?? localOrigin,
    nextPublicAppUrl: process.env.NEXT_PUBLIC_APP_URL ?? previewUrl ?? localOrigin,
    isProduction: isVercelDeployment,
    allowMissingProvenanceInDevelopment: !isVercelDeployment,
  });
  if (decision.allowed) return null;
  const forbidden = getSameOriginForbiddenDecision();
  return NextResponse.json(forbidden.body, {
    status: forbidden.status,
    headers: NO_STORE,
  });
}

export function requirePaidDraftReadAccess() {
  return requireWorkspaceRole(["owner", "admin", "member"]);
}

export function requirePaidDraftManageAccess() {
  return requireWorkspaceRole(["owner", "admin"]);
}

export function readPaidDraftJson(request: Request): Promise<unknown> {
  return readBoundedJson(request, PAID_DRAFT_JSON_LIMIT_BYTES);
}

export function readPaidDraftGenerationJson(request: Request): Promise<unknown> {
  return readBoundedJson(request, PAID_DRAFT_GENERATION_JSON_LIMIT_BYTES);
}

export function paidDraftApiFailure(error: unknown, operation: string): NextResponse {
  const bodyFailure = requestBodyErrorResponse(error);
  if (bodyFailure) return bodyFailure as NextResponse;
  const admission = workspaceSeatLimitResponse(error);
  if (admission) return admission;
  if (error instanceof NotAuthenticatedError) {
    return NextResponse.json(
      { error: "not_authenticated", code: "not_authenticated", message: error.message },
      { status: 401, headers: NO_STORE },
    );
  }
  if (error instanceof WorkspaceAuthorizationError) {
    return NextResponse.json(
      {
        error: "forbidden",
        code: "forbidden",
        message: "Owner or admin access is required for this paid campaign operation",
      },
      { status: 403, headers: NO_STORE },
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
      { status: 402, headers: NO_STORE },
    );
  }
  if (error instanceof PaidDraftBadRequestError) {
    return NextResponse.json(
      { error: error.code, code: error.code, message: error.message },
      { status: 400, headers: NO_STORE },
    );
  }
  if (error instanceof PaidDraftNotFoundError) {
    return NextResponse.json(
      { error: error.code, code: error.code, message: error.message },
      { status: 404, headers: NO_STORE },
    );
  }
  if (error instanceof PaidDraftConflictError) {
    return NextResponse.json(
      {
        error: error.code,
        code: error.code,
        message: error.message,
        ...(error.currentVersion === undefined
          ? {}
          : { currentVersion: error.currentVersion }),
      },
      { status: 409, headers: NO_STORE },
    );
  }
  if (error instanceof PaidDraftUnavailableError) {
    if (error.code === "invalid_model_output") {
      return NextResponse.json(
        {
          error: "invalid_model_output",
          code: "invalid_model_output",
          message: "AI campaign generation returned an invalid draft. Retry safely.",
        },
        { status: 502, headers: NO_STORE },
      );
    }
    if (
      error.code === "ai_provider_unavailable" ||
      error.code === "ai_generation_unavailable"
    ) {
      return NextResponse.json(
        {
          error: error.code,
          code: error.code,
          message:
            error.code === "ai_provider_unavailable"
              ? "AI paid campaign generation is not configured"
              : "AI paid campaign generation is temporarily unavailable",
        },
        { status: 503, headers: NO_STORE },
      );
    }
    return NextResponse.json(
      {
        error: "paid_drafts_unavailable",
        code: "paid_drafts_unavailable",
        message: "Paid campaign drafts are temporarily unavailable",
      },
      { status: 503, headers: NO_STORE },
    );
  }
  if (isPersistenceModelUnavailable(error)) {
    return NextResponse.json(
      {
        error: "paid_drafts_unavailable",
        code: "paid_drafts_unavailable",
        message: "Paid campaign drafts are temporarily unavailable",
      },
      { status: 503, headers: NO_STORE },
    );
  }
  if (error instanceof PaidDraftValidationError) {
    return NextResponse.json(
      {
        error: error.code,
        code: error.code,
        message: error.message,
        path: error.path,
      },
      { status: 422, headers: NO_STORE },
    );
  }
  console.error(`[paid-drafts] ${operation} failed`);
  return NextResponse.json(
    {
      error: `${operation}_failed`,
      code: `${operation}_failed`,
      message: "The paid campaign request could not be completed",
    },
    { status: 500, headers: NO_STORE },
  );
}
