import type { WorkspaceRole } from "@/lib/auth";

/** Workspace members are inspect-only; owners and admins own every mutation. */
export function canSetContentStatus(
  role: WorkspaceRole,
  _status: string | undefined,
): boolean {
  void _status;
  return role === "owner" || role === "admin";
}

/** Defense in depth for service calls that bypass an HTTP role boundary. */
export function canMutateExistingContent(
  role: WorkspaceRole,
  _existingStatuses: readonly string[],
  requestedStatus?: string,
): boolean {
  return canSetContentStatus(role, requestedStatus);
}

/** Any semantic edit to approved content requires an explicit fresh approval. */
export function contentMutationLifecycle(
  existingStatus: string,
  requestedStatus?: string,
): {
  status?: string;
  approvedBy?: null;
  approvedAt?: null;
} {
  if (existingStatus === "approved" && requestedStatus !== "approved") {
    return {
      status: requestedStatus ?? "review",
      approvedBy: null,
      approvedAt: null,
    };
  }
  return { status: requestedStatus };
}

/** Content plans follow the same owner/admin mutation boundary as their posts. */
export function canMutateContentPlan(
  role: WorkspaceRole,
  _existingStatus: string,
  _requestedStatus?: string,
): boolean {
  void _existingStatus;
  void _requestedStatus;
  return role === "owner" || role === "admin";
}
