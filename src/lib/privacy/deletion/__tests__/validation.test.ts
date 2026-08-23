import assert from "node:assert/strict";
import test from "node:test";

import {
  createDeletionRequestHash,
  deletionConfirmationPhrase,
  parseCreateDeletionInput,
  parseRetryDeletionInput,
  retryDeletionRequestHash,
} from "@/lib/privacy/deletion/validation";

test("deletion confirmation is deterministic and must be supplied exactly", () => {
  assert.equal(deletionConfirmationPhrase("user_123"), "DELETE user_123");
  assert.deepEqual(
    parseCreateDeletionInput({
      requestId: "delete_request_123",
      confirmation: "DELETE user_123",
    }),
    { requestId: "delete_request_123", confirmation: "DELETE user_123" },
  );
  assert.throws(
    () => parseCreateDeletionInput({ requestId: "short", confirmation: "DELETE user_123" }),
    /requestId/,
  );
  assert.throws(
    () =>
      parseCreateDeletionInput({
        requestId: "delete_request_123",
        confirmation: "DELETE user_123",
        force: true,
      }),
    /unsupported fields/,
  );
});

test("deletion and retry hashes bind every replay-relevant field", () => {
  const first = createDeletionRequestHash({
    workspaceSlug: "user_123",
    requestId: "delete_request_123",
    confirmation: "DELETE user_123",
  });
  assert.match(first, /^[a-f0-9]{64}$/);
  assert.equal(
    first,
    createDeletionRequestHash({
      workspaceSlug: "user_123",
      requestId: "delete_request_123",
      confirmation: "DELETE user_123",
    }),
  );
  assert.notEqual(
    first,
    createDeletionRequestHash({
      workspaceSlug: "user_456",
      requestId: "delete_request_123",
      confirmation: "DELETE user_123",
    }),
  );

  assert.deepEqual(parseRetryDeletionInput({ requestId: "retry_request_123" }), {
    requestId: "retry_request_123",
  });
  assert.notEqual(
    retryDeletionRequestHash({
      deletionRequestId: "deletion-a",
      requestId: "retry_request_123",
    }),
    retryDeletionRequestHash({
      deletionRequestId: "deletion-b",
      requestId: "retry_request_123",
    }),
  );
});
