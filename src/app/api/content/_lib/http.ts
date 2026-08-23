import { NextResponse } from "next/server";

import {
  NotAuthenticatedError,
  WorkspaceAuthorizationError,
  requireWorkspaceRole,
  type WorkspaceAccess,
  type WorkspaceRole,
} from "@/lib/auth";
import { workspaceSeatLimitResponse } from "@/lib/auth-http";
import { isEntitlementDeniedError } from "@/lib/billing/errors";
import {
  ContentNotFoundError,
  ContentStateConflictError,
  ContentValidationError,
  ContentVersionConflictError,
} from "@/lib/content/errors";
import { isDatabaseConfigured } from "@/lib/db";
import {
  RequestBodyError,
  readBoundedJson,
  requestBodyErrorResponse,
} from "@/lib/security/request-body";

export function databaseUnavailable(): NextResponse | null {
  return isDatabaseConfigured()
    ? null
    : NextResponse.json({ error: "database_unavailable" }, { status: 503 });
}

export const CONTENT_READ_ROLES = ["owner", "admin", "member"] as const;
export const CONTENT_MUTATION_ROLES = ["owner", "admin"] as const;

type WorkspaceRoleResolver = (
  allowed: readonly WorkspaceRole[],
) => Promise<WorkspaceAccess>;

export async function requireContentAccess(
  resolveRole: WorkspaceRoleResolver = requireWorkspaceRole,
): Promise<WorkspaceAccess> {
  return resolveRole(CONTENT_READ_ROLES);
}

export async function requireContentMutationAccess(
  resolveRole: WorkspaceRoleResolver = requireWorkspaceRole,
): Promise<WorkspaceAccess> {
  return resolveRole(CONTENT_MUTATION_ROLES);
}

export function contentApiFailure(error: unknown, operation: string): NextResponse {
  const bodyFailure = requestBodyErrorResponse(error);
  if (bodyFailure) return bodyFailure as NextResponse;
  const admission = workspaceSeatLimitResponse(error);
  if (admission) return admission;
  if (error instanceof NotAuthenticatedError) {
    return NextResponse.json({ error: "not_authenticated" }, { status: 401 });
  }
  if (error instanceof WorkspaceAuthorizationError) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
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
  if (error instanceof ContentNotFoundError) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  if (error instanceof ContentVersionConflictError) {
    return NextResponse.json(
      {
        error: error.code,
        code: error.code,
        message: error.message,
        currentVersion: error.currentVersion,
      },
      { status: 409 },
    );
  }
  if (error instanceof ContentStateConflictError) {
    return NextResponse.json(
      { error: error.code, code: error.code, message: error.message },
      { status: 409 },
    );
  }
  if (error instanceof ContentValidationError) {
    return NextResponse.json(
      { error: error.code, code: error.code, message: error.message },
      { status: 422 },
    );
  }
  console.error(`[content] ${operation} failed`);
  return NextResponse.json({ error: `${operation}_failed` }, { status: 500 });
}

export async function readJson(request: Request): Promise<unknown> {
  try {
    return await readBoundedJson(request);
  } catch (error) {
    if (error instanceof RequestBodyError && error.code === "invalid_body") {
      throw new ContentValidationError("invalid_body", "A valid JSON body is required");
    }
    throw error;
  }
}
