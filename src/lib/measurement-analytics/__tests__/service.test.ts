import assert from "node:assert/strict";
import test from "node:test";

import { toFactInput } from "@/lib/metrics/ingest";
import { buildMeasurementAnalytics, MAX_MEASUREMENT_FACTS, MAX_MEASUREMENT_SOURCES, measurementQueries, readMeasurementAnalytics, type MeasurementSnapshot } from "../service";
import { connection, fact, now, paidConnection, paidFact, range } from "./fixtures";

function build(snapshot: Partial<MeasurementSnapshot> = {}) {
  return buildMeasurementAnalytics({ workspaceId: "workspace-1", range, now, snapshot: { connections: [], facts: [], ...snapshot } });
}

test("empty measurements contain no invented totals, series or AppsFlyer connection", () => {
  const result = build();
  assert.equal(result.ga4.state, "empty");
  assert.deepEqual(result.ga4.observations, []);
  assert.deepEqual(result.paid.accounts, []);
  assert.deepEqual(result.appsFlyer, { state: "unavailable" });
  assert.equal("seo" in result, false);
  assert.equal("organic" in result, false);
});

test("canonical GA4 ingestion remains unassigned even with exactly one property", () => {
  const input = toFactInput("workspace-1", "ga4", { platform: "ga4", date: new Date("2026-09-01"), metric: "sessions", value: 42 });
  const result = build({ connections: [connection()], facts: [fact(input)] });
  assert.equal(result.ga4.state, "observations_only");
  assert.deepEqual(result.ga4.observations[0], { id: "fact-1", date: "2026-09-01", sourceId: null, campaign: null, metric: "sessions", value: 42 });
  assert.equal(result.sources[0].lastSuccessfulSyncAt, null);
  assert.equal(result.sources[0].observedFrom, null);
  assert.equal(result.ga4.lastStoredAt, now.toISOString());
});

test("GA4 preserves named and unnamed rows without summing, inferring currency or exposing revenue", () => {
  const result = build({ connections: [connection(), connection({ id: "ga4-2" })], facts: [
    fact({ id: "sessions-1", value: 20 }), fact({ id: "sessions-2", campaign: "", value: 100 }),
    fact({ id: "conversions", metric: "conversions", value: 0 }),
    fact({ id: "revenue", metric: "revenue", value: 987654, currency: "USD" }),
    fact({ id: "ratio", metric: "roas", value: 99 }),
  ] });
  assert.equal(result.ga4.observations.length, 3);
  assert.ok(result.ga4.observations.every((row) => row.sourceId === null));
  assert.equal("totals" in result.ga4, false);
  assert.doesNotMatch(JSON.stringify(result), /987654|"roas"|"revenue"/);
});

test("property-linked observations retain only an exact tenant and platform identity", () => {
  const result = build({ connections: [connection(), paidConnection(), connection({ id: "foreign", workspaceId: "workspace-2" })], facts: [
    fact({ id: "valid", connectionId: "ga4-1" }),
    fact({ id: "foreign-row", workspaceId: "workspace-2" }),
    fact({ id: "foreign-link", connectionId: "foreign" }),
    fact({ id: "missing-link", connectionId: "missing" }),
    fact({ id: "wrong-platform", connectionId: "ads-1" }),
    paidFact({ id: "legacy-paid", connectionId: null }),
    fact({ id: "hidden", platform: "search_console" }),
    fact({ id: "stale", staleAt: now }),
    fact({ id: "old", date: new Date("2026-08-31") }),
    fact({ id: "after", date: range.toExclusive }),
  ] });
  assert.deepEqual(result.sources.map((row) => row.id), ["ga4-1", "ads-1"]);
  assert.deepEqual(result.ga4.observations.map((row) => row.id), ["valid"]);
  assert.equal(result.ga4.observations[0].sourceId, "ga4-1");
  assert.equal(result.paid.accounts[0].metrics.clicks, null);
});

test("GA4 invalid values are excluded and unverifiable stored zero is unknown", () => {
  const result = build({ facts: [fact({ id: "zero", value: 0 }), fact({ id: "negative", value: -1 }), fact({ id: "nan", value: NaN }), fact({ id: "infinite", value: Infinity })] });
  assert.deepEqual(result.ga4.observations.map((row) => row.value), [null]);
});

test("GA4 source identity and recent timestamps do not establish the provenance of a stored zero", () => {
  const result = build({ connections: [connection({ lastSuccessfulSyncAt: now })], facts: [
    fact({ id: "sessions-zero", connectionId: "ga4-1", value: 0 }),
    fact({ id: "conversions-zero", connectionId: "ga4-1", metric: "conversions", value: 0 }),
    fact({ id: "positive", connectionId: "ga4-1", date: range.to, metric: "conversions", value: 2 }),
  ] });
  assert.deepEqual(result.ga4.observations.map((row) => [row.id, row.value]), [["positive", 2], ["conversions-zero", null], ["sessions-zero", null]]);
  assert.ok(result.ga4.observations.every((row) => row.sourceId === "ga4-1"));
  assert.equal(result.sources[0].lastSuccessfulSyncAt, now.toISOString());
});

test("unknown GA4 zeros do not change explicit paid zeros or mutate saved facts", () => {
  const ga4Zero = fact({ value: 0, metric: "conversions" });
  const result = build({ connections: [paidConnection()], facts: [ga4Zero, paidFact({ metric: "conversions", value: 0 })] });
  assert.equal(result.ga4.observations[0].value, null);
  assert.equal(result.paid.accounts[0].metrics.conversions, 0);
  assert.equal(result.paid.accounts[0].observedDays.conversions, 1);
  assert.equal(ga4Zero.value, 0);
});

