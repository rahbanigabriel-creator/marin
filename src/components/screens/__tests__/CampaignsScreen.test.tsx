import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

import {
  campaignWithIntegrityLabel,
  isCachedPaidSourceState,
  PaidSyncButton,
} from "@/components/screens/CampaignsScreen";
import type { MetricRecord, PaidCampaign, PaidSource } from "@/components/dashboard/format";

const metrics: MetricRecord = {
  spend: 120,
  revenue: 360,
  roas: 3,
  cpa: 12,
  conversions: 10,
  clicks: 80,
  impressions: 2_000,
  ctr: 4,
  cpc: 1.5,
  cpm: 60,
  cvr: 12.5,
  aov: 36,
};

function source(state: PaidSource["state"]): PaidSource {
  return {
    key: "meta_ads:fitura",
    id: "source-1",
    accountId: "fitura",
    accountName: "Fitura Ads",
    platform: "meta_ads",
    platformLabel: "Meta Ads",
    currency: "EUR",
    timezone: "Europe/Madrid",
    currencyUnsafe: false,
    state,
    detail: null,
    requestedFrom: "2026-08-01",
    requestedTo: "2026-08-31",
    observedFrom: "2026-08-01",
    observedTo: "2026-08-24",
    lastSyncedAt: "2026-08-24T12:00:00.000Z",
  };
}

function campaign(state: PaidCampaign["sourceState"] = "available"): PaidCampaign {
  return {
    identity: "fitura:campaign-1",
    accountKey: "meta_ads:fitura",
    accountId: "fitura",
    accountName: "Fitura Ads",
    externalId: "campaign-1",
    platform: "meta_ads",
    label: "Meta Ads",
    campaign: "Install campaign",
    currency: "EUR",
    timezone: null,
    currencyUnsafe: false,
    sourceState: state,
    observedFrom: null,
    observedTo: null,
    status: "ACTIVE",
    objective: "APP_INSTALLS",
    budget: 50,
    budgetType: "daily",
    series: [{ date: "2026-08-24", ...metrics }],
    ads: [{
      externalId: "ad-1",
      name: "Carousel creative",
      status: "ACTIVE",
      creativeType: "carousel",
      thumbnailUrl: null,
      title: "Train smarter",
      body: null,
      callToAction: "INSTALL_NOW",
      linkUrl: null,
      currency: "EUR",
      timezone: null,
      metricsFrom: null,
      metricsTo: null,
      ...metrics,
    }],
    ...metrics,
  };
}

test("read-only users receive a disabled, explained sync control", () => {
  const html = renderToStaticMarkup(
    <PaidSyncButton
      canManage={false}
      syncing={false}
      onSync={() => {}}
      className="sync-control"
    />,
  );

  assert.match(html, /disabled=""/);
  assert.match(html, />Sync unavailable</);
  assert.match(html, /Only workspace owners and admins can sync ad accounts/);
  assert.doesNotMatch(html, />Sync now</);
});

test("managers retain the active sync control", () => {
  const html = renderToStaticMarkup(
    <PaidSyncButton
      canManage
      syncing={false}
      onSync={() => {}}
      className="sync-control"
    />,
  );

  assert.match(html, />Sync now</);
  assert.doesNotMatch(html, /disabled=""/);
  assert.doesNotMatch(html, /Sync unavailable/);
});

test("permission loading never mislabels an owner as read-only", () => {
  const html = renderToStaticMarkup(
    <PaidSyncButton
      canManage={false}
      accessLoading
      syncing={false}
      onSync={() => {}}
      className="sync-control"
    />,
  );

  assert.match(html, /disabled=""/);
  assert.match(html, />Checking access</);
  assert.doesNotMatch(html, /Only workspace owners and admins/);
  assert.doesNotMatch(html, /Sync unavailable/);
});

test("failed account observations stay intact but become explicit cached display data", () => {
  const original = campaign();
  const display = campaignWithIntegrityLabel(original, [source("failed")], "failed");

  assert.notStrictEqual(display, original);
  assert.equal(display.campaign, "Cached · Install campaign");
  assert.equal(display.sourceState, "failed");
  assert.equal(display.observedFrom, "2026-08-01");
  assert.equal(display.observedTo, "2026-08-24");
  assert.equal(display.timezone, "Europe/Madrid");
  assert.equal(display.spend, 120);
  assert.equal(display.ads[0]?.name, "Cached · Carousel creative");
  assert.equal(display.ads[0]?.metricsFrom, "2026-08-01");
  assert.equal(display.ads[0]?.metricsTo, "2026-08-24");
  assert.equal(display.ads[0]?.spend, 120);
});

test("current account observations are unchanged even when another source makes the dashboard failed", () => {
  const original = campaign();
  const display = campaignWithIntegrityLabel(original, [source("available")], "failed");

  assert.strictEqual(display, original);
  assert.equal(display.campaign, "Install campaign");
});

test("campaign and fallback dashboard stale states are classified as cached", () => {
  assert.equal(isCachedPaidSourceState("stale"), true);
  assert.equal(isCachedPaidSourceState("revoked"), true);
  assert.equal(isCachedPaidSourceState("failed"), true);
  assert.equal(isCachedPaidSourceState("partial"), false);
  assert.equal(campaignWithIntegrityLabel(campaign("revoked"), [source("available")], "available").campaign, "Cached · Install campaign");
  assert.equal(campaignWithIntegrityLabel(campaign(), [], "stale").campaign, "Cached · Install campaign");
});
