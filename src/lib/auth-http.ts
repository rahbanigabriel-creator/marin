import { NextResponse } from "next/server";

import {
  isWorkspaceAdminRequiredError,
  isWorkspaceSeatLimitError,
} from "@/lib/auth";

export const WORKSPACE_SEAT_LIMIT_RESPONSE = {
  error: "workspace_seat_limit",
  code: "workspace_seat_limit",
  message: "This workspace has reached its seat limit.",
  actionUrl: "/settings/billing",
} as const;

export const WORKSPACE_ADMIN_REQUIRED_RESPONSE = {
  error: "workspace_admin_required",
  code: "workspace_admin_required",
  message: "A workspace administrator must open Marpin before organization members can join.",
  actionUrl: null,
} as const;

/** Return the stable API contract for a workspace admission failure. */
export function workspaceSeatLimitResponse(error: unknown): NextResponse | null {
  if (isWorkspaceSeatLimitError(error)) {
    return NextResponse.json(WORKSPACE_SEAT_LIMIT_RESPONSE, { status: 403 });
  }
  if (isWorkspaceAdminRequiredError(error)) {
    return NextResponse.json(WORKSPACE_ADMIN_REQUIRED_RESPONSE, { status: 403 });
  }
  return null;
}
