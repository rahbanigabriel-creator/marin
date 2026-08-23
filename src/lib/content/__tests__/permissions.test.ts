import assert from "node:assert/strict";
import test from "node:test";

import {
  canMutateExistingContent,
  canMutateContentPlan,
  canSetContentStatus,
  contentMutationLifecycle,
} from "../permissions";

test("members are read-only across every content lifecycle state", () => {
  assert.equal(canSetContentStatus("member", undefined), false);
  assert.equal(canSetContentStatus("member", "idea"), false);
  assert.equal(canSetContentStatus("member", "draft"), false);
  assert.equal(canSetContentStatus("member", "ready"), false);
  assert.equal(canSetContentStatus("member", "review"), false);
  assert.equal(canSetContentStatus("member", "approved"), false);
});

test("owners and admins retain review and approval authority", () => {
  for (const role of ["owner", "admin"] as const) {
    assert.equal(canSetContentStatus(role, "ready"), true);
    assert.equal(canSetContentStatus(role, "review"), true);
    assert.equal(canSetContentStatus(role, "approved"), true);
  }
});

test("members cannot edit content by changing or omitting the next status", () => {
  assert.equal(canMutateExistingContent("member", ["ready", "review"], undefined), false);
  assert.equal(canMutateExistingContent("member", ["approved"], "draft"), false);
  assert.equal(canMutateExistingContent("member", ["draft"], undefined), false);
  assert.equal(canMutateExistingContent("owner", ["approved"], undefined), true);
});

test("members cannot mutate draft or active plans", () => {
  assert.equal(canMutateContentPlan("member", "draft"), false);
  assert.equal(canMutateContentPlan("member", "active", "draft"), false);
  assert.equal(canMutateContentPlan("admin", "active", "archived"), true);
});

test("any semantic edit invalidates stale approval until explicitly reapproved", () => {
  assert.deepEqual(contentMutationLifecycle("approved"), {
    status: "review",
    approvedBy: null,
    approvedAt: null,
  });
  assert.deepEqual(contentMutationLifecycle("approved", "review"), {
    status: "review",
    approvedBy: null,
    approvedAt: null,
  });
  assert.deepEqual(contentMutationLifecycle("approved", "approved"), {
    status: "approved",
  });
  assert.deepEqual(contentMutationLifecycle("draft"), { status: undefined });
});
