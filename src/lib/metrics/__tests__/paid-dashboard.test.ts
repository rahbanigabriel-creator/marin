import assert from "node:assert/strict";
import test from "node:test";

import { buildPaidDashboard, type PaidDashboardInput } from "../paid-dashboard";

const NOW = new Date();
const DAY = new Date("2026-07-01T00:00:00.000Z");

function input(): PaidDashboardInput {
  return {
    connections: [
      {
        id: "conn-eur", platform: "google_ads", externalAccountId: "account-eur", displayName: "Europe",
        status: "connected", currency: "EUR", timezone: "Europe/Madrid", lastSyncAt: NOW,
        lastSuccessfulSyncAt: NOW, lastErrorCode: null, lastErrorMessage: null,
      },
      {
        id: "conn-usd", platform: "google_ads", externalAccountId: "account-usd", displayName: "US",
        status: "connected", currency: "USD", timezone: "America/New_York", lastSyncAt: NOW,
        lastSuccessfulSyncAt: NOW, lastErrorCode: null, lastErrorMessage: null,
      },
    ],
    attempts: ["conn-eur", "conn-usd"].map((connectionId) => ({
      id: `attempt-${connectionId}`, connectionId, status: "succeeded",
      requestedFrom: DAY, requestedTo: DAY, observedFrom: DAY, observedTo: DAY,
      currency: connectionId === "conn-eur" ? "EUR" : "USD", timezone: "UTC",
      errorCode: null, errorMessage: null, startedAt: NOW, completedAt: NOW,
    })),
    facts: [
      { connectionId: "conn-eur", platform: "google_ads", date: DAY, campaignExternalId: "same-id", campaignName: "Same name", metric: "spend", value: 0, currency: "EUR" },
      { connectionId: "conn-eur", platform: "google_ads", date: DAY, campaignExternalId: "same-id", campaignName: "Same name", metric: "clicks", value: 10, currency: "EUR" },
      { connectionId: "conn-usd", platform: "google_ads", date: DAY, campaignExternalId: "same-id", campaignName: "Same name", metric: "spend", value: 20, currency: "USD" },
      { connectionId: "conn-usd", platform: "google_ads", date: DAY, campaignExternalId: "same-id", campaignName: "Same name", metric: "clicks", value: 5, currency: "USD" },
    ],
    previousFacts: [],
    campaigns: [
      { connectionId: "conn-eur", platform: "google_ads", providerExternalId: "same-id", name: "Same name", status: "active", objective: "Search", budget: 10, budgetType: "daily", currency: "EUR" },
      { connectionId: "conn-usd", platform: "google_ads", providerExternalId: "same-id", name: "Same name", status: "active", objective: "Search", budget: 20, budgetType: "daily", currency: "USD" },
    ],
    ads: [],
    range: { from: DAY, to: DAY },
  };
}

test("dashboard identity is account-aware even when campaign ids and names collide", () => {
  const data = buildPaidDashboard(input());
  assert.equal(data.campaigns.length, 2);
  assert.deepEqual(new Set(data.campaigns.map((campaign) => campaign.identity)), new Set([
    "conn-eur:same-id",
    "conn-usd:same-id",
  ]));
  assert.deepEqual(new Set(data.campaigns.map((campaign) => campaign.accountId)), new Set([
    "account-eur",
    "account-usd",
  ]));
});

test("mixed currencies block blended money while preserving evidenced counts", () => {
  const data = buildPaidDashboard(input());
  assert.equal(data.mixedCurrency, true);
  assert.deepEqual(data.currencies, ["EUR", "USD"]);
  assert.equal(data.totals.spend, null);
  assert.equal(data.totals.roas, null);
  assert.equal(data.totals.clicks, 15);
  assert.equal(data.currencyGroups.length, 2);
  assert.equal(data.currencyGroups.find((group) => group.currency === "EUR")?.totals.spend, 0);
  assert.equal(data.currencyGroups.find((group) => group.currency === "USD")?.totals.spend, 20);
});

test("missing campaign metrics remain null while explicit zero remains zero", () => {
  const data = buildPaidDashboard(input());
  const euro = data.campaigns.find((campaign) => campaign.connectionId === "conn-eur");
  assert.ok(euro);
  assert.equal(euro.spend, 0);
  assert.equal(euro.conversions, null);
  assert.equal(euro.revenue, null);
  assert.equal(euro.series[0]?.spend, 0);
  assert.equal(euro.series[0]?.conversions, null);
});

