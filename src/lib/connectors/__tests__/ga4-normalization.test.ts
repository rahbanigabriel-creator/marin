import assert from "node:assert/strict";
import test from "node:test";
import { normalizeGa4Report } from "../clients";
import { toFactInput } from "@/lib/metrics/ingest";

function normalize(values?: Array<{ value?: unknown }>) {
  return normalizeGa4Report({ rows: [{
    dimensionValues: [{ value: "20260901" }, { value: "Launch" }],
    metricValues: values,
  }] });
}

test("GA4 missing conversions and revenue do not become zero-valued canonical facts", () => {
  const rows = normalize([{ value: "12" }]);
  assert.deepEqual(rows.map((row) => [row.metric, row.value]), [["sessions", 12]]);
  const facts = rows.map((row) => toFactInput("workspace-1", "ga4", row));
  assert.deepEqual(facts, [{ workspaceId: "workspace-1", platform: "ga4", date: new Date("2026-09-01"), campaign: "Launch", metric: "sessions", value: 12 }]);
});

test("GA4 entirely absent metric arrays and values produce no measurements", () => {
  assert.deepEqual(normalize(), []);
  assert.deepEqual(normalize([]), []);
  assert.deepEqual(normalize([{}, {}, {}]), []);
  assert.deepEqual(normalizeGa4Report({}), []);
});

test("GA4 missing or invalid metric slots are omitted without shifting other metric mappings", () => {
  for (const value of [undefined, null, "", " ", "not-a-number", "NaN", "Infinity", NaN, Infinity, {}, [], false]) {
    assert.deepEqual(normalize([{ value }, { value: "3" }, { value }]).map((row) => [row.metric, row.value]), [["conversions", 3]]);
    assert.deepEqual(normalize([{ value: "12" }, { value }, { value: "9.25" }]).map((row) => [row.metric, row.value]), [["revenue", 9.25], ["sessions", 12]]);
  }
});

test("GA4 explicit provider zero remains zero at normalization without adding unreported metrics", () => {
  assert.deepEqual(normalize([{ value: "0" }, { value: 0 }, { value: "0.0" }]).map((row) => [row.metric, row.value]), [["revenue", 0], ["conversions", 0], ["sessions", 0]]);
  assert.deepEqual(normalize([{}, { value: "0" }]).map((row) => [row.metric, row.value]), [["conversions", 0]]);
});
