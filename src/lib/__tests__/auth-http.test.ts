import assert from "node:assert/strict";
import test from "node:test";

import {
  WorkspaceAdminRequiredError,
  WorkspaceSeatLimitError,
} from "@/lib/auth";
import {
  WORKSPACE_ADMIN_REQUIRED_RESPONSE,
  WORKSPACE_SEAT_LIMIT_RESPONSE,
  workspaceSeatLimitResponse,
} from "@/lib/auth-http";

test("workspace seat failures use the stable typed HTTP contract", async () => {
  const response = workspaceSeatLimitResponse(
    new WorkspaceSeatLimitError("workspace-1", 1),
  );

  assert.ok(response);
  assert.equal(response.status, 403);
  assert.deepEqual(await response.json(), WORKSPACE_SEAT_LIMIT_RESPONSE);
});

test("organization bootstrap failures use a stable typed 403 contract", async () => {
  const response = workspaceSeatLimitResponse(
    new WorkspaceAdminRequiredError("workspace-1"),
  );

  assert.ok(response);
  assert.equal(response.status, 403);
  assert.deepEqual(await response.json(), WORKSPACE_ADMIN_REQUIRED_RESPONSE);
});

test("non-seat errors are left to the route's existing error handling", () => {
  assert.equal(workspaceSeatLimitResponse(new Error("different failure")), null);
});
