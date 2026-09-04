import assert from "node:assert/strict";
import test from "node:test";

import { createAgentPublicEvent } from "@/lib/agent-runs/events";
import {
  analyzePaidMonitor,
  exactPaidMonitorBinding,
  isRecentPaidMonitorWindow,
  paidMonitorWindow,
  type PaidMonitorAttemptSource,
  type PaidMonitorCampaignSource,
  type PaidMonitorFactSource,
} from "@/lib/agent-runs/paid-monitor";

const NOW = new Date("2026-09-04T12:00:00.000Z");
const WINDOW = paidMonitorWindow({ from: "2026-08-28", to: "2026-09-03" });
if (!WINDOW) throw new Error("Test monitor window is invalid");

const CONNECTION = {
  id: "connection_1",
  platform: "google_ads" as const,
  accountId: "1234567890",
  accountName: "Fitura",
  currency: "EUR",
  timezone: "Europe/Madrid",
  lastSuccessfulSyncAt: new Date("2026-09-04T08:00:00.000Z"),
};

const ATTEMPT: PaidMonitorAttemptSource = {
  id: "sync_1",
  status: "succeeded",
  requestedFrom: WINDOW.from,
  requestedTo: WINDOW.to,
  observedFrom: new Date("2026-08-28T00:00:00.000Z"),
  observedTo: new Date("2026-09-03T00:00:00.000Z"),
  startedAt: new Date("2026-09-04T07:59:00.000Z"),
  completedAt: new Date("2026-09-04T08:00:00.000Z"),
};

function fact(
  id: string,
  campaignExternalId: string,
  campaignName: string,
  metric: string,
  value: number,
): PaidMonitorFactSource {
  return {
    id,
    date: new Date("2026-09-03T00:00:00.000Z"),
    campaignExternalId,
    campaignName,
    metric,
    value,
    currency: "EUR",
  };
}

function campaign(
  id: string,
  providerExternalId: string,
  name: string,
): PaidMonitorCampaignSource {
  return {
    id,
    providerExternalId,
    name,
    status: "active",
    objective: "sales",
    budget: 50,
    currency: "EUR",
  };
}

test("monitor bindings and windows reject drift and stale requests", () => {
  assert.equal(isRecentPaidMonitorWindow(WINDOW, NOW), true);
  const stale = paidMonitorWindow({ from: "2026-07-01", to: "2026-07-30" });
  assert.ok(stale);
  assert.equal(isRecentPaidMonitorWindow(stale, NOW), false);
  assert.equal(paidMonitorWindow({ from: "2026-08-01", to: "2026-09-03" }), null);
  assert.deepEqual(exactPaidMonitorBinding({
    kind: "paid_monitor",
    connectionId: "connection_1",
    platform: "meta_ads",
    accountId: "act_123",
    accountName: "Fitura Meta",
    from: "2026-08-28",
    to: "2026-09-03",
    boundAt: "2026-09-04T08:00:00.000Z",
  }), {
    kind: "paid_monitor",
    connectionId: "connection_1",
    platform: "meta_ads",
    accountId: "act_123",
    accountName: "Fitura Meta",
    from: "2026-08-28",
    to: "2026-09-03",
    boundAt: "2026-09-04T08:00:00.000Z",
  });
  assert.equal(exactPaidMonitorBinding({
    kind: "paid_monitor",
    connectionId: "connection_1",
    platform: "tiktok_ads",
    accountId: "account_1",
    accountName: "Unsupported",
    from: "2026-08-28",
    to: "2026-09-03",
    boundAt: "2026-09-04T08:00:00.000Z",
  }), null);
});

