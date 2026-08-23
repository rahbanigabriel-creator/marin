import assert from "node:assert/strict";
import test from "node:test";

import { isArtifactRelevant } from "@/lib/agent/artifact-relevance";

test("diagnostic cards require a performance or problem intent", () => {
  assert.equal(isArtifactRelevant("Why did my CPA increase this week?", "rootCause"), true);
  assert.equal(isArtifactRelevant("Write three launch posts", "rootCause"), false);
});

test("audit and campaign cards do not contaminate unrelated factual answers", () => {
  assert.equal(isArtifactRelevant("What does CTR mean?", "recommendations"), false);
  assert.equal(isArtifactRelevant("What does CTR mean?", "campaign"), false);
  assert.equal(isArtifactRelevant("Audit my landing page and SEO", "recommendations"), true);
});

test("definitions and greetings do not receive diagnostic or generic brief cards", () => {
  assert.equal(isArtifactRelevant("What does CTR mean?", "rootCause"), false);
  assert.equal(isArtifactRelevant("Hello", "brief"), false);
  assert.equal(isArtifactRelevant("Why did CTR drop last week?", "rootCause"), true);
  assert.equal(isArtifactRelevant("Create a positioning brief", "brief"), true);
});

test("a bare website can produce market, audit, and action workspaces", () => {
  assert.equal(isArtifactRelevant("https://marpin.ai", "marketScan"), true);
  assert.equal(isArtifactRelevant("www.marpin.ai", "recommendations"), true);
  assert.equal(isArtifactRelevant("marpin.ai", "actionPlan"), true);
});

test("a flexible brief remains available for substantive uncategorized work", () => {
  assert.equal(isArtifactRelevant("Explain our positioning in plain English", "brief"), true);
});
