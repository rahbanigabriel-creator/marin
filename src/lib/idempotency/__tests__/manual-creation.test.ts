import assert from "node:assert/strict";
import test from "node:test";

import {
  ManualCreationConflictError,
  ManualCreationRequestError,
  manualCreationErrorResult,
  manualCreationRequestHash,
  parseManualCreationRequestId,
} from "@/lib/idempotency/manual-creation";

test("manual creation request IDs are explicit, stable, and bounded", () => {
  assert.equal(
    parseManualCreationRequestId({ requestId: "  plan_request_123  " }),
    "plan_request_123",
  );
  for (const requestId of [undefined, "short", "spaces are invalid", "x".repeat(101)]) {
    assert.throws(
      () => parseManualCreationRequestId({ requestId }),
      ManualCreationRequestError,
    );
  }
});

test("manual creation request hashes are canonical and payload-sensitive", () => {
  const left = manualCreationRequestHash({
    scheduledAt: new Date("2026-08-24T09:00:00.000Z"),
    title: "Launch",
    nested: { b: 2, a: 1 },
  });
  const right = manualCreationRequestHash({
    nested: { a: 1, b: 2 },
    title: "Launch",
    scheduledAt: "2026-08-24T09:00:00.000Z",
  });
  assert.equal(left, right);
  assert.notEqual(left, manualCreationRequestHash({ title: "Different" }));
  assert.match(left, /^[a-f0-9]{64}$/);
});

test("manual creation errors map to stable client-safe responses", () => {
  assert.deepEqual(manualCreationErrorResult(new ManualCreationConflictError()), {
    status: 409,
    body: {
      error: "idempotency_conflict",
      code: "idempotency_conflict",
      message: "requestId was already used for a different payload",
    },
  });
  assert.equal(manualCreationErrorResult(new Error("database host details")), null);
});
