import { NotAuthenticatedError, WorkspaceAuthorizationError } from "@/lib/auth";

export function paidSyncAuthFailure(error: unknown): { status: 401 | 403; error: string } | null {
  if (error instanceof NotAuthenticatedError) return { status: 401, error: "unauthenticated" };
  if (error instanceof WorkspaceAuthorizationError) return { status: 403, error: "forbidden" };
  return null;
}
