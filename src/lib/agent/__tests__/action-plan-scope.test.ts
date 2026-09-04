import assert from "node:assert/strict";
import test from "node:test";

import { actionPlanInputFromTool } from "@/lib/actions/plan-input";

function plan(step: Record<string, unknown>) {
  return {
    title: "Fitura distribution plan",
    steps: [{
      title: "Launch the test",
      description: "Prepare a reviewable campaign and approve its budget before launch.",
      kind: "ad_draft",
      ...step,
    }],
  };
}

test("action plans accept only Google Ads and Meta Ads for paid work", () => {
  assert.ok(actionPlanInputFromTool(plan({ platform: "google_ads" })));
  assert.ok(actionPlanInputFromTool(plan({ platform: "meta_ads" })));
  assert.equal(actionPlanInputFromTool(plan({ platform: "tiktok_ads" })), null);
  assert.equal(actionPlanInputFromTool(plan({ platform: "instagram" })), null);
  assert.equal(actionPlanInputFromTool(plan({})), null);
});

test("action plans reject hidden unsupported paid recommendations", () => {
  assert.equal(actionPlanInputFromTool(plan({
    platform: "google_ads",
    title: "Launch Apple Search Ads Basic",
  })), null);
  assert.equal(actionPlanInputFromTool(plan({
    platform: "meta_ads",
    description: "Use TikTok Ads for the first paid test.",
  })), null);
});

test("launch organic destinations remain valid for organic content", () => {
  assert.ok(actionPlanInputFromTool(plan({
    platform: "tiktok",
    kind: "video",
    title: "Publish the Fitura walkthrough",
    description: "Schedule the organic TikTok video for Tuesday.",
  })));
});
