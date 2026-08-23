import assert from "node:assert/strict";
import test from "node:test";

import {
  buildDistributionAnalytics,
  readDistributionAnalytics,
  type DistributionAnalyticsDependencies,
  type PaidAnalyticsInput,
} from "../service";
import type { OrganicAnalyticsInput, SeoAnalyticsInput } from "../types";
import { parseAnalyticsRange } from "../validation";

const range = parseAnalyticsRange(new URLSearchParams("from=2026-08-01&to=2026-08-07"));

function organic(overrides: Partial<OrganicAnalyticsInput> = {}): OrganicAnalyticsInput {
  return {
    total: 0,
    userConfirmedExternalHandoffs: 0,
    byState: [],
    byPlatform: [],
    scheduled: [],
    userConfirmedExternalHandoffsByDate: [],
    earliestActivityAt: null,
    latestActivityAt: null,
    latestUpdatedAt: null,
    ...overrides,
  };
}

function seo(overrides: Partial<SeoAnalyticsInput> = {}): SeoAnalyticsInput {
  return {
    total: 0,
    byStatus: [],
    bySeverity: [],
    byPriority: [],
    earliestActivityAt: null,
    latestActivityAt: null,
    latestAnalyzedAt: null,
    latestUpdatedAt: null,
    ...overrides,
  };
}

function metrics(overrides: Record<string, number | null> = {}) {
  return {
    spend: null, revenue: null, roas: null, cpa: null, conversions: null, clicks: null,
    impressions: null, ctr: null, cpc: null, cpm: null, cvr: null, aov: null,
    ...overrides,
  };
}

function paid(overrides: Partial<PaidAnalyticsInput> = {}): PaidAnalyticsInput {
  return {
    totals: metrics(),
    platforms: [],
    sources: [],
    currency: null,
    currencies: [],
    mixedCurrency: false,
    requestedFrom: range.from.toISOString(),
    requestedTo: range.to.toISOString(),
    observedFrom: null,
    observedTo: null,
    state: "unavailable",
    campaigns: [],
    ...overrides,
  };
}

test("tenant boundary passes only the authorized workspace id to every reader", async () => {
  const seen: string[] = [];
  const dependencies: DistributionAnalyticsDependencies = {
    readOrganic: async (workspaceId) => { seen.push(workspaceId); return organic(); },
    readSeo: async (workspaceId) => { seen.push(workspaceId); return seo(); },
    readPaid: async (workspaceId) => { seen.push(workspaceId); return paid(); },
    now: () => new Date("2026-08-21T12:00:00.000Z"),
  };
  await readDistributionAnalytics("workspace-authorized", range, dependencies);
  assert.deepEqual(seen, ["workspace-authorized", "workspace-authorized", "workspace-authorized"]);
  assert.equal(seen.includes("workspace-foreign"), false);
});

test("a persistence reader failure fails closed instead of returning a partial fabrication", async () => {
  const dependencies: DistributionAnalyticsDependencies = {
    readOrganic: async () => organic(),
    readSeo: async () => { throw new Error("database unavailable"); },
    readPaid: async () => paid(),
    now: () => new Date("2026-08-21T12:00:00.000Z"),
  };
  await assert.rejects(
    readDistributionAnalytics("workspace-authorized", range, dependencies),
    /database unavailable/,
  );
});

test("unknown measured metrics remain null rather than becoming zero", () => {
  const result = buildDistributionAnalytics({
    range,
    organic: organic(),
    seo: seo(),
    paid: paid(),
    generatedAt: new Date("2026-08-21T12:00:00.000Z"),
  });
  assert.equal(result.paid.totals.spend, null);
  assert.equal(result.paid.totals.conversions, null);
  assert.equal(result.organic.performance.reach, null);
  assert.equal(result.organic.performance.impressions, null);
});

test("mixed currency defensively removes blended money and ROAS while preserving observed counts", () => {
  const result = buildDistributionAnalytics({
    range,
    organic: organic(),
    seo: seo(),
    paid: paid({
      totals: metrics({ spend: 400, revenue: 700, roas: 1.75, conversions: 12 }),
      mixedCurrency: true,
      currency: "USD",
      currencies: ["EUR", "USD"],
    }),
    generatedAt: new Date("2026-08-21T12:00:00.000Z"),
  });
  assert.equal(result.paid.currency, null);
  assert.equal(result.paid.totals.spend, null);
  assert.equal(result.paid.totals.revenue, null);
  assert.equal(result.paid.totals.roas, null);
  assert.equal(result.paid.totals.conversions, 12);
});

