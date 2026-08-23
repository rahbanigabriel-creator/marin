import assert from "node:assert/strict";
import test from "node:test";

import type { Connection } from "@prisma/client";

import type { PaidReadClient } from "../../connectors/paid-clients";
import { PaidProviderError } from "../../connectors/paid-errors";
import {
  PaidSyncInProgressError,
  PaidSyncPersistenceError,
  parsePaidSyncRangeInput,
  syncPaidConnection,
  syncPaidWorkspace,
} from "../../connectors/paid-sync";
import type { AdCreative, CampaignConfig, CanonicalMetric, FetchSnapshot } from "../../connectors/types";
import { prisma } from "../../db";
import { readPaidDashboard } from "../../metrics/paid-dashboard";

function disposableDatabaseEnabled(): boolean {
  if (process.env.MARPIN_INTEGRATION_DATABASE !== "1") return false;
  const databaseUrl = process.env.DATABASE_URL;
  const allowedUrl = process.env.POSTGRES_TEST_URL ?? process.env.TEST_DATABASE_URL;
  if (!databaseUrl || !allowedUrl || databaseUrl !== allowedUrl) return false;
  try {
    const url = new URL(databaseUrl);
    return (url.hostname === "localhost" || url.hostname === "127.0.0.1")
      && /(?:_test|_ci)$/.test(url.pathname.slice(1));
  } catch {
    return false;
  }
}

const integrationTest = disposableDatabaseEnabled() ? test : test.skip;
const DAY = new Date("2026-07-01T00:00:00.000Z");

type Stage = "initial" | "refresh" | "partial" | "malformed" | "failed" | "persistence_failure";

class FakePaidClient implements PaidReadClient {
  readonly platform = "google_ads" as const;
  stage: Stage = "initial";

  private currency(connection: Connection): string {
    return connection.externalAccountId.endsWith("eur") ? "EUR" : "USD";
  }

  private campaignIds(connection: Connection): string[] {
    return this.stage === "initial" && connection.externalAccountId.endsWith("eur")
      ? ["same-campaign", "removed-later"]
      : ["same-campaign"];
  }

  private snap<T>(connection: Connection, items: T[], range = false): FetchSnapshot<T> {
    return {
      items,
      complete: true,
      observedFrom: range && items.length ? DAY : null,
      observedTo: range && items.length ? DAY : null,
      currency: this.currency(connection),
      timezone: connection.externalAccountId.endsWith("eur") ? "Europe/Madrid" : "America/New_York",
    };
  }

  async fetchMetricsSnapshot(connection: Connection): Promise<FetchSnapshot<CanonicalMetric>> {
    if (this.stage === "malformed") throw new PaidProviderError(this.platform, "invalid_response", true);
    if (this.stage === "failed") throw new Error("Bearer super-secret-token from provider body");
    if (this.stage === "partial") {
      return { ...this.snap(connection, [], true), complete: false };
    }
    const value = this.stage === "refresh" ? 25 : 10;
    const rows = this.campaignIds(connection).flatMap((campaignExternalId) => ([
      {
        platform: this.platform,
        date: this.stage === "persistence_failure" ? new Date("invalid") : DAY,
        campaignExternalId,
        campaignName: "Duplicate campaign name",
        campaign: "Duplicate campaign name",
        metric: "spend",
        value,
      },
      {
        platform: this.platform,
        date: DAY,
        campaignExternalId,
        campaignName: "Duplicate campaign name",
        campaign: "Duplicate campaign name",
        metric: "clicks",
        value: 0,
      },
    ] satisfies CanonicalMetric[]));
    return this.snap(connection, rows, true);
  }

  async fetchCampaignsSnapshot(connection: Connection): Promise<FetchSnapshot<CampaignConfig>> {
    if (this.stage === "malformed") throw new PaidProviderError(this.platform, "invalid_response", true);
    if (this.stage === "failed") throw new Error("provider raw response: secret=abc");
    return this.snap(connection, this.campaignIds(connection).map((externalId) => ({
      platform: this.platform,
      externalId,
      name: "Duplicate campaign name",
      status: "active",
      budget: 10,
      budgetType: "daily" as const,
      currency: this.currency(connection),
    })));
  }

  async fetchAdsSnapshot(connection: Connection): Promise<FetchSnapshot<AdCreative>> {
    if (this.stage === "malformed") throw new PaidProviderError(this.platform, "invalid_response", true);
    if (this.stage === "failed") throw new Error("postgresql://secret@provider.invalid");
    return this.snap(connection, this.campaignIds(connection).map((campaignExternalId) => ({
      platform: this.platform,
      externalId: `ad-${campaignExternalId}`,
      campaignExternalId,
      campaignName: "Duplicate campaign name",
      name: "Duplicate ad name",
      spend: 0,
      impressions: null,
      clicks: 0,
      conversions: null,
      currency: this.currency(connection),
    })), true);
  }
}

