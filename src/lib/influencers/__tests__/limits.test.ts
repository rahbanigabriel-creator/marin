import assert from "node:assert/strict";
import test from "node:test";

import {
  INFLUENCER_WORKSPACE_LIMITS,
  influencerWorkspaceLimit,
} from "@/lib/influencers/limits";

test("influencer storage caps are finite, immutable, and plan-aware", () => {
  assert.deepEqual(INFLUENCER_WORKSPACE_LIMITS.free, {
    profiles: 25,
    outreach_drafts: 50,
    tracking_links: 25,
  });
  assert.deepEqual(INFLUENCER_WORKSPACE_LIMITS.solo, {
    profiles: 500,
    outreach_drafts: 2_000,
    tracking_links: 1_000,
  });
  assert.equal(Object.isFrozen(INFLUENCER_WORKSPACE_LIMITS), true);
  assert.equal(Object.isFrozen(INFLUENCER_WORKSPACE_LIMITS.free), true);

  for (const resource of [
    "profiles",
    "outreach_drafts",
    "tracking_links",
  ] as const) {
    const free = influencerWorkspaceLimit("free", resource);
    const solo = influencerWorkspaceLimit("solo", resource);
    assert.equal(Number.isSafeInteger(free), true);
    assert.equal(Number.isSafeInteger(solo), true);
    assert.equal(free > 0, true);
    assert.equal(solo > free, true);
  }
});
