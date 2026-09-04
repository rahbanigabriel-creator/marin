import assert from "node:assert/strict";
import test from "node:test";

import {
  isArtifactRelevant,
  requiresAccountMetrics,
  requiresActionPlan,
} from "@/lib/agent/artifact-relevance";

test("diagnostic cards require a performance or problem intent", () => {
  assert.equal(isArtifactRelevant("Why did my CPA increase this week?", "rootCause"), true);
  assert.equal(
    isArtifactRelevant("Monitor my connected Meta account for overspend and performance anomalies", "rootCause"),
    true,
  );
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

test("direct publishable creative requests require a reviewable action plan", () => {
  assert.equal(requiresActionPlan("Write three Google Search ad headlines"), true);
  assert.equal(requiresActionPlan("Generate five Instagram captions"), true);
  assert.equal(requiresActionPlan("Why is my CPA rising?"), false);
  assert.equal(requiresActionPlan("Plan my paid campaign"), false);
});

test("a flexible brief remains available for substantive uncategorized work", () => {
  assert.equal(isArtifactRelevant("Explain our positioning in plain English", "brief"), true);
});

test("only own-account performance requests require a connected metrics read", () => {
  assert.equal(
    requiresAccountMetrics("Monitor my connected Fitura Meta Ads account for overspend and anomalies"),
    true,
  );
  assert.equal(requiresAccountMetrics("Why did our CPA rise?"), true);
  assert.equal(requiresAccountMetrics("Show me my campaigns"), true);
  assert.equal(requiresAccountMetrics("What is a good CTR?"), false);
  assert.equal(requiresAccountMetrics("Write ads for my next campaign"), false);
  assert.equal(requiresAccountMetrics("Plan my paid campaign"), false);
});