test("paid observations sum canonical campaigns, exclude account rollups, and preserve missing days", () => {
  const result = build({ connections: [paidConnection()], facts: [
    paidFact({ id: "a", value: 10 }), paidFact({ id: "b", campaignExternalId: "campaign-2", value: 15 }),
    paidFact({ id: "rollup", campaignExternalId: "", value: 25 }),
    paidFact({ id: "zero", date: range.to, value: 0 }),
    paidFact({ id: "spend", metric: "spend", value: 30 }),
  ] }).paid.accounts[0];
  assert.deepEqual(result.metrics, { clicks: 25, spend: 30, impressions: null, conversions: null });
  assert.deepEqual(result.series.map((row) => [row.date, row.clicks]), [["2026-09-01", 25], ["2026-09-03", 0]]);
  assert.equal(result.observedDays.clicks, 2);
  assert.equal(result.currency, "EUR");
  assert.match(result.notices[0], /excluded/);
});

test("duplicate campaign/day metrics fail closed instead of being double counted", () => {
  const account = build({ connections: [paidConnection()], facts: [paidFact(), paidFact({ id: "duplicate" }), paidFact({ id: "spend", metric: "spend", value: 7 })] }).paid.accounts[0];
  assert.equal(account.metrics.clicks, null);
  assert.equal(account.metrics.spend, 7);
  assert.ok(account.series.every((row) => row.clicks === null));
  assert.match(account.notices[0], /conflicting/);
});

for (const currencies of [[null], ["EUR", "USD"], ["USD"], ["usd"], ["E"]]) {
  test(`paid spend rejects missing, mixed or conflicting currencies: ${JSON.stringify(currencies)}`, () => {
    const account = build({ connections: [paidConnection()], facts: [paidFact(), ...currencies.map((currency, index) => paidFact({ id: `spend-${index}`, campaignExternalId: `c-${index}`, metric: "spend", currency }))] }).paid.accounts[0];
    assert.equal(account.metrics.spend, null);
    assert.equal(account.currency, null);
    assert.equal(account.metrics.clicks, 12);
  });
}

test("different account currencies and overlapping provider conversions are never combined", () => {
  const accounts = build({ connections: [paidConnection(), paidConnection({ id: "meta-1", platform: "meta_ads", currency: "USD" })], facts: [
    paidFact({ metric: "spend", value: 10 }),
    paidFact({ id: "meta", connectionId: "meta-1", platform: "meta_ads", metric: "spend", value: 20, currency: "USD" }),
  ] }).paid.accounts;
  assert.deepEqual(accounts.map((account) => [account.currency, account.metrics.spend]), [["EUR", 10], ["USD", 20]]);
});

test("invalid paid observations and overflowing sums are withheld", () => {
  for (const value of [-1, NaN, Infinity, Number.MAX_VALUE]) {
    const account = build({ connections: [paidConnection()], facts: [paidFact({ value }), paidFact({ id: "other", campaignExternalId: "other", value })] }).paid.accounts[0];
    assert.equal(account.metrics.clicks, null);
    assert.deepEqual(account.series, []);
  }
});

test("disconnected and failed sources are explicit while historical data is preserved", () => {
  for (const [status, expected] of [["revoked", "revoked"], ["error", "error"], ["future", "unknown"]]) {
    const result = build({ connections: [paidConnection({ status })], facts: [paidFact()] });
    assert.equal(result.sources[0].connectionState, expected);
    assert.equal(result.paid.accounts[0].metrics.clicks, 12);
  }
});

test("read bounds never present truncated paid observations as a complete aggregate", () => {
  const result = build({ connections: [paidConnection()], facts: Array.from({ length: MAX_MEASUREMENT_FACTS + 1 }, (_, index) => paidFact({ id: `fact-${index}`, campaignExternalId: `campaign-${index}` })) });
  assert.equal(result.limited, true);
  assert.equal(result.paid.accounts[0].metrics.clicks, null);
  assert.deepEqual(result.paid.accounts[0].series, []);
  const ga4 = build({ facts: Array.from({ length: 101 }, (_, index) => fact({ id: `ga4-${index}` })) }).ga4;
  assert.equal(ga4.observations.length, 100);
  assert.equal(ga4.observationsLimited, true);
});

test("structured database queries scope row and relation ownership and exclude stale data", () => {
  const queries = measurementQueries("workspace-1", range);
  assert.equal(queries.connections.where.workspaceId, "workspace-1");
  assert.equal(queries.connections.take, MAX_MEASUREMENT_SOURCES + 1);
  assert.equal(queries.facts.take, MAX_MEASUREMENT_FACTS + 1);
  assert.equal(queries.facts.where.workspaceId, "workspace-1");
  assert.equal(queries.facts.where.staleAt, null);
  assert.deepEqual(queries.facts.where.date, { gte: range.from, lt: range.toExclusive });
  for (const branch of queries.facts.where.OR) {
    assert.deepEqual(branch.OR[0], { connection: { workspaceId: "workspace-1", platform: branch.platform } });
    assert.equal(branch.OR.length, branch.platform === "ga4" ? 2 : 1);
  }
  assert.equal("encAccessToken" in queries.connections.select, false);
  assert.equal("lastErrorMessage" in queries.connections.select, false);
});

test("reader requires workspace identity before access and propagates failures without fallback data", async () => {
  let calls = 0;
  const dependencies = { now: () => now, readSnapshot: async (workspaceId: string) => {
    calls++;
    assert.equal(workspaceId, "workspace-1");
    throw new Error("database failure");
  } };
  await assert.rejects(readMeasurementAnalytics(" ", range, dependencies), /workspace_id_required/);
  assert.equal(calls, 0);
  await assert.rejects(readMeasurementAnalytics("workspace-1", range, dependencies), /database failure/);
  assert.equal(calls, 1);
});
