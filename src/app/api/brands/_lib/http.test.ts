import assert from "node:assert/strict";
import test from "node:test";

import {
  WorkspaceAuthorizationError,
  type WorkspaceAccess,
  type WorkspaceRole,
} from "@/lib/auth";

import {
  brandCollectionFailure,
  brandItemFailure,
  requireBrandMutationAccess,
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

test("brand API accepts owners and admins while rejecting members", async () => {
  for (const role of ["owner", "admin", "member"] as const) {
    if (role === "member") {
      await assert.rejects(
        requireBrandMutationAccess(resolverFor(role)),
        WorkspaceAuthorizationError,
      );
    } else {
      const access = await requireBrandMutationAccess(resolverFor(role));
      assert.equal(access.role, role);
    }
  }
});

test("brand API returns a stable 403 for role denial", async () => {
  for (const failure of [brandCollectionFailure, brandItemFailure]) {
    const response = failure(new WorkspaceAuthorizationError());
    assert.equal(response.status, 403);
    assert.deepEqual(await response.json(), {
      error: "forbidden",
      message: "Owner or admin access is required to manage brand memory.",
    });
  }
});

test("brand API never exposes unexpected internal error messages", async (context) => {
  context.mock.method(console, "error", () => undefined);
  const secret = "postgresql://private-host/internal_schema";
  for (const failure of [brandCollectionFailure, brandItemFailure]) {
    const response = failure(new Error(secret));
    const body = JSON.stringify(await response.json());
    assert.equal(response.status, 500);
    assert.doesNotMatch(body, /private-host|internal_schema|postgresql/);
    assert.deepEqual(JSON.parse(body), { error: "brand_request_failed" });
  }
});
