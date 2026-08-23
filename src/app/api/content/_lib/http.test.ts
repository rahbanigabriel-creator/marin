import assert from "node:assert/strict";
import test from "node:test";

import {
  WorkspaceAuthorizationError,
  type WorkspaceAccess,
  type WorkspaceRole,
} from "@/lib/auth";

import {
  contentApiFailure,
  requireContentAccess,
  requireContentMutationAccess,
} from "./http";

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

test("content API keeps reads open to members and limits mutations to owner/admin", async () => {
  for (const role of ["owner", "admin", "member"] as const) {
    const read = await requireContentAccess(resolverFor(role));
    assert.equal(read.role, role);

    if (role === "member") {
      await assert.rejects(
        requireContentMutationAccess(resolverFor(role)),
        WorkspaceAuthorizationError,
      );
    } else {
      const mutation = await requireContentMutationAccess(resolverFor(role));
      assert.equal(mutation.role, role);
    }
  }
});

test("content API maps a member mutation denial to a stable 403", async () => {
  const response = contentApiFailure(new WorkspaceAuthorizationError(), "content_write");
  assert.equal(response.status, 403);
  assert.deepEqual(await response.json(), { error: "forbidden" });
});
