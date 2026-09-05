import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import test from "node:test";

import type { Connection } from "@prisma/client";

import { getMetaPublishingAccess } from "../meta-publishing-access";
import type { ConnectionTokenProvider } from "../paid-clients";
import { PaidProviderError, type PaidProviderErrorCode } from "../paid-errors";
import { META_GRAPH_VERSION } from "../registry";

function connection(overrides: Partial<Connection> = {}): Connection {
  return {
    id: "connection-meta", workspaceId: "workspace-test", platform: "meta_ads",
    externalAccountId: "123", displayName: "Test account", status: "connected",
    scopes: null, encAccessToken: "encrypted", encRefreshToken: null, expiresAt: null,
    currency: null, timezone: null, lastSyncAt: null, lastSuccessfulSyncAt: null,
    lastErrorCode: null, lastErrorMessage: null, createdAt: new Date(), updatedAt: new Date(),
    ...overrides,
  };
}

const TEST_TOKEN = "fixture-user-token";
const tokenProvider: ConnectionTokenProvider = async () => TEST_TOKEN;
const permissionNames = ["ads_management", "pages_show_list", "pages_read_engagement"];
const permissions = () => ({ data: permissionNames.map((permission) => ({ permission, status: "granted" })) });
const account = () => ({
  id: "act_123", account_id: "123", account_status: 1, currency: "EUR",
  timezone_name: "Europe/Madrid", user_tasks: ["ADVERTISE", "ANALYZE"],
});
const pages = () => ({ data: [{ id: "456", name: "Fitura", tasks: ["ADVERTISE"] }] });

function json(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json" } });
}

function mockFetch(responses: unknown[]) {
  const calls: { url: URL; init: RequestInit | undefined }[] = [];
  const fetchImpl = (async (request: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: new URL(request instanceof Request ? request.url : request), init });
    assert.ok(calls.length <= responses.length, "Unexpected extra request");
    const response = responses[calls.length - 1];
    return response instanceof Response ? response : json(response);
  }) as typeof fetch;
  return { calls, fetchImpl };
}

async function fails(responses: unknown[], code: PaidProviderErrorCode = "invalid_response", overrides: Partial<Connection> = {}) {
  const mock = mockFetch(responses);
  await assert.rejects(getMetaPublishingAccess(connection(overrides), mock.fetchImpl, tokenProvider), (error: unknown) => {
    assert.ok(error instanceof PaidProviderError);
    assert.equal(error.platform, "meta_ads");
    assert.equal(error.code, code);
    assert.equal(error.cause, undefined);
    assert.ok(!JSON.stringify(error).includes(TEST_TOKEN));
    assert.ok(!error.message.includes("private-provider-detail"));
    return true;
  });
  return mock.calls;
}

test("Meta publishing access is a sanitized live read, independent of stored scopes and metadata", async () => {
  const originalSecret = process.env.META_APP_SECRET;
  process.env.META_APP_SECRET = "fixture-app-secret";
  try {
    const mock = mockFetch([
      permissions(), account(),
      { data: [{ ...pages().data[0], access_token: "never-return-page-token", unrelated: "discard" }] },
    ]);
    let received: Connection | undefined;
    const input = connection({ externalAccountId: "act_123", currency: "USD", timezone: "UTC", scopes: null });
    const access = await getMetaPublishingAccess(input, mock.fetchImpl, async (current, platform) => {
      received = current;
      assert.equal(platform, "meta_ads");
      return TEST_TOKEN;
    });
    assert.equal(received, input);
    assert.deepEqual(access, {
      accountId: "123", currency: "EUR", timezone: "Europe/Madrid", canAdvertise: true,
      permissions: { adsManagement: true, pagesShowList: true, pagesReadEngagement: true },
      pages: [{ id: "456", name: "Fitura", canAdvertise: true }], pagesComplete: true,
    });
    assert.equal(mock.calls.length, 3);
    assert.deepEqual(mock.calls.map(({ url }) => url.pathname), [
      `/${META_GRAPH_VERSION}/me/permissions`, `/${META_GRAPH_VERSION}/act_123`, `/${META_GRAPH_VERSION}/me/accounts`,
    ]);
    assert.equal(mock.calls[0].url.searchParams.get("fields"), "permission,status");
    assert.equal(mock.calls[1].url.searchParams.get("fields"), "id,account_id,account_status,currency,timezone_name,user_tasks");
    assert.equal(mock.calls[2].url.searchParams.get("fields"), "id,name,tasks");
    for (const { url, init } of mock.calls) {
      assert.equal(url.origin, "https://graph.facebook.com");
      assert.equal(url.searchParams.has("access_token"), false);
      assert.equal(url.searchParams.get("appsecret_proof"), createHmac("sha256", "fixture-app-secret").update(TEST_TOKEN).digest("hex"));
      assert.equal(new Headers(init?.headers).get("Authorization"), `Bearer ${TEST_TOKEN}`);
      assert.equal(init?.method, "GET");
      assert.equal(init?.body, undefined);
      assert.equal(init?.cache, "no-store");
      assert.equal(init?.redirect, "error");
      assert.ok(init?.signal instanceof AbortSignal);
    }
  } finally {
    if (originalSecret === undefined) delete process.env.META_APP_SECRET;
    else process.env.META_APP_SECRET = originalSecret;
  }
});

