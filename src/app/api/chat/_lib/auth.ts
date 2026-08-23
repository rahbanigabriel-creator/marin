import {
  NotAuthenticatedError,
  WorkspaceAuthorizationError,
  requireWorkspaceRole,
  type WorkspaceAccess,
  type WorkspaceRole,
} from "@/lib/auth";

export const CHAT_MUTATION_ROLES = ["owner", "admin"] as const;

type WorkspaceRoleResolver = (
  allowed: readonly WorkspaceRole[],
) => Promise<WorkspaceAccess>;

export async function requireChatMutationAccess(
  resolveRole: WorkspaceRoleResolver = requireWorkspaceRole,
): Promise<WorkspaceAccess> {
  return resolveRole(CHAT_MUTATION_ROLES);
}

export function chatMutationAccessFailure(error: unknown): Response | null {
  if (error instanceof NotAuthenticatedError) {
    return Response.json(
      { error: "unauthenticated", message: "Sign in to continue." },
      { status: 401, headers: { "Cache-Control": "no-store" } },
    );
  }
  if (error instanceof WorkspaceAuthorizationError) {
    return Response.json(
      {
        error: "forbidden",
        message: "Owner or admin access is required to use the assistant.",
      },
      { status: 403, headers: { "Cache-Control": "no-store" } },
    );
  }
  return null;
}
