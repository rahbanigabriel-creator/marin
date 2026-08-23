import { NextResponse } from "next/server";

import {
  NotAuthenticatedError,
  WorkspaceAuthorizationError,
  requireWorkspaceRole,
  type WorkspaceAccess,
  type WorkspaceRole,
} from "@/lib/auth";
import { workspaceSeatLimitResponse } from "@/lib/auth-http";
import { isPersistenceModelUnavailable } from "@/lib/persistence/errors";
import { requestBodyErrorResponse } from "@/lib/security/request-body";

const SAFE_BRAND_VALIDATION_MESSAGES = new Set([
  "Brand name is required",
  "Expected a list of text values",
  "Expected text value",
  "Invalid currency",
  "Invalid locale",
  "Invalid timezone",
]);

export const BRAND_MUTATION_ROLES = ["owner", "admin"] as const;

type WorkspaceRoleResolver = (
  allowed: readonly WorkspaceRole[],
) => Promise<WorkspaceAccess>;

export async function requireBrandMutationAccess(
  resolveRole: WorkspaceRoleResolver = requireWorkspaceRole,
): Promise<WorkspaceAccess> {
  return resolveRole(BRAND_MUTATION_ROLES);
}

function commonBrandFailure(error: unknown): NextResponse | null {
  const bodyFailure = requestBodyErrorResponse(error);
  if (bodyFailure) return bodyFailure as NextResponse;
  const seatLimit = workspaceSeatLimitResponse(error);
  if (seatLimit) return seatLimit;
  if (error instanceof NotAuthenticatedError) {
    return NextResponse.json({ error: "not_authenticated" }, { status: 401 });
  }
  if (error instanceof WorkspaceAuthorizationError) {
    return NextResponse.json(
      { error: "forbidden", message: "Owner or admin access is required to manage brand memory." },
      { status: 403 },
    );
  }
  if (error instanceof Error && SAFE_BRAND_VALIDATION_MESSAGES.has(error.message)) {
    return NextResponse.json(
      { error: "invalid_brand", message: "Check the brand fields and try again." },
      { status: 422 },
    );
  }
  return null;
}

export function brandCollectionFailure(error: unknown): NextResponse {
  const common = commonBrandFailure(error);
  if (common) return common;
  if (isPersistenceModelUnavailable(error)) {
    return NextResponse.json({ available: false, brands: [] }, { status: 503 });
  }
  console.error("[brands] request failed");
  return NextResponse.json({ error: "brand_request_failed" }, { status: 500 });
}

export function brandItemFailure(error: unknown): NextResponse {
  const common = commonBrandFailure(error);
  if (common) return common;
  if (isPersistenceModelUnavailable(error)) {
    return NextResponse.json({ error: "persistence_unavailable" }, { status: 503 });
  }
  console.error("[brands] item request failed");
  return NextResponse.json({ error: "brand_request_failed" }, { status: 500 });
}