test("missing live grants never fall back to locally stored publishing scopes", async () => {
  const mock = mockFetch([{ data: [] }, account()]);
  const access = await getMetaPublishingAccess(connection({ scopes: permissionNames.join(" ") }), mock.fetchImpl, tokenProvider);
  assert.equal(access.canAdvertise, false);
  assert.deepEqual(access.permissions, { adsManagement: false, pagesShowList: false, pagesReadEngagement: false });
  assert.deepEqual(access.pages, []);
  assert.equal(access.pagesComplete, false);
  assert.equal(mock.calls.length, 2);
});

for (const status of ["declined", "expired"]) {
  test(`live ${status} ads_management disables account and Page advertising`, async () => {
    const grants = permissions();
    grants.data[0].status = status;
    const mock = mockFetch([grants, account(), pages()]);
    const access = await getMetaPublishingAccess(connection({ scopes: "ads_management" }), mock.fetchImpl, tokenProvider);
    assert.equal(access.permissions.adsManagement, false);
    assert.equal(access.canAdvertise, false);
    assert.equal(access.pages[0].canAdvertise, false);
  });
}

test("missing engagement permission leaves Page advertising unavailable", async () => {
  const grants = permissions();
  grants.data.pop();
  const mock = mockFetch([grants, account(), pages()]);
  const access = await getMetaPublishingAccess(connection(), mock.fetchImpl, tokenProvider);
  assert.equal(access.permissions.pagesReadEngagement, false);
  assert.equal(access.pages[0].canAdvertise, false);
  assert.equal(access.pagesComplete, true);
});

test("revoked Page-list permission skips enumeration and an actually empty list is complete", async () => {
  const grants = permissions();
  grants.data[1].status = "declined";
  const skipped = mockFetch([grants, account()]);
  const unavailable = await getMetaPublishingAccess(connection(), skipped.fetchImpl, tokenProvider);
  assert.equal(unavailable.permissions.pagesShowList, false);
  assert.equal(unavailable.pagesComplete, false);
  assert.deepEqual(unavailable.pages, []);
  assert.equal(skipped.calls.length, 2);
  const empty = mockFetch([permissions(), account(), { data: [] }]);
  const available = await getMetaPublishingAccess(connection(), empty.fetchImpl, tokenProvider);
  assert.deepEqual(available.pages, []);
  assert.equal(available.pagesComplete, true);
});

test("disabled accounts and analyze/manage-only tasks are not assumed to allow advertising", async () => {
  for (const metadata of [
    { ...account(), account_status: 2 }, { ...account(), account_status: 101 },
    { ...account(), user_tasks: ["ANALYZE"] }, { ...account(), user_tasks: ["MANAGE"] },
  ]) {
    const mock = mockFetch([permissions(), metadata, { data: [{ id: "456", name: "Read only", tasks: ["ANALYZE", "MANAGE"] }] }]);
    const access = await getMetaPublishingAccess(connection(), mock.fetchImpl, tokenProvider);
    assert.equal(access.canAdvertise, false);
    assert.equal(access.pages[0].canAdvertise, false);
  }
});

test("wrong platform, revoked connection and invalid account IDs fail before reading tokens or making requests", async () => {
  for (const [overrides, code] of [
    [{ platform: "google_ads" }, "not_supported"], [{ status: "revoked" }, "authentication"],
    [{ status: "error" }, "authentication"], [{ externalAccountId: "123/ads" }, "invalid_response"],
    [{ externalAccountId: "act_123?fields=access_token" }, "invalid_response"],
  ] as const) {
    assert.equal((await fails([], code, overrides)).length, 0);
  }
});

test("exact ad account binding rejects ID mismatches without enumerating Pages", async () => {
  for (const metadata of [{ ...account(), id: "act_999" }, { ...account(), account_id: "999" }]) {
    assert.equal((await fails([permissions(), metadata])).length, 2);
  }
});

