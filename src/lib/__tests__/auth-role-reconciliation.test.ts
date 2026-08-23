import assert from "node:assert/strict";
import test from "node:test";

import {
  reconcilePersistedWorkspaceRole,
  WorkspaceRoleClaimError,
} from "@/lib/auth";

test("a trusted Clerk admin demotion resolves persisted admin access to member", () => {
  assert.equal(
    reconcilePersistedWorkspaceRole("admin", {
      clerkOrgId: "org_acme",
      clerkOrgRole: "org:member",
    }),
    "member",
  );
});

test("a trusted Clerk admin promotion resolves persisted member access to admin", () => {
  assert.equal(
    reconcilePersistedWorkspaceRole("member", {
      clerkOrgId: "org_acme",
      clerkOrgRole: "org:admin",
    }),
    "admin",
  );
});

test("a no-organization personal workspace preserves its persisted owner", () => {
  assert.equal(
    reconcilePersistedWorkspaceRole("owner", {
      clerkOrgId: null,
      clerkOrgRole: null,
    }),
    "owner",
  );
});

test("an organization identity without a role claim fails closed", () => {
  assert.throws(
    () =>
      reconcilePersistedWorkspaceRole("admin", {
        clerkOrgId: "org_acme",
        clerkOrgRole: null,
      }),
    (error: unknown) =>
      error instanceof WorkspaceRoleClaimError &&
      error.code === "workspace_role_claim_invalid",
  );
});

test("an unknown organization role claim fails closed", () => {
  assert.throws(
    () =>
      reconcilePersistedWorkspaceRole("member", {
        clerkOrgId: "org_acme",
        clerkOrgRole: "org:owner",
      }),
    WorkspaceRoleClaimError,
  );
});
