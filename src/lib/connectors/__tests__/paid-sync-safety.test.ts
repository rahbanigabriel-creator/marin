import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import type { Connection, Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { PaidProviderError } from "../paid-errors";
import { type PaidReadClient, PaidSyncStoppedError } from "../paid-clients";
import { syncPaidConnection, syncPaidWorkspace, PaidSyncInProgressError, PaidSyncPersistenceError } from "../paid-sync";
import type { CanonicalMetric, FetchSnapshot } from "../types";
import { encryptToken, tokenAad } from "@/lib/security/vault";
import { getConnectionAccessToken, ConnectionCredentialsChangedError } from "../clients";

const DAY = new Date("2026-09-05T00:00:00Z");
const RANGE = { from: DAY, to: DAY };
function connection(id = "account"): Connection {
  return {
    id, workspaceId: "workspace", platform: "google_ads", externalAccountId: id,
    displayName: "Account", status: "connected", scopes: "reporting", encAccessToken: "old-token",
    encRefreshToken: null, expiresAt: null, currency: "EUR", timezone: "UTC",
    lastSyncAt: null, lastSuccessfulSyncAt: DAY, lastErrorCode: null, lastErrorMessage: null,
    createdAt: DAY, updatedAt: DAY,
  };
}
function snapshot<T>(items: T[]): FetchSnapshot<T> {
  return { items, complete: true, currency: "EUR", timezone: "UTC", observedFrom: DAY, observedTo: DAY };
}
const metric: CanonicalMetric = { platform: "google_ads", date: DAY, campaignExternalId: "campaign", metric: "spend", value: 10 };
function client(metrics: () => Promise<FetchSnapshot<CanonicalMetric>> = async () => snapshot([metric])): PaidReadClient {
  return { platform: "google_ads", fetchMetricsSnapshot: metrics, fetchCampaignsSnapshot: async () => snapshot([]), fetchAdsSnapshot: async () => snapshot([]) };
}

type Row = Record<string, unknown>;
function matches(row: Row, where: Row): boolean {
  return Object.entries(where).every(([key, value]) => {
    if (value && typeof value === "object" && !(value instanceof Date)) {
      if ("in" in value) return (value.in as unknown[]).includes(row[key]);
      if ("lt" in value) return row[key] instanceof Date && row[key] < (value.lt as Date);
    }
    return value instanceof Date ? row[key] instanceof Date && row[key].getTime() === value.getTime() : row[key] === value;
  });
}
function apply(row: Row, data: Row) {
  for (const [key, value] of Object.entries(data)) if (value !== undefined) row[key] = value;
}
function database(t: TestContext) {
  const connections = [connection()];
  const attempts: Row[] = [];
  const writes: string[] = [];
  let failMetrics = false;
  // Prisma exposes proxy methods without value descriptors, so Node's method
  // mock cannot wrap them. Restore each explicit override after this test.
  const stub = (target: object, key: string, value: unknown) => {
    const original = Reflect.get(target, key);
    Reflect.set(target, key, value);
    t.after(() => { Reflect.set(target, key, original); });
  };
  stub(prisma, "$transaction", async (fn: (tx: Prisma.TransactionClient) => Promise<unknown>) => fn(prisma));
  stub(prisma, "$queryRaw", async () => [{ id: "locked" }]);
  stub(prisma.connection, "findFirst", async ({ where }: { where: Row }) => structuredClone(connections.find((row) => matches(row as unknown as Row, where)) ?? null));
  stub(prisma.connection, "findMany", async () => structuredClone(connections));
  stub(prisma.connection, "update", async ({ where, data }: { where: Row; data: Row }) => {
    const row = connections.find((row) => matches(row as unknown as Row, where));
    assert.ok(row); apply(row as unknown as Row, data); return structuredClone(row);
  });
  stub(prisma.connection, "updateMany", async ({ where, data }: { where: Row; data: Row }) => {
    const rows = connections.filter((row) => matches(row as unknown as Row, where));
    rows.forEach((row) => apply(row as unknown as Row, data)); return { count: rows.length };
  });
  stub(prisma.syncAttempt, "findFirst", async ({ where }: { where: Row }) => structuredClone(attempts.find((row) => matches(row, where)) ?? null));
  stub(prisma.syncAttempt, "findUnique", async ({ where }: { where: Row }) => structuredClone(attempts.find((row) => matches(row, where)) ?? null));
  stub(prisma.syncAttempt, "create", async ({ data }: { data: Row }) => {
    const row = { ...data, id: `attempt-${attempts.length}`, status: "running", startedAt: new Date() };
    attempts.push(row); return structuredClone(row);
  });
  stub(prisma.syncAttempt, "update", async ({ where, data }: { where: Row; data: Row }) => {
    const row = attempts.find((row) => matches(row, where)); assert.ok(row); apply(row, data); return structuredClone(row);
  });
  stub(prisma.syncAttempt, "updateMany", async ({ where, data }: { where: Row; data: Row }) => {
    const rows = attempts.filter((row) => matches(row, where)); rows.forEach((row) => apply(row, data)); return { count: rows.length };
  });
  for (const [name, model] of [["metrics", prisma.metricFact], ["campaigns", prisma.campaign], ["ads", prisma.ad]] as const) {
    stub(model, "upsert", async () => { if (failMetrics) throw new Error("storage failure"); writes.push(name); return {}; });
    stub(model, "updateMany", async () => { writes.push(`${name}:stale`); return { count: 0 }; });
  }
  t.mock.method(globalThis, "fetch", async () => { throw new Error("Unexpected network request in mocked test"); });
  return { connections, attempts, writes, failMetrics: () => { failMetrics = true; } };
}

for (const outcome of ["success", "authentication", "permission"] as const) {
  test(`an old generation's ${outcome} cannot modify a reconnected account`, async (t) => {
    const db = database(t); const captured = structuredClone(db.connections[0]);
    const replacement = { ...captured, encAccessToken: "new-token", encRefreshToken: "new-refresh", scopes: "new-scopes" };
    const fake = client(async () => {
      Object.assign(db.connections[0], replacement);
      if (outcome !== "success") throw new PaidProviderError("google_ads", outcome, false);
      return snapshot([metric]);
    });
    await assert.rejects(syncPaidConnection({ connection: captured, range: RANGE, client: fake }), (error: unknown) => error instanceof PaidSyncStoppedError && error.code === "connection_changed");
    assert.equal(db.connections[0].encAccessToken, "new-token");
    assert.equal(db.connections[0].status, "connected");
    assert.equal(db.connections[0].currency, "EUR");
    assert.equal(db.connections[0].timezone, "UTC");
    assert.equal(db.connections[0].lastErrorCode, null);
    assert.deepEqual(db.writes, []);
    assert.equal(db.attempts[0].status, "cancelled");
  });
}

test("pause after provider work cancels without metadata or evidence writes", async (t) => {
  const db = database(t); let paused = false; const pause = new Error("policy_paused");
  await assert.rejects(syncPaidConnection({
    connection: db.connections[0], range: RANGE, guard: async () => { if (paused) throw pause; },
    client: client(async () => { paused = true; return snapshot([metric]); }),
  }), (error: unknown) => error === pause);
  assert.equal(db.connections[0].status, "connected"); assert.equal(db.connections[0].currency, "EUR"); assert.equal(db.connections[0].timezone, "UTC");
  assert.equal(db.connections[0].lastSuccessfulSyncAt?.getTime(), DAY.getTime());
  assert.equal(db.connections[0].lastErrorCode, null); assert.deepEqual(db.writes, []);
  assert.equal(db.attempts[0].status, "cancelled");
});

test("row limits reject the complete batch before the first upsert or stale marking", async (t) => {
  const db = database(t);
  await assert.rejects(syncPaidConnection({ connection: db.connections[0], range: RANGE, limits: { maxRows: 1 }, client: client(async () => snapshot([metric, { ...metric, campaignExternalId: "other" }])) }), (error: unknown) => error instanceof PaidSyncStoppedError && error.code === "sync_limit_exceeded");
  assert.deepEqual(db.writes, []); assert.equal(db.connections[0].lastErrorCode, null);
});

test("metrics-only monitoring skips campaign and ad ingestion; manual defaults retain both", async (t) => {
  const db = database(t); const fake = client();
  fake.fetchCampaignsSnapshot = async () => { throw new Error("metrics-only must not call campaigns"); };
  fake.fetchAdsSnapshot = async () => { throw new Error("metrics-only must not call ads"); };
  const result = await syncPaidConnection({ connection: db.connections[0], range: RANGE, client: fake, metricsOnly: true });
  assert.equal(result.state, "succeeded"); assert.equal(result.phases.campaigns.state, "skipped"); assert.equal(result.phases.ads.state, "skipped");
  assert.deepEqual(db.writes, ["metrics", "metrics:stale"]);
  db.writes.length = 0;
  await syncPaidConnection({ connection: db.connections[0], range: RANGE, client: client() });
  assert.deepEqual(db.writes, ["metrics", "metrics:stale", "campaigns:stale", "ads:stale"]);
});

test("provider failures retain stored metadata and persistence errors remain visible", async (t) => {
  const db = database(t);
  const failure = async () => { throw new PaidProviderError("google_ads", "network", true); };
  await syncPaidConnection({ connection: db.connections[0], range: RANGE, client: { platform: "google_ads", fetchMetricsSnapshot: failure, fetchCampaignsSnapshot: failure, fetchAdsSnapshot: failure } });
  assert.equal(db.connections[0].currency, "EUR"); assert.equal(db.connections[0].timezone, "UTC"); assert.equal(db.attempts[0].status, "failed");
  db.failMetrics();
  await assert.rejects(syncPaidConnection({ connection: db.connections[0], range: RANGE, client: client() }), PaidSyncPersistenceError);
  assert.equal(db.connections[0].lastErrorCode, "persistence_unavailable");
});

test("busy background accounts defer without skipping later accounts; manual contention still throws", async (t) => {
  const db = database(t); db.connections.push(connection("second"));
  db.attempts.push({ id: "busy", workspaceId: "workspace", connectionId: "account", status: "running", startedAt: new Date() });
  const result = await syncPaidWorkspace({ workspaceId: "workspace", range: RANGE, skipBusy: true, clientFactory: () => client() });
  assert.deepEqual(result.deferredConnectionIds, ["account"]); assert.deepEqual(result.results.map((row) => row.connectionId), ["second"]);
  assert.equal(result.state, "partial");
  await assert.rejects(syncPaidWorkspace({ workspaceId: "workspace", range: RANGE, clientFactory: () => client() }), PaidSyncInProgressError);
});

function refreshFixture(t: TestContext, row: Connection) {
  const previous = { key: process.env.TOKEN_ENC_KEY, client: process.env.GOOGLE_OAUTH_CLIENT_ID, secret: process.env.GOOGLE_OAUTH_CLIENT_SECRET };
  process.env.TOKEN_ENC_KEY = Buffer.alloc(32, 9).toString("base64"); process.env.GOOGLE_OAUTH_CLIENT_ID = "test-client"; process.env.GOOGLE_OAUTH_CLIENT_SECRET = "test-secret";
  t.after(() => {
    for (const [key, value] of [["TOKEN_ENC_KEY", previous.key], ["GOOGLE_OAUTH_CLIENT_ID", previous.client], ["GOOGLE_OAUTH_CLIENT_SECRET", previous.secret]] as const) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  });
  row.encRefreshToken = encryptToken("old-refresh", tokenAad({ workspaceId: row.workspaceId, platform: row.platform, externalAccountId: row.externalAccountId, tokenKind: "refresh" }));
  row.expiresAt = new Date(0);
}

test("an in-flight old refresh cannot replace reconnected credentials or scopes", async (t) => {
  const db = database(t); refreshFixture(t, db.connections[0]); const captured = structuredClone(db.connections[0]);
  t.mock.method(globalThis, "fetch", async (_url: unknown, init: RequestInit) => {
    assert.ok(init.signal);
    Object.assign(db.connections[0], { encAccessToken: "replacement", encRefreshToken: "replacement-refresh", scopes: "replacement-scope" });
    return new Response(JSON.stringify({ access_token: "obsolete-refresh-result", expires_in: 3600, scope: "old-scope" }));
  });
  await assert.rejects(getConnectionAccessToken(captured, "google_ads"), ConnectionCredentialsChangedError);
  assert.equal(db.connections[0].encAccessToken, "replacement"); assert.equal(db.connections[0].scopes, "replacement-scope");
});

test("refresh receives cancellation and cannot persist after it", async (t) => {
  const db = database(t); refreshFixture(t, db.connections[0]); const controller = new AbortController();
  const captured = structuredClone(db.connections[0]);
  t.mock.method(globalThis, "fetch", async (_url: unknown, init: RequestInit) => {
    assert.ok(init.signal); controller.abort(new Error("cancel-refresh"));
    return new Response(JSON.stringify({ access_token: "must-not-store" }));
  });
  await assert.rejects(getConnectionAccessToken(captured, "google_ads", { signal: controller.signal }), /cancel-refresh/);
  assert.equal(db.connections[0].encAccessToken, captured.encAccessToken);
});

test("a sync advances its fence for its own refresh and commits with that generation", async (t) => {
  const db = database(t); refreshFixture(t, db.connections[0]);
  const oldDeveloperToken = process.env.GOOGLE_ADS_DEVELOPER_TOKEN;
  process.env.GOOGLE_ADS_DEVELOPER_TOKEN = "test-developer";
  t.after(() => { if (oldDeveloperToken === undefined) delete process.env.GOOGLE_ADS_DEVELOPER_TOKEN; else process.env.GOOGLE_ADS_DEVELOPER_TOKEN = oldDeveloperToken; });
  let refreshes = 0;
  t.mock.method(globalThis, "fetch", async (url: string, init: RequestInit) => {
    if (url.includes("oauth2.googleapis.com/token")) { refreshes++; assert.ok(init.signal); return new Response(JSON.stringify({ access_token: "fresh-token", expires_in: 3600 })); }
    assert.equal(new Headers(init.headers).get("authorization"), "Bearer fresh-token");
    const query = JSON.parse(String(init.body)).query as string;
    return new Response(JSON.stringify(query.includes("FROM customer")
      ? [{ results: [{ customer: { currencyCode: "EUR", timeZone: "UTC" } }] }]
      : [{ results: [{ campaign: { id: "campaign" }, metrics: { costMicros: "1000000" }, segments: { date: "2026-09-05" } }] }]));
  });
  const result = await syncPaidConnection({ connection: structuredClone(db.connections[0]), range: RANGE, metricsOnly: true });
  assert.equal(refreshes, 1); assert.equal(result.state, "succeeded"); assert.equal(db.connections[0].status, "connected"); assert.ok(db.writes.includes("metrics"));
});