test("empty state is explicit and organic performance remains unavailable", () => {
  const result = buildDistributionAnalytics({
    range,
    organic: organic(),
    seo: seo(),
    paid: paid(),
    generatedAt: new Date("2026-08-21T12:00:00.000Z"),
  });
  assert.equal(result.state, "empty");
  assert.equal(result.organic.state, "empty");
  assert.equal(result.seo.state, "empty");
  assert.equal(result.paid.state, "unavailable");
  assert.equal(result.organic.performance.reason, "organic_provider_reads_not_connected");
});

test("organic workflow reports persisted handoff attestations without presenting them as provider-confirmed publication", () => {
  const result = buildDistributionAnalytics({
    range,
    organic: organic({
      total: 4,
      userConfirmedExternalHandoffs: 1,
      byState: [{ key: "scheduled", count: 2 }, { key: "published", count: 1 }, { key: "future_state", count: 1 }],
      byPlatform: [{ key: "instagram", count: 3 }, { key: "unsupported", count: 1 }],
      scheduled: [{ at: new Date("2026-08-03T10:00:00.000Z"), count: 2 }],
      userConfirmedExternalHandoffsByDate: [{ at: new Date("2026-08-04T16:00:00.000Z"), count: 1 }],
    }),
    seo: seo({
      total: 3,
      byStatus: [{ key: "open", count: 2 }, { key: "completed", count: 1 }],
      bySeverity: [{ key: "critical", count: 1 }, { key: "high", count: 2 }],
      byPriority: [{ priority: 10, count: 1 }, { priority: 60, count: 2 }],
    }),
    paid: paid(),
    generatedAt: new Date("2026-08-21T12:00:00.000Z"),
  });
  assert.equal(result.organic.byState.find((item) => item.key === "other")?.count, 1);
    assert.equal(result.organic.byPlatform.find((item) => item.key === "instagram")?.count, 3);
    assert.equal(result.organic.timeline.find((item) => item.date === "2026-08-03")?.scheduled, 2);
    assert.equal(result.organic.timeline.find((item) => item.date === "2026-08-04")?.userConfirmedExternalHandoffs, 1);
    assert.equal("published" in result.organic.timeline[0], false);
    assert.match(result.sources[0].detail ?? "", /user-confirmed external handoffs/);
    assert.match(result.organic.performance.message, /do not establish reach/);
  assert.equal(result.seo.byPriority.find((item) => item.key === "p51_75")?.count, 2);
});

test("DTO arrays remain bounded for a maximum date range and many paid sources", () => {
  const maximum = parseAnalyticsRange(new URLSearchParams("from=2024-01-01&to=2024-12-31"));
  const sources = Array.from({ length: 45 }, (_, index) => ({
    key: `google_ads:account-${index}`,
    id: `connection-${index}`,
    connectionId: `connection-${index}`,
    accountId: `account-${index}`,
    accountName: index === 0 ? `Account ${"x".repeat(800)}` : `Account ${index}`,
    platform: "google_ads",
    platformLabel: "Google Ads",
    currency: "USD",
    timezone: "UTC",
    state: "available",
    detail: null,
    requestedFrom: maximum.from.toISOString(),
    requestedTo: maximum.to.toISOString(),
    observedFrom: maximum.from.toISOString(),
    observedTo: maximum.to.toISOString(),
    lastSyncedAt: "2026-08-21T12:00:00.000Z",
  }));
  const result = buildDistributionAnalytics({
    range: maximum,
    organic: organic(),
    seo: seo(),
    paid: paid({ sources, currencies: Array.from({ length: 15 }, (_, index) => `X${String(index).padStart(2, "0")}`) }),
    generatedAt: new Date("2026-08-21T12:00:00.000Z"),
  });
  assert.equal(result.organic.timeline.length, 366);
  assert.equal(result.sources.length, 32);
  assert.equal(result.paid.currencies.length, 10);
  assert.equal(result.sourcesTruncated, true);
  assert.equal(result.paid.sourcesTruncated, true);
  assert.ok(result.sources.every((source) => source.name.length <= 160));
});
