import assert from "node:assert/strict";
import test from "node:test";
import { evaluatePaidGoal } from "../evaluate";
import { completedWindow, parsePolicy } from "../policy";

const now = new Date("2026-09-06T12:00:00.000Z");
const range = completedWindow(now, "Europe/Madrid", 1);
const policy = { ...parsePolicy({ name: "ROAS", connectionId: "connection", goal: "min_roas", threshold: 2, windowDays: 1, minSpend: 50, minConversions: 5, cadenceHours: 24 }), workspaceId: "workspace", platform: "google_ads", accountId: "account", currency: "EUR", timezone: "Europe/Madrid" };
function fixture() {
  const phase = { state: "succeeded" as const, complete: true, rows: 3, errorCode: null, errorMessage: null, observedFrom: range.from.toISOString(), observedTo: range.to.toISOString() };
  return {
    policy: { ...policy }, range, startedAt: new Date(now.getTime() - 1000), now,
    sync: { attemptId: "attempt", connectionId: policy.connectionId, platform: "google_ads" as const, accountId: "account", accountName: "Ads", state: "succeeded" as const, currency: "EUR", timezone: policy.timezone, lastSyncedAt: now.toISOString(), observedFrom: phase.observedFrom, observedTo: phase.observedTo, phases: { metrics: { ...phase }, campaigns: { ...phase }, ads: { ...phase } } },
    facts: [["spend", 100], ["conversions", 5], ["revenue", 200]].map(([metric, value]) => ({ workspaceId: policy.workspaceId, connectionId: policy.connectionId, platform: policy.platform, date: range.from, campaignExternalId: "campaign", metric: String(metric), value: Number(value), currency: "EUR", lastSeenAttemptId: "attempt", staleAt: null as Date | null })),
  };
}

test("minimum ROAS is higher-is-better, including exact equality", () => {
  const input = fixture();
  assert.equal(evaluatePaidGoal(input).status, "healthy");
  input.facts[2].value = 300;
  assert.equal(evaluatePaidGoal(input).status, "healthy");
  input.facts[2].value = 199;
  const result = evaluatePaidGoal(input);
  assert.equal(result.status, "needs_review");
  assert.equal(result.observed, 1.99);
  assert.match(result.recommendation!, /No campaign changes/);
});

test("CPA and window spend are upper bounds, not daily caps", () => {
  const input = fixture();
  input.policy.goal = "max_cpa";
  input.policy.threshold = 20;
  assert.equal(evaluatePaidGoal(input).status, "healthy");
  input.policy.threshold = 19;
  assert.equal(evaluatePaidGoal(input).status, "needs_review");
  input.policy.goal = "max_spend";
  input.policy.threshold = 99;
  assert.match(evaluatePaidGoal(input).recommendation!, /not an enforced spend cap/);
});

test("ROAS uses weighted additive totals rather than averaging ratios", () => {
  const input = fixture();
  input.facts.push(...input.facts.map((fact) => ({ ...fact, campaignExternalId: "other", value: fact.metric === "spend" ? 900 : fact.metric === "revenue" ? 900 : 5 })));
  assert.equal(evaluatePaidGoal(input).observed, 1.1);
});

for (const goal of ["min_roas", "max_cpa", "max_spend"] as const) {
  test(`${goal} blocks absent or insufficient conversions, including explicit zero`, () => {
    const input = fixture(); input.policy.goal = goal;
    input.facts[1].value = 0;
    assert.equal(evaluatePaidGoal(input).code, "insufficient_sample");
    input.facts = input.facts.filter((fact) => fact.metric !== "conversions");
    assert.equal(evaluatePaidGoal(input).code, "conversion_evidence_missing");
    assert.equal(evaluatePaidGoal(input).recommendation, null);
  });
}

test("missing conversion values are not inferred as zero ROAS", () => {
  const input = fixture(); input.facts.pop();
  assert.equal(evaluatePaidGoal(input).code, "conversion_evidence_missing");
});

test("click-only campaign observations block CPA instead of silently excluding the campaign", () => {
  const input = fixture(); input.policy.goal = "max_cpa"; input.policy.threshold = 100;
  input.facts.push({ ...input.facts[0], campaignExternalId: "untracked-campaign", metric: "clicks", value: 100 });
  assert.equal(evaluatePaidGoal(input).code, "conversion_evidence_missing");
  assert.equal(evaluatePaidGoal(input).recommendation, null);
});

test("stale, incomplete, mixed-currency, duplicate and cross-tenant evidence fail closed", () => {
  const cases: Array<(input: ReturnType<typeof fixture>) => void> = [
    (input) => { input.sync.lastSyncedAt = "2026-09-05T12:00:00.000Z"; },
    (input) => { input.sync.phases.metrics.complete = false; },
    (input) => { input.sync.phases.metrics.observedTo = "2026-09-04T00:00:00.000Z"; },
    (input) => { input.sync.phases.metrics.observedTo = "bad"; },
    (input) => { input.facts[0].workspaceId = "other"; },
    (input) => { input.facts[0].connectionId = "other"; },
    (input) => { input.sync.accountId = "other"; },
    (input) => { input.facts[0].lastSeenAttemptId = "old"; },
    (input) => { input.facts[0].staleAt = now; },
    (input) => { input.facts[0].currency = "USD"; },
    (input) => { input.facts[0].value = Number.NaN; },
    (input) => { input.facts.push(input.facts[0]); },
    (input) => { input.facts.push({ ...input.facts[0], campaignExternalId: "" }); },
    (input) => { input.sync.timezone = "UTC"; },
    (input) => { input.facts = []; },
  ];
  for (const mutate of cases) { const input = fixture(); mutate(input); const result = evaluatePaidGoal(input); assert.equal(result.status, "blocked"); assert.equal(result.recommendation, null); }
});

test("account-local completed days exclude the partial current day and handle DST", () => {
  assert.deepEqual(completedWindow(new Date("2026-03-29T23:30:00Z"), "Europe/Madrid", 7), { from: new Date("2026-03-23T00:00:00Z"), to: new Date("2026-03-29T00:00:00Z") });
  assert.deepEqual(completedWindow(new Date("2026-09-06T01:00:00Z"), "America/Los_Angeles", 1), { from: new Date("2026-09-04T00:00:00Z"), to: new Date("2026-09-04T00:00:00Z") });
});

test("policy validation rejects unsupported actions, aggressive cadence and missing sample", () => {
  const valid = { name: policy.name, connectionId: policy.connectionId, goal: policy.goal, threshold: policy.threshold, windowDays: policy.windowDays, minSpend: policy.minSpend, minConversions: policy.minConversions, cadenceHours: policy.cadenceHours };
  for (const override of [{ goal: "optimize_budget" }, { cadenceHours: 1 }, { threshold: 0 }, { threshold: Infinity }, { minConversions: 0 }, { minSpend: 0 }, { windowDays: 90 }, { brandId: "brand" }, { activation: true }]) assert.throws(() => parsePolicy({ ...valid, ...override }));
});
