import assert from "node:assert/strict";
import test from "node:test";

import { classify, requiresExecutionEntitlement } from "../capability";

test("launch-scope social posts remain honest assisted handoffs", () => {
  for (const platform of [
    "youtube",
    "instagram",
    "facebook",
    "tiktok",
    "snapchat",
    "reddit",
    "pinterest",
  ]) {
    const capability = classify(platform, "post");
    assert.equal(capability.execMode, "guided");
    assert.equal(capability.requiresApproval, true);
    assert.match(capability.ctaLabel, /^Open in /);
    assert.equal(requiresExecutionEntitlement(capability.execMode), false);
  }
});

test("paid drafts open the provider without claiming a launch", () => {
  for (const platform of ["google_ads", "meta_ads", "tiktok_ads"]) {
    const capability = classify(platform, "ad_draft");
    assert.equal(capability.execMode, "guided");
    assert.equal(requiresExecutionEntitlement(capability.execMode), false);
  }
});

test("only a real provider API write requires the execution entitlement", () => {
  assert.equal(requiresExecutionEntitlement("prepare"), false);
  assert.equal(requiresExecutionEntitlement("guided"), false);
  assert.equal(requiresExecutionEntitlement("api"), true);
});