test("an aggregate stays unavailable when any selected child lacks the additive metric", () => {
  const value = input();
  value.connections[1].currency = "EUR";
  value.attempts[1].currency = "EUR";
  value.campaigns[1].currency = "EUR";
  value.facts = value.facts
    .map((fact) => fact.connectionId === "conn-usd" ? { ...fact, currency: "EUR" } : fact)
    .filter((fact) => !(fact.connectionId === "conn-usd" && fact.metric === "clicks"));
  const data = buildPaidDashboard(value);
  assert.equal(data.mixedCurrency, false);
  assert.equal(data.totals.spend, 20, "explicit zero participates in a complete sum");
  assert.equal(data.totals.clicks, null, "one missing child makes the aggregate unavailable");
  assert.equal(data.totals.ctr, null);
});

test("unknown money currency poisons blended money but never a known currency group", () => {
  const value = input();
  value.connections[1].currency = null;
  value.attempts[1].currency = null;
  value.campaigns[1].currency = null;
  value.facts = value.facts.map((fact) => fact.connectionId === "conn-usd" ? { ...fact, currency: null } : fact);
  const data = buildPaidDashboard(value);
  assert.deepEqual(data.currencies, ["EUR"]);
  assert.equal(data.mixedCurrency, true);
  assert.equal(data.currency, null);
  assert.equal(data.totals.spend, null);
  assert.equal(data.totals.roas, null);
  assert.equal(data.totals.clicks, 15);
  assert.equal(data.currencyGroups.length, 1);
  assert.equal(data.currencyGroups[0]?.currency, "EUR");
  assert.equal(data.currencyGroups[0]?.totals.spend, 0);
  assert.equal(data.campaigns.find((campaign) => campaign.connectionId === "conn-usd")?.spend, null);
});

test("each ad preserves its own requested metrics coverage", () => {
  const value = input();
  const from = new Date("2026-06-20T00:00:00.000Z");
  const to = new Date("2026-06-27T00:00:00.000Z");
  value.ads = [{
    connectionId: "conn-eur",
    platform: "google_ads",
    providerExternalId: "ad-1",
    campaignExternalId: "same-id",
    name: "Ad one",
    status: "active",
    creativeType: "text",
    thumbnailUrl: null,
    title: "Headline",
    body: "Body",
    callToAction: null,
    linkUrl: "https://example.com",
    spend: 5,
    impressions: 100,
    clicks: 10,
    conversions: 1,
    currency: "EUR",
    metricsFrom: from,
    metricsTo: to,
  }];
  const ad = buildPaidDashboard(value).campaigns
    .find((campaign) => campaign.connectionId === "conn-eur")?.ads[0];
  assert.equal(ad?.metricsFrom, from.toISOString());
  assert.equal(ad?.metricsTo, to.toISOString());
});

test("a running attempt is never reported as available", () => {
  const value = input();
  value.attempts[0] = { ...value.attempts[0], status: "running", completedAt: null };
  const source = buildPaidDashboard(value).sources.find((entry) => entry.connectionId === "conn-eur");
  assert.equal(source?.state, "unavailable");
});

test("source coverage stays bound to the selected reporting range", () => {
  const value = input();
  const widerFrom = new Date("2026-06-01T00:00:00.000Z");
  const widerTo = new Date("2026-07-01T00:00:00.000Z");
  value.attempts.push({
    ...value.attempts[0],
    id: "attempt-newer-wider-range",
    requestedFrom: widerFrom,
    requestedTo: widerTo,
    observedFrom: widerFrom,
    observedTo: widerTo,
    startedAt: new Date(NOW.getTime() + 1_000),
    completedAt: new Date(NOW.getTime() + 1_000),
  });

  const source = buildPaidDashboard(value).sources.find((entry) => entry.connectionId === "conn-eur");
  assert.equal(source?.requestedFrom, DAY.toISOString());
  assert.equal(source?.requestedTo, DAY.toISOString());
  assert.equal(source?.observedFrom, DAY.toISOString());
  assert.equal(source?.observedTo, DAY.toISOString());
});
