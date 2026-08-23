import assert from "node:assert/strict";
import test from "node:test";

import {
  conversationTitle,
  normalizeConversationMode,
} from "../service";

test("normalizeConversationMode accepts every supported mode", () => {
  for (const mode of ["assistant", "organic", "paid", "seo"] as const) {
    assert.equal(normalizeConversationMode(mode), mode);
  }
});

test("normalizeConversationMode normalizes harmless casing and whitespace", () => {
  assert.equal(normalizeConversationMode("Organic"), "organic");
  assert.equal(normalizeConversationMode(" paid "), "paid");
});

test("normalizeConversationMode falls back for unsupported values", () => {
  for (const value of ["social", "", null, 7, undefined]) {
    assert.equal(normalizeConversationMode(value), "assistant");
  }
});

test("conversationTitle collapses and trims whitespace", () => {
  assert.equal(
    conversationTitle("  Plan\n\tmy   organic   launch  "),
    "Plan my organic launch",
  );
});

test("conversationTitle supplies a fallback for empty content", () => {
  assert.equal(conversationTitle(""), "New conversation");
  assert.equal(conversationTitle(" \n\t "), "New conversation");
});

test("conversationTitle preserves the 72-character boundary", () => {
  const title = "a".repeat(72);

  assert.equal(conversationTitle(title), title);
  assert.equal(conversationTitle(title).length, 72);
});

test("conversationTitle truncates content over 72 characters with an ellipsis", () => {
  const title = "a".repeat(73);
  const result = conversationTitle(title);

  assert.equal(result, `${"a".repeat(71)}…`);
  assert.equal(result.length, 72);
});

test("conversationTitle applies the same normalization to caller-supplied titles", () => {
  const supplied = `  ${"manual   title ".repeat(10)} `;
  const normalized = conversationTitle(supplied);

  assert.equal(normalized.length, 72);
  assert.equal(normalized.endsWith("…"), true);
  assert.equal(normalized.includes("  "), false);
});