class BlockingPaidClient implements PaidReadClient {
  readonly platform = "google_ads" as const;
  private enteredCount = 0;
  private release!: () => void;
  private enteredResolve!: () => void;
  private readonly blocked = new Promise<void>((resolve) => { this.release = resolve; });
  readonly entered = new Promise<void>((resolve) => { this.enteredResolve = resolve; });

  unblock(): void {
    this.release();
  }

  private async snapshot<T>(items: T[]): Promise<FetchSnapshot<T>> {
    this.enteredCount += 1;
    if (this.enteredCount === 3) this.enteredResolve();
    await this.blocked;
    return {
      items,
      complete: true,
      observedFrom: null,
      observedTo: null,
      currency: "EUR",
      timezone: "Europe/Madrid",
    };
  }

  fetchMetricsSnapshot(): Promise<FetchSnapshot<CanonicalMetric>> { return this.snapshot([]); }
  fetchCampaignsSnapshot(): Promise<FetchSnapshot<CampaignConfig>> { return this.snapshot([]); }
  fetchAdsSnapshot(): Promise<FetchSnapshot<AdCreative>> { return this.snapshot([]); }
}

test("paid sync ranges accept exactly two valid calendar days within 366 inclusive days", () => {
  const leapYear = parsePaidSyncRangeInput({ from: "2024-01-01", to: "2024-12-31" });
  assert.equal(leapYear?.from.toISOString(), "2024-01-01T00:00:00.000Z");
  assert.equal(leapYear?.to.toISOString(), "2024-12-31T00:00:00.000Z");
  assert.deepEqual(parsePaidSyncRangeInput({ from: "2026-07-02", to: "2026-07-01" }), null);
  assert.deepEqual(parsePaidSyncRangeInput({ from: "2024-01-01", to: "2025-01-01" }), null);
  assert.deepEqual(parsePaidSyncRangeInput({ from: "2026-02-30", to: "2026-03-01" }), null);
  assert.deepEqual(parsePaidSyncRangeInput({ from: "2026-07-01T00:00:00Z", to: "2026-07-02" }), null);
  assert.deepEqual(parsePaidSyncRangeInput({ from: "2026-07-01", to: "2026-07-02", days: 2 }), null);
  assert.deepEqual(parsePaidSyncRangeInput({ from: "2026-07-01" }), null);
  assert.deepEqual(parsePaidSyncRangeInput(null), null);
});