test("malformed permissions, account metadata and Pages fail closed", async () => {
  for (const grants of [null, [], {}, { data: [null] }, { data: [{ permission: "ads_management", status: true }] },
    { data: [{ permission: "ads_management", status: ["granted"] }] },
    { data: [{ permission: "ads_management", status: "unknown" }] },
    { data: [permissions().data[0], permissions().data[0]] },
  ]) await fails([grants]);
  for (const metadata of [
    { ...account(), account_status: "1" }, { ...account(), currency: null },
    { ...account(), timezone_name: "Not/A_timezone" }, { ...account(), user_tasks: undefined },
    { ...account(), user_tasks: [true] }, { ...account(), id: 123 },
  ]) await fails([permissions(), metadata]);
  for (const pageList of [
    { data: [{}] }, { data: [{ ...pages().data[0], id: 456 }] },
    { data: [{ ...pages().data[0], name: "" }] }, { data: [{ ...pages().data[0], tasks: null }] },
    { data: [pages().data[0], pages().data[0]] },
  ]) await fails([permissions(), account(), pageList]);
});

test("Meta auth/permission/rate-limit errors and failed requests are sanitized without retry", async () => {
  for (const [providerCode, errorCode] of [[190, "authentication"], [102, "authentication"], [10, "permission"], [200, "permission"], [4, "rate_limit"]] as const) {
    const calls = await fails([json({ error: { code: providerCode, message: `private-provider-detail ${TEST_TOKEN}` } }, 400)], errorCode);
    assert.equal(calls.length, 1);
  }
  await fails([json({ error: { code: 190 } })], "authentication");
  await fails([permissions(), account(), json({ error: { code: 200 } }, 403)], "permission");
  for (const [status, code] of [[401, "authentication"], [403, "permission"], [429, "rate_limit"], [503, "provider"]] as const) {
    await fails([new Response("private-provider-detail", { status })], code);
  }
  await fails([new Response("not JSON")]);
  await fails([new Response("a".repeat(256 * 1024 + 1))]);
  let attempts = 0;
  await assert.rejects(getMetaPublishingAccess(connection(), async () => {
    attempts += 1;
    throw new Error(`private-provider-detail ${TEST_TOKEN}`);
  }, tokenProvider), (error: unknown) => error instanceof PaidProviderError && error.code === "network" && !error.message.includes(TEST_TOKEN));
  assert.equal(attempts, 1);
});

test("token provider failures and invalid tokens are sanitized before network access", async () => {
  const mock = mockFetch([]);
  for (const provider of [async () => { throw new Error(TEST_TOKEN); }, async () => "", async () => "bad\r\nheader"]) {
    await assert.rejects(getMetaPublishingAccess(connection(), mock.fetchImpl, provider),
      (error: unknown) => error instanceof PaidProviderError && error.code === "authentication" && !error.message.includes(TEST_TOKEN));
  }
  assert.equal(mock.calls.length, 0);
});

function paginated(edge: string, after: string, data: unknown[]) {
  return { data, paging: { next: `https://graph.facebook.com/${META_GRAPH_VERSION}/me/${edge}?after=${after}` } };
}

test("pagination rebuilds fixed read endpoints, discarding provider tokens, fields and URL paths", async () => {
  const first = paginated("permissions", "permission2", [permissions().data[0]]);
  const page1 = paginated("accounts", "page2", pages().data);
  page1.paging.next = `https://graph.facebook.com/${META_GRAPH_VERSION}/789/accounts?after=page2&access_token=never-forward&appsecret_proof=never-forward&fields=access_token&limit=5000`;
  const mock = mockFetch([first, { data: permissions().data.slice(1) }, account(), page1, { data: [{ id: "457", name: "Second", tasks: [] }] }]);
  const access = await getMetaPublishingAccess(connection(), mock.fetchImpl, tokenProvider);
  assert.equal(access.pagesComplete, true);
  assert.equal(access.pages.length, 2);
  assert.equal(access.pages[1].canAdvertise, false);
  const last = mock.calls.at(-1)!.url;
  assert.equal(last.pathname, `/${META_GRAPH_VERSION}/me/accounts`);
  assert.equal(last.searchParams.get("fields"), "id,name,tasks");
  assert.equal(last.searchParams.get("limit"), "100");
  assert.equal(last.searchParams.get("after"), "page2");
  assert.ok(!last.toString().includes("never-forward"));
});

