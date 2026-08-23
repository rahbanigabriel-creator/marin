import assert from "node:assert/strict";
import test from "node:test";

import { consumesScheduledPostSlot } from "@/lib/billing/calendar";

const NOW = new Date("2026-07-20T12:00:00.000Z");

test("only future active calendar entries consume a scheduled-post slot", () => {
  const future = new Date("2026-07-21T12:00:00.000Z");
  const past = new Date("2026-07-19T12:00:00.000Z");

  for (const status of ["draft", "ready", "scheduled", "publishing"]) {
    assert.equal(consumesScheduledPostSlot(future, status, NOW), true);
  }
  for (const status of ["published", "failed", "cancelled", "archived"]) {
    assert.equal(consumesScheduledPostSlot(future, status, NOW), false);
  }
  assert.equal(consumesScheduledPostSlot(null, "draft", NOW), false);
  assert.equal(consumesScheduledPostSlot(past, "ready", NOW), false);
  assert.equal(consumesScheduledPostSlot(new Date("invalid"), "draft", NOW), false);
});
