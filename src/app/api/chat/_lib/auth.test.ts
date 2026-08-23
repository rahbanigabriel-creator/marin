import assert from "node:assert/strict";
import test from "node:test";

import {
  WorkspaceAuthorizationError,
  type WorkspaceAccess,
  type WorkspaceRole,
} from "@/lib/auth";

import {
  chatMutationAccessFailure,
  requireChatMutationAccess,
} from "./auth";

function resolverFor(role: WorkspaceRole) {
  return async (allowed: readonly WorkspaceRole[]): Promise<WorkspaceAccess> => {
    if (!allowed.includes(role)) throw new WorkspaceAuthorizationError();
    return {
      workspace: {
        id: "workspace_001",
        name: "Marpin",
        slug: "marpin",
        isDev: false,
      },
      clerkUserId: `user_${role}`,
      role,
    };
  };
}

test("chat API accepts owners and admins while rejecting members", async () => {
  for (const role of ["owner", "admin", "member"] as const) {
    if (role === "member") {
      await assert.rejects(
        requireChatMutationAccess(resolverFor(role)),
        WorkspaceAuthorizationError,
      );
    } else {
      const access = await requireChatMutationAccess(resolverFor(role));
      assert.equal(access.role, role);
    }
  }
});

test("chat API maps a member mutation denial to a stable no-store 403", async () => {
  const response = chatMutationAccessFailure(new WorkspaceAuthorizationError());
  assert.ok(response);
  assert.equal(response.status, 403);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.deepEqual(await response.json(), {
    error: "forbidden",
    message: "Owner or admin access is required to use the assistant.",
  });
});
