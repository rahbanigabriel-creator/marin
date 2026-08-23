import assert from "node:assert/strict";
import test from "node:test";

import { initialChatState, streamReducer } from "../reducer";

test("done clears stale activity and marks the stream complete", () => {
  const working = streamReducer(initialChatState, {
    type: "status",
    key: "analyzing",
    label: "Analyzing",
  });
  const done = streamReducer(working, { type: "done" });
  assert.equal(done.done, true);
  assert.equal(done.status, null);
});

test("errors are terminal, visible, and clear stale activity", () => {
  const working = streamReducer(initialChatState, {
    type: "status",
    key: "writing",
    label: "Writing",
  });
  const failed = streamReducer(working, { type: "error", message: "Try again" });
  assert.equal(failed.done, true);
  assert.equal(failed.error, "Try again");
  assert.equal(failed.status, null);
});
