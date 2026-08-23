import assert from "node:assert/strict";
import test from "node:test";

import { answerRequestFingerprint } from "../usage";

test("answer fingerprints are canonical but bind all request-changing input", () => {
  const left = answerRequestFingerprint({
    question: "Plan next week",
    mode: "organic",
    history: [{ role: "user", content: "Context" }],
  });
  const reordered = answerRequestFingerprint({
    history: [{ content: "Context", role: "user" }],
    mode: "organic",
    question: "Plan next week",
  });
  const changedQuestion = answerRequestFingerprint({
    question: "Plan next month",
    mode: "organic",
    history: [{ role: "user", content: "Context" }],
  });
  const changedHistory = answerRequestFingerprint({
    question: "Plan next week",
    mode: "organic",
    history: [{ role: "user", content: "Different context" }],
  });

  assert.match(left, /^[a-f0-9]{64}$/);
  assert.equal(left, reordered);
  assert.notEqual(left, changedQuestion);
  assert.notEqual(left, changedHistory);
});
