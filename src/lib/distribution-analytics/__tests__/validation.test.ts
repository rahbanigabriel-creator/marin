import assert from "node:assert/strict";
import test from "node:test";

import {
  AnalyticsRangeError,
  MAX_ANALYTICS_DAYS,
  parseAnalyticsRange,
} from "../validation";

test("defaults to the last 30 UTC days", () => {
  const range = parseAnalyticsRange(new URLSearchParams(), new Date("2026-08-21T22:45:00.000Z"));
  assert.equal(range.from.toISOString(), "2026-07-23T00:00:00.000Z");
  assert.equal(range.to.toISOString(), "2026-08-21T00:00:00.000Z");
  assert.equal(range.toExclusive.toISOString(), "2026-08-22T00:00:00.000Z");
  assert.equal(range.days, 30);
});

test("accepts an exact inclusive 366 day range", () => {
  const range = parseAnalyticsRange(new URLSearchParams("from=2024-01-01&to=2024-12-31"));
  assert.equal(range.days, MAX_ANALYTICS_DAYS);
});

test("rejects partial, repeated, unknown, invalid, reversed, and oversized ranges", () => {
  const cases = [
    "from=2026-08-01",
    "to=2026-08-01",
    "from=2026-08-01&to=2026-08-21&from=2026-08-02",
    "from=2026-08-01&to=2026-08-21&workspaceId=foreign",
    "from=2026-02-30&to=2026-03-02",
    "from=2026-08-22&to=2026-08-21",
    "from=2024-01-01&to=2025-01-01",
  ];
  for (const value of cases) {
    assert.throws(() => parseAnalyticsRange(new URLSearchParams(value)), AnalyticsRangeError, value);
  }
});