test("missing conversion evidence is never reported as zero conversions", () => {
  const withoutConversions = analyzePaidMonitor({
    now: NOW,
    window: WINDOW,
    connection: CONNECTION,
    latestAttempt: ATTEMPT,
    latestUsableAttempt: ATTEMPT,
    facts: [fact("metric_spend", "campaign_1", "Acquisition", "spend", 120)],
    campaigns: [campaign("campaign_row_1", "campaign_1", "Acquisition")],
  });
  assert.ok(withoutConversions.findings.some((finding) => finding.code === "conversion_evidence_missing"));
  assert.ok(withoutConversions.findings.some((finding) => finding.code === "campaign_conversion_evidence_missing"));
  assert.ok(!withoutConversions.findings.some((finding) => finding.code === "campaign_spend_zero_conversions"));

  const mixedCoverage = analyzePaidMonitor({
    now: NOW,
    window: WINDOW,
    connection: CONNECTION,
    latestAttempt: ATTEMPT,
    latestUsableAttempt: ATTEMPT,
    facts: [
      fact("a_spend", "campaign_a", "Measured", "spend", 120),
      fact("a_conversions", "campaign_a", "Measured", "conversions", 4),
      fact("b_spend", "campaign_b", "Unmeasured", "spend", 80),
    ],
    campaigns: [
      campaign("campaign_row_a", "campaign_a", "Measured"),
      campaign("campaign_row_b", "campaign_b", "Unmeasured"),
    ],
  });
  assert.ok(mixedCoverage.findings.some(
    (finding) =>
      finding.code === "campaign_conversion_evidence_missing" &&
      finding.label.startsWith("Unmeasured"),
  ));
  assert.ok(!mixedCoverage.findings.some(
    (finding) =>
      finding.code === "campaign_spend_zero_conversions" &&
      finding.label.startsWith("Unmeasured"),
  ));

  const withExplicitZero = analyzePaidMonitor({
    now: NOW,
    window: WINDOW,
    connection: CONNECTION,
    latestAttempt: ATTEMPT,
    latestUsableAttempt: ATTEMPT,
    facts: [
      fact("metric_spend", "campaign_1", "Acquisition", "spend", 120),
      fact("metric_conversions", "campaign_1", "Acquisition", "conversions", 0),
    ],
    campaigns: [campaign("campaign_row_1", "campaign_1", "Acquisition")],
  });
  const finding = withExplicitZero.findings.find(
    (candidate) => candidate.code === "campaign_spend_zero_conversions",
  );
  assert.ok(finding);
  assert.match(finding.detail, /explicitly recorded zero conversions/);
  assert.ok(finding.evidenceIds.includes("metric:metric_spend"));
  assert.ok(finding.evidenceIds.includes("metric:metric_conversions"));
});

test("campaign findings carry canonical evidence and source timestamps", () => {
  const report = analyzePaidMonitor({
    now: NOW,
    window: WINDOW,
    connection: CONNECTION,
    latestAttempt: ATTEMPT,
    latestUsableAttempt: ATTEMPT,
    facts: [
      fact("a_spend", "campaign_a", "Efficient search", "spend", 100),
      fact("a_conversions", "campaign_a", "Efficient search", "conversions", 10),
      fact("a_clicks", "campaign_a", "Efficient search", "clicks", 20),
      fact("a_impressions", "campaign_a", "Efficient search", "impressions", 10_000),
      fact("b_spend", "campaign_b", "Expensive social", "spend", 300),
      fact("b_conversions", "campaign_b", "Expensive social", "conversions", 2),
      fact("b_clicks", "campaign_b", "Expensive social", "clicks", 100),
      fact("b_impressions", "campaign_b", "Expensive social", "impressions", 10_000),
    ],
    campaigns: [
      campaign("campaign_row_a", "campaign_a", "Efficient search"),
      campaign("campaign_row_b", "campaign_b", "Expensive social"),
    ],
  });

  assert.equal(report.planKey, "paid.monitor.v1");
  assert.equal(report.summary.factCount, 8);
  assert.equal(report.summary.activeCampaignCount, 2);
  assert.ok(report.findings.some((finding) => finding.code === "campaign_cpa_above_account"));
  assert.ok(report.findings.some((finding) => finding.code === "campaign_ctr_low"));
  assert.ok(report.findings.some((finding) => finding.code === "campaign_efficiency_opportunity"));
  for (const finding of report.findings) {
    assert.ok(finding.evidenceIds.length > 0);
    assert.match(finding.detail, /Source observed through 2026-09-03T00:00:00.000Z/);
    assert.match(finding.detail, /sync recorded 2026-09-04T08:00:00.000Z/);
    assert.match(finding.detail, /requested window 2026-08-28 to 2026-09-03/);
    assert.doesNotThrow(() => createAgentPublicEvent({
      type: "evidence_observed",
      label: `${finding.kind === "alert" ? "Alert" : "Recommendation"}: ${finding.label}`,
      detail: finding.detail,
      objectType: finding.objectType,
      objectId: finding.objectId,
      evidenceIds: finding.evidenceIds,
    }));
  }
});

test("unavailable or stale persisted data produces bounded source alerts", () => {
  const failedAttempt = {
    ...ATTEMPT,
    id: "sync_failed",
    status: "failed",
    observedFrom: null,
    observedTo: null,
    startedAt: new Date("2026-09-01T07:59:00.000Z"),
    completedAt: new Date("2026-09-01T08:00:00.000Z"),
  };
  const report = analyzePaidMonitor({
    now: NOW,
    window: WINDOW,
    connection: { ...CONNECTION, lastSuccessfulSyncAt: null },
    latestAttempt: failedAttempt,
    latestUsableAttempt: null,
    facts: [],
    campaigns: [],
  });
  assert.ok(report.findings.some((finding) => finding.code === "latest_sync_failed"));
  assert.ok(report.findings.some((finding) => finding.code === "source_stale"));
  assert.ok(report.findings.some((finding) => finding.code === "usable_sync_missing"));
  assert.ok(report.findings.some((finding) => finding.code === "metrics_missing"));
  assert.ok(report.findings.length <= 8);
  assert.ok(report.findings.every((finding) => finding.evidenceIds.length > 0));
});
