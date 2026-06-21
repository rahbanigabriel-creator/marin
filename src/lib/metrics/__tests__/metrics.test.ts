import assert from "node:assert/strict";
import test from "node:test";

import {
  createDbMetricsSource,
  hasLiveData,
  serializeMetricFacts,
  type MetricFactQuery,
  type MetricFactRow,
} from "../source";
import {
  ingestMetrics,
  toFactInput,
  MetricIngestError,
  type MetricFactInput,
  type MetricUpsert,
} from "../ingest";
import type { CanonicalMetric } from "../../connectors/types";

/**
 * Isolated metrics-layer tests. No live database: the prisma read/write seams
 * are stubbed (MetricFactQuery / MetricUpsert / count override), so the
 * aggregation, serialization, and idempotent-upsert logic is exercised in
 * pure-function form. Run: `npx tsx --test src/lib/metrics/__tests__/metrics.test.ts`.
 *
 * DATABASE_URL is forced-set here ONLY to exercise the gated count/ingest paths;
 * no connection is ever opened because the prisma calls are stubbed out.
 */

const D = (s: string) => new Date(`${s}T00:00:00.000Z`);

const SAMPLE_ROWS: MetricFactRow[] = [
  { platform: "google_ads", campaign: "", metric: "spend", value: 1000, date: D("2026-06-01") },
  { platform: "google_ads", campaign: "", metric: "spend", value: 500, date: D("2026-06-02") },
  { platform: "google_ads", campaign: "", metric: "roas", value: 4.0, date: D("2026-06-01") },
  { platform: "google_ads", campaign: "", metric: "roas", value: 3.0, date: D("2026-06-02") },
  { platform: "google_ads", campaign: "Generic — Broad", metric: "spend", value: 600, date: D("2026-06-01") },
  { platform: "google_ads", campaign: "Generic — Broad", metric: "conversions", value: 12, date: D("2026-06-01") },
  { platform: "meta_ads", campaign: "", metric: "spend", value: 800, date: D("2026-06-01") },
  { platform: "meta_ads", campaign: "", metric: "conversions", value: 40, date: D("2026-06-01") },
];

test("serializeMetricFacts sums additive metrics and averages rate metrics", () => {
  const out = serializeMetricFacts(SAMPLE_ROWS);
  // additive: google spend 1000 + 500 = 1500
  assert.match(out, /Google Ads — .*spend €1,500/);
  // rate: google roas avg (4 + 3) / 2 = 3.5×
  assert.match(out, /roas 3\.5×/);
  // platform label mapping applied
  assert.match(out, /Meta Ads —/);
  // campaign-level breakdown surfaces
  assert.match(out, /Generic — Broad: .*spend €600/);
  // window header present
  assert.match(out, /last 30 days/);
});

test("serializeMetricFacts respects the sections filter", () => {
  const out = serializeMetricFacts(SAMPLE_ROWS, ["spend"]);
  assert.match(out, /spend/);
  assert.doesNotMatch(out, /roas/);
});

test("serializeMetricFacts returns a safe sentinel on empty input", () => {
  assert.equal(serializeMetricFacts([]), "(no internal data available)");
});

test("createDbMetricsSource reads via the injected query and serializes", async () => {
  const calls: Array<{ workspaceId: string; since: Date }> = [];
  const stubQuery: MetricFactQuery = async (workspaceId, since) => {
    calls.push({ workspaceId, since });
    return SAMPLE_ROWS;
  };

  const source = await createDbMetricsSource("ws_123", stubQuery);
  const all = source.getAccountMetrics();

  assert.equal(calls.length, 1, "query should have been called once");
  assert.equal(calls[0].workspaceId, "ws_123");
  assert.ok(calls[0].since instanceof Date);
  // Same human-readable shape the agent expects from an internal read.
  assert.match(all, /Google Ads —/);

  // sections arg flows through to the serializer
  const onlySpend = source.getAccountMetrics(["spend"]);
  assert.doesNotMatch(onlySpend, /roas/);
});

test("hasLiveData is false with no DATABASE_URL (offline path stays sample)", async () => {
  const prev = process.env.DATABASE_URL;
  delete process.env.DATABASE_URL;
  try {
    // count stub would throw if called — proving the env gate short-circuits first.
    const live = await hasLiveData("ws_123", async () => {
      throw new Error("count must not run when DB is unconfigured");
    });
    assert.equal(live, false);
  } finally {
    if (prev === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = prev;
  }
});

test("hasLiveData reflects row count when DB is configured", async () => {
  const prev = process.env.DATABASE_URL;
  process.env.DATABASE_URL = "postgresql://stub";
  try {
    assert.equal(await hasLiveData("ws_123", async () => 0), false);
    assert.equal(await hasLiveData("ws_123", async () => 5), true);
    // a thrown probe degrades to false (never throws)
    assert.equal(
      await hasLiveData("ws_123", async () => {
        throw new Error("db unreachable");
      }),
      false,
    );
  } finally {
    if (prev === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = prev;
  }
});

test("toFactInput truncates date to midnight UTC and applies the account sentinel", () => {
  const m: CanonicalMetric = {
    platform: "google_ads",
    date: new Date("2026-06-01T14:37:00.000Z"),
    metric: "spend",
    value: 100,
  };
  const row = toFactInput("ws_1", "google_ads", m);
  assert.equal(row.campaign, "", "campaign-less metric uses the '' sentinel");
  assert.equal(row.date.toISOString(), "2026-06-01T00:00:00.000Z");
});

test("ingestMetrics upserts each row idempotently via the injected writer", async () => {
  const prev = process.env.DATABASE_URL;
  process.env.DATABASE_URL = "postgresql://stub";
  try {
    const writes: MetricFactInput[] = [];
    const recorder: MetricUpsert = async (row) => {
      writes.push(row);
    };
    const rows: CanonicalMetric[] = [
      { platform: "google_ads", date: D("2026-06-01"), metric: "spend", value: 100 },
      { platform: "google_ads", date: D("2026-06-01"), campaign: "Brand", metric: "spend", value: 50 },
    ];

    const n1 = await ingestMetrics("ws_1", "google_ads", rows, recorder);
    assert.equal(n1, 2);
    assert.equal(writes.length, 2);
    assert.equal(writes[0].campaign, "");
    assert.equal(writes[1].campaign, "Brand");
    assert.equal(writes[0].workspaceId, "ws_1");

    // Re-ingesting the same natural key is idempotent at the call level: it just
    // upserts again (same keys), never duplicating logic here.
    const n2 = await ingestMetrics("ws_1", "google_ads", rows, recorder);
    assert.equal(n2, 2);
  } finally {
    if (prev === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = prev;
  }
});

test("ingestMetrics throws MetricIngestError with no DATABASE_URL", async () => {
  const prev = process.env.DATABASE_URL;
  delete process.env.DATABASE_URL;
  try {
    await assert.rejects(
      () =>
        ingestMetrics(
          "ws_1",
          "google_ads",
          [{ platform: "google_ads", date: D("2026-06-01"), metric: "spend", value: 1 }],
          async () => {
            throw new Error("writer must not run when DB is unconfigured");
          },
        ),
      MetricIngestError,
    );
  } finally {
    if (prev === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = prev;
  }
});

test("ingestMetrics with no rows is a no-op", async () => {
  const prev = process.env.DATABASE_URL;
  process.env.DATABASE_URL = "postgresql://stub";
  try {
    const n = await ingestMetrics("ws_1", "google_ads", [], async () => {
      throw new Error("writer must not run for empty input");
    });
    assert.equal(n, 0);
  } finally {
    if (prev === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = prev;
  }
});