integrationTest("paid sync is tenant-safe, account-aware, idempotent, stale-safe, and truthful", async () => {
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const workspace = await prisma.workspace.create({ data: { name: "Paid", slug: `paid-${suffix}` } });
  const other = await prisma.workspace.create({ data: { name: "Other paid", slug: `paid-other-${suffix}` } });
  const connections = await Promise.all([
    prisma.connection.create({
      data: {
        workspaceId: workspace.id, platform: "google_ads", externalAccountId: "account-eur",
        displayName: "Europe account", encAccessToken: "encrypted-test", status: "connected",
      },
    }),
    prisma.connection.create({
      data: {
        workspaceId: workspace.id, platform: "google_ads", externalAccountId: "account-usd",
        displayName: "US account", encAccessToken: "encrypted-test", status: "connected",
      },
    }),
    prisma.connection.create({
      data: {
        workspaceId: other.id, platform: "google_ads", externalAccountId: "account-eur",
        displayName: "Other tenant", encAccessToken: "encrypted-test", status: "connected",
      },
    }),
  ]);
  const fake = new FakePaidClient();
  const range = { from: DAY, to: DAY };

  try {
    const first = await syncPaidWorkspace({
      workspaceId: workspace.id,
      range,
      clientFactory: () => fake,
    });
    assert.equal(first.state, "succeeded");
    assert.equal(first.results.length, 2);
    assert.ok(first.results.every((result) => result.phases.metrics.state === "succeeded"));

    const sameIdCampaigns = await prisma.campaign.findMany({
      where: { workspaceId: workspace.id, providerExternalId: "same-campaign", staleAt: null },
    });
    assert.equal(sameIdCampaigns.length, 2);
    assert.equal(new Set(sameIdCampaigns.map((campaign) => campaign.connectionId)).size, 2);
    const sameIdAds = await prisma.ad.findMany({
      where: { workspaceId: workspace.id, providerExternalId: "ad-same-campaign", staleAt: null },
    });
    assert.equal(sameIdAds.length, 2);

    const beforeRefresh = await prisma.metricFact.count({ where: { workspaceId: workspace.id } });
    fake.stage = "refresh";
    const refreshed = await syncPaidWorkspace({ workspaceId: workspace.id, range, clientFactory: () => fake });
    assert.equal(refreshed.state, "succeeded");
    assert.equal(await prisma.metricFact.count({ where: { workspaceId: workspace.id } }), beforeRefresh);
    const liveSpend = await prisma.metricFact.findMany({
      where: { workspaceId: workspace.id, campaignExternalId: "same-campaign", metric: "spend", staleAt: null },
    });
    assert.equal(liveSpend.length, 2);
    assert.ok(liveSpend.every((fact) => fact.value === 25));
    assert.equal(await prisma.campaign.count({
      where: { workspaceId: workspace.id, providerExternalId: "removed-later", staleAt: { not: null } },
    }), 1);
    assert.equal(await prisma.ad.count({
      where: { workspaceId: workspace.id, providerExternalId: "ad-removed-later", staleAt: { not: null } },
    }), 1);

    fake.stage = "partial";
    const partial = await syncPaidWorkspace({ workspaceId: workspace.id, range, clientFactory: () => fake });
    assert.equal(partial.state, "partial");
    assert.ok(partial.results.every((result) => result.phases.metrics.complete === false));
    assert.equal(await prisma.metricFact.count({
      where: { workspaceId: workspace.id, campaignExternalId: "same-campaign", metric: "spend", staleAt: null },
    }), 2, "incomplete metrics must preserve the last complete snapshot");

    fake.stage = "malformed";
    const malformed = await syncPaidWorkspace({ workspaceId: workspace.id, range, clientFactory: () => fake });
    assert.equal(malformed.state, "failed");
    assert.ok(malformed.results.every((result) => result.phases.metrics.errorCode === "invalid_response"));
    assert.equal(await prisma.metricFact.count({
      where: { workspaceId: workspace.id, campaignExternalId: "same-campaign", metric: "spend", staleAt: null },
    }), 2, "malformed provider envelopes must preserve the last complete snapshot");

    fake.stage = "failed";
    const failed = await syncPaidWorkspace({ workspaceId: workspace.id, range, clientFactory: () => fake });
    assert.equal(failed.state, "failed");
    const serialized = JSON.stringify(failed);
    assert.doesNotMatch(serialized, /super-secret|secret=abc|postgresql:\/\//i);
    assert.ok(failed.results.every((result) => result.phases.metrics.errorCode === "provider"));

    const dashboard = await readPaidDashboard(workspace.id, range);
    assert.equal(dashboard.campaigns.length, 2);
    assert.equal(new Set(dashboard.campaigns.map((campaign) => campaign.identity)).size, 2);
    assert.equal(dashboard.mixedCurrency, true);
    assert.equal(dashboard.totals.spend, null);
    assert.equal(dashboard.totals.clicks, 0);
    assert.ok(dashboard.campaigns.every((campaign) => campaign.spend === 25));
    assert.equal(dashboard.campaigns.some((campaign) => campaign.accountName === "Other tenant"), false);
    assert.equal(await prisma.syncAttempt.count({ where: { workspaceId: other.id } }), 0);

    const attempts = await prisma.syncAttempt.findMany({ where: { workspaceId: workspace.id } });
    assert.equal(attempts.length, 10);
    assert.ok(attempts.every((attempt) => !JSON.stringify(attempt.phaseDetails).includes("super-secret")));
    assert.deepEqual(new Set(connections.slice(0, 2).map((connection) => connection.workspaceId)), new Set([workspace.id]));

    const staleAttempt = await prisma.syncAttempt.create({
      data: {
        workspaceId: workspace.id,
        connectionId: connections[0].id,
        requestedFrom: DAY,
        requestedTo: DAY,
        startedAt: new Date(Date.now() - 11 * 60 * 1000),
      },
    });
    fake.stage = "refresh";
    await syncPaidConnection({ connection: connections[0], range, client: fake });
    const recovered = await prisma.syncAttempt.findUniqueOrThrow({ where: { id: staleAttempt.id } });
    assert.equal(recovered.status, "failed");
    assert.equal(recovered.errorCode, "sync_abandoned");
    assert.ok(recovered.completedAt);

    const blocker = new BlockingPaidClient();
    const firstSync = syncPaidConnection({ connection: connections[0], range, client: blocker });
    await blocker.entered;
    await Promise.race([
      prisma.connection.update({
        where: { id: connections[0].id },
        data: { displayName: "Updated while provider is slow" },
      }),
      new Promise<never>((_resolve, reject) => {
        setTimeout(() => reject(new Error("provider latency held a database row lock")), 1_500);
      }),
    ]);
    await assert.rejects(
      () => syncPaidConnection({ connection: connections[0], range, client: fake }),
      (error: unknown) => error instanceof PaidSyncInProgressError && error.code === "sync_in_progress",
    );
    blocker.unblock();
    await firstSync;

    fake.stage = "persistence_failure";
    await assert.rejects(
      () => syncPaidConnection({ connection: connections[0], range, client: fake }),
      (error: unknown) => error instanceof PaidSyncPersistenceError,
    );
    const terminal = await prisma.syncAttempt.findFirstOrThrow({
      where: { connectionId: connections[0].id },
      orderBy: { startedAt: "desc" },
    });
    assert.equal(terminal.status, "failed");
    assert.equal(terminal.errorCode, "persistence_unavailable");
    assert.ok(terminal.completedAt);
  } finally {
    await prisma.workspace.deleteMany({ where: { id: { in: [workspace.id, other.id] } } });
  }
});
