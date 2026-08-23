import { NextResponse } from "next/server";

import {
  NotAuthenticatedError,
  WorkspaceAuthorizationError,
  requireWorkspaceRole,
} from "@/lib/auth";
import { workspaceSeatLimitResponse } from "@/lib/auth-http";
import { isDatabaseConfigured } from "@/lib/db";
import {
  InfluencerConflictError,
  InfluencerLimitExceededError,
  InfluencerNotFoundError,
  InfluencerUnavailableError,
} from "@/lib/influencers/errors";
import { InfluencerValidationError } from "@/lib/influencers/validation";
import { isPersistenceModelUnavailable } from "@/lib/persistence/errors";
import {
  readBoundedJson,
  requestBodyErrorResponse,
} from "@/lib/security/request-body";

const NO_STORE = { "Cache-Control": "no-store" };

export function influencerDatabaseUnavailable(): NextResponse | null {
  return isDatabaseConfigured()
    ? null
    : NextResponse.json(
        {
          error: "database_unavailable",
          code: "database_unavailable",
          message: "The influencer workspace is temporarily unavailable",
        },
        { status: 503, headers: NO_STORE },
      );
}

export function requireInfluencerReadAccess() {
  return requireWorkspaceRole(["owner", "admin", "member"]);
}

export function requireInfluencerManageAccess() {
  return requireWorkspaceRole(["owner", "admin"]);
}

export function readInfluencerJson(request: Request): Promise<unknown> {
  return readBoundedJson(request);
}

export function influencerApiFailure(
  error: unknown,
  operation: string,
): NextResponse {
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
        message: "Owner or admin access is required for this influencer operation",
      },
      { status: 403, headers: NO_STORE },
    );
  }
  if (error instanceof InfluencerNotFoundError) {
    return NextResponse.json(
      { error: error.code, code: error.code, message: error.message },
      { status: 404, headers: NO_STORE },
    );
  }
  if (error instanceof InfluencerConflictError) {
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
  if (error instanceof InfluencerLimitExceededError) {
    return NextResponse.json(
      {
        error: "payment_required",
        code: error.code,
        message: error.message,
        resource: error.resource,
        limit: error.limit,
        plan: error.planId,
      },
      { status: 402, headers: NO_STORE },
    );
  }
  if (
    error instanceof InfluencerUnavailableError ||
    isPersistenceModelUnavailable(error)
  ) {
    return NextResponse.json(
      {
        error: "influencer_unavailable",
        code: "influencer_unavailable",
        message: "The influencer workspace is temporarily unavailable",
      },
      { status: 503, headers: NO_STORE },
    );
  }
  if (error instanceof InfluencerValidationError) {
    return NextResponse.json(
      { error: error.code, code: error.code, message: error.message },
      { status: 422, headers: NO_STORE },
    );
  }
  console.error(`[influencers] ${operation} failed`);
  return NextResponse.json(
    {
      error: `${operation}_failed`,
      code: `${operation}_failed`,
      message: "The influencer request could not be completed",
    },
    { status: 500, headers: NO_STORE },
  );
}
