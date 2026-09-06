import assert from "node:assert/strict";
import test from "node:test";
import type { Connection } from "@prisma/client";
import { createPaidReadClient, PaidSyncStoppedError } from "../paid-clients";
import { refreshAccessToken } from "../oauth";
import { META_GRAPH_VERSION } from "../registry";

const account = { id: "account", workspaceId: "workspace", externalAccountId: "123", platform: "meta_ads" } as Connection;
const range = { from: new Date("2026-09-05"), to: new Date("2026-09-05") };
const token = async () => "test-token";
const json = (value: unknown) => new Response(JSON.stringify(value));
const limited = (error: unknown) => error instanceof PaidSyncStoppedError && error.code === "sync_limit_exceeded";

test("response byte limits reject declared and streamed oversized bodies before JSON parsing", async () => {
  for (const declared of [false, true]) {
    let cancelled = 0;
    const fetchMock = (async () => new Response(new ReadableStream<Uint8Array>({
      pull(controller) { controller.enqueue(new Uint8Array(65)); },
      cancel() { cancelled++; },
    }), { headers: declared ? { "content-length": "1000000" } : {} })) as typeof fetch;
    const client = createPaidReadClient("meta_ads", fetchMock, token, { limits: { maxResponseBytes: 64 } });
    await assert.rejects(client.fetchMetricsSnapshot(account, range), limited);
    assert.ok(cancelled > 0);
  }
});

test("total response bytes are shared across concurrent reporting requests", async () => {
  const fetchMock = (async () => json({ padding: "x".repeat(40) })) as typeof fetch;
  const client = createPaidReadClient("meta_ads", fetchMock, token, { limits: { maxResponseBytes: 100, maxTotalResponseBytes: 60 } });
  await assert.rejects(client.fetchMetricsSnapshot(account, range), limited);
});

test("a spent request budget makes no additional provider call", async () => {
  let calls = 0;
  const fetchMock = (async () => { calls++; return json({ data: [], currency: "EUR", timezone_name: "UTC" }); }) as typeof fetch;
  const client = createPaidReadClient("meta_ads", fetchMock, token, { limits: { maxRequests: 1 } });
  await assert.rejects(client.fetchMetricsSnapshot(account, range), limited);
  assert.equal(calls, 1);
});

test("Meta row cap spans pages before the next page can be scheduled", async () => {
  const pages: string[] = [];
  const fetchMock = (async (request: string | URL | Request) => {
    const url = String(request);
    if (!url.includes("/insights")) return json({ currency: "EUR", timezone_name: "UTC" });
    pages.push(url);
    return json({ data: [{ campaign_id: "campaign", date_start: "2026-09-05", clicks: "1" }], paging: { next: `https://graph.facebook.com/${META_GRAPH_VERSION}/act_123/insights?page=${pages.length + 1}` } });
  }) as typeof fetch;
  const client = createPaidReadClient("meta_ads", fetchMock, token, { limits: { maxRows: 1 } });
  await assert.rejects(client.fetchMetricsSnapshot(account, range), limited);
  assert.equal(pages.length, 2);
});

test("normalized metric expansion is bounded separately from raw campaign rows", async () => {
  const fetchMock = (async (request: string | URL | Request) => String(request).includes("/insights")
    ? json({ data: [{ campaign_id: "campaign", date_start: "2026-09-05", spend: "1", clicks: "1", impressions: "2" }] })
    : json({ currency: "EUR", timezone_name: "UTC" })) as typeof fetch;
  await assert.rejects(createPaidReadClient("meta_ads", fetchMock, token, { limits: { maxRows: 2 } }).fetchMetricsSnapshot(account, range), limited);
});

test("Google search streams enforce a raw-row cap before normalization", async (t) => {
  const previous = process.env.GOOGLE_ADS_DEVELOPER_TOKEN;
  process.env.GOOGLE_ADS_DEVELOPER_TOKEN = "test-token";
  t.after(() => { if (previous === undefined) delete process.env.GOOGLE_ADS_DEVELOPER_TOKEN; else process.env.GOOGLE_ADS_DEVELOPER_TOKEN = previous; });
  const fetchMock = (async (_request: unknown, init?: RequestInit) => {
    const query = JSON.parse(String(init?.body)).query as string;
    return json(query.includes("FROM customer") ? [{ results: [{ customer: { currencyCode: "EUR", timeZone: "UTC" } }] }] : [{ results: [{}, {}] }]);
  }) as typeof fetch;
  await assert.rejects(createPaidReadClient("google_ads", fetchMock, token, { limits: { maxRows: 1 } }).fetchMetricsSnapshot({ ...account, platform: "google_ads" }, range), limited);
});

test("cancellation closes a stalled response stream even when the transport ignores the signal", async () => {
  const controller = new AbortController(); let cancelled = 0;
  const fetchMock = (async () => new Response(new ReadableStream<Uint8Array>({
    start() { setTimeout(() => controller.abort(new Error("stopped")), 5); },
    cancel() { cancelled++; },
  }))) as typeof fetch;
  await assert.rejects(createPaidReadClient("meta_ads", fetchMock, token, { signal: controller.signal }).fetchMetricsSnapshot(account, range));
  assert.ok(cancelled > 0);
});

test("refresh aborts a stalled fetch and has a finite default timeout", async (t) => {
  const controller = new AbortController(); let timeout: number | undefined;
  const originalTimeout = AbortSignal.timeout;
  t.mock.method(AbortSignal, "timeout", (milliseconds: number) => { timeout = milliseconds; return originalTimeout(10); });
  const keepAlive = setTimeout(() => undefined, 1000); t.after(() => clearTimeout(keepAlive));
  await assert.rejects(refreshAccessToken({
    tokenUrl: "https://example.invalid/token", clientId: "test", clientSecret: "test", refreshToken: "test", signal: controller.signal,
    fetchImpl: (async (_url: unknown, init?: RequestInit) => { assert.ok(init?.signal); return new Promise<Response>(() => undefined); }) as typeof fetch,
  }), (error: unknown) => error instanceof Error && error.name === "TimeoutError");
  assert.equal(timeout, 20_000);
});

test("refresh bounds the token response body and never surfaces its contents", async () => {
  await assert.rejects(refreshAccessToken({
    tokenUrl: "https://example.invalid/token", clientId: "test", clientSecret: "test", refreshToken: "test",
    fetchImpl: (async () => new Response("secret".repeat(12000))) as typeof fetch,
  }), (error: unknown) => error instanceof Error && !error.message.includes("secret"));
});