test("unsafe pagination origins, edges and cursors are rejected before another request", async () => {
  const base = `https://graph.facebook.com/${META_GRAPH_VERSION}/me/accounts`;
  for (const next of [
    "https://evil.example/accounts?after=a", `${base.replace("https:", "http:")}?after=a`,
    `${base.replace("graph.facebook.com", "graph.facebook.com.evil.example")}?after=a`,
    `${base.replace("graph.facebook.com", "user:pass@graph.facebook.com")}?after=a`,
    `${base.replace("graph.facebook.com", "graph.facebook.com:444")}?after=a`,
    `${base.replace("accounts", "permissions")}?after=a`, `${base.replace(META_GRAPH_VERSION, "v1.0")}?after=a`,
    `${base}?after=a#fragment`, `${base}?after=a&after=b`, `${base}?after=`, `${base}?after=a%0Ab`,
    `${base}?after=${"a".repeat(4099)}`, `${base}?before=a`, "not a URL", "",
  ]) {
    const calls = await fails([permissions(), account(), { data: [], paging: { next } }]);
    assert.equal(calls.length, 3);
  }
  await fails([permissions(), account(), { data: [], paging: { next: `${base}?after=a`, cursors: { after: "b" } } }]);
});

test("repeated cursors and duplicate Page IDs across pages are rejected", async () => {
  const repeated = paginated("accounts", "same", []);
  const calls = await fails([permissions(), account(), repeated, repeated], "pagination_incomplete");
  assert.equal(calls.length, 4);
  await fails([permissions(), account(), paginated("accounts", "next", pages().data), pages()]);
});

test("Page enumeration is capped at five pages and reports an incomplete result", async () => {
  const pageResponses = Array.from({ length: 5 }, (_, index) => paginated("accounts", `next${index}`, [
    { id: String(500 + index), name: `Page ${index}`, tasks: ["ADVERTISE"] },
  ]));
  const mock = mockFetch([permissions(), account(), ...pageResponses]);
  const access = await getMetaPublishingAccess(connection(), mock.fetchImpl, tokenProvider);
  assert.equal(access.pagesComplete, false);
  assert.equal(access.pages.length, 5);
  assert.equal(mock.calls.length, 7);
});

test("a capped permission list cannot be used to infer readiness", async () => {
  const calls = await fails(Array.from({ length: 3 }, (_, index) => paginated("permissions", `next${index}`, [])), "pagination_incomplete");
  assert.equal(calls.length, 3);
  await fails([{ data: Array.from({ length: 101 }, () => permissions().data[0]) }]);
});

test("the overall deadline bounds a stalled token provider", async (context) => {
  context.mock.timers.enable({ apis: ["setTimeout"] });
  const mock = mockFetch([]);
  const pending = getMetaPublishingAccess(connection(), mock.fetchImpl, () => new Promise(() => {}));
  const check = assert.rejects(pending, (error: unknown) => error instanceof PaidProviderError && error.code === "network");
  context.mock.timers.tick(20_001);
  await check;
  assert.equal(mock.calls.length, 0);
});

test("the deadline aborts requests even if a fetch implementation ignores cancellation", async (context) => {
  context.mock.timers.enable({ apis: ["setTimeout"] });
  let signal: AbortSignal | undefined;
  let started!: () => void;
  const requestStarted = new Promise<void>((resolve) => { started = resolve; });
  const pending = getMetaPublishingAccess(connection(), async (_request, init) => {
    signal = init?.signal ?? undefined;
    started();
    return new Promise(() => {});
  }, tokenProvider);
  const check = assert.rejects(pending, (error: unknown) => error instanceof PaidProviderError && error.code === "network");
  await requestStarted;
  context.mock.timers.tick(20_001);
  await check;
  assert.equal(signal?.aborted, true);
});

test("the deadline also bounds a stalled response body, not just response headers", async (context) => {
  context.mock.timers.enable({ apis: ["setTimeout"] });
  let signal: AbortSignal | undefined;
  let started!: () => void;
  const requestStarted = new Promise<void>((resolve) => { started = resolve; });
  let bodyController!: ReadableStreamDefaultController<Uint8Array>;
  const body = new ReadableStream<Uint8Array>({ start(controller) { bodyController = controller; } });
  const pending = getMetaPublishingAccess(connection(), async (_request, init) => {
    signal = init?.signal ?? undefined;
    started();
    return new Response(body);
  }, tokenProvider);
  const check = assert.rejects(pending, (error: unknown) => error instanceof PaidProviderError && error.code === "network");
  await requestStarted;
  context.mock.timers.tick(20_001);
  await check;
  assert.equal(signal?.aborted, true);
  bodyController.close();
});
