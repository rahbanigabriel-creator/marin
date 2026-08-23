import assert from "node:assert/strict";
import test from "node:test";

import {
  ConnectionNotFoundError,
  disconnectConnection,
  revokeProviderAccess,
  revokeWorkspaceProviderGrants,
  type DisconnectConnectionRecord,
  type DisconnectConnectionStore,
} from "../disconnect";
import { encryptToken, tokenAad } from "@/lib/security/vault";

const ACCESS_TOKEN = "access-token-must-stay-private";
const REFRESH_TOKEN = "refresh-token-must-stay-private";
const originalVaultKey = process.env.TOKEN_ENC_KEY;

process.env.TOKEN_ENC_KEY = Buffer.alloc(32, 7).toString("base64");

test.after(() => {
  if (originalVaultKey === undefined) delete process.env.TOKEN_ENC_KEY;
  else process.env.TOKEN_ENC_KEY = originalVaultKey;
});

function connection(platform: string, id = `${platform}-connection`): DisconnectConnectionRecord {
  const common = {
    workspaceId: "workspace-1",
    platform,
    externalAccountId: "account-123",
  };
  return {
    id,
    ...common,
    encAccessToken: encryptToken(
      ACCESS_TOKEN,
      tokenAad({ ...common, tokenKind: "access" }),
    ),
    encRefreshToken: encryptToken(
      REFRESH_TOKEN,
      tokenAad({ ...common, tokenKind: "refresh" }),
    ),
  };
}

async function withTikTokCredentials<T>(work: () => Promise<T>): Promise<T> {
  const previousAppId = process.env.TIKTOK_APP_ID;
  const previousAppSecret = process.env.TIKTOK_APP_SECRET;
  process.env.TIKTOK_APP_ID = "tiktok-app-id-private";
  process.env.TIKTOK_APP_SECRET = "tiktok-app-secret-private";
  try {
    return await work();
  } finally {
    if (previousAppId === undefined) delete process.env.TIKTOK_APP_ID;
    else process.env.TIKTOK_APP_ID = previousAppId;
    if (previousAppSecret === undefined) delete process.env.TIKTOK_APP_SECRET;
    else process.env.TIKTOK_APP_SECRET = previousAppSecret;
  }
}

function memoryStore(
  initial: DisconnectConnectionRecord,
  siblingGrantConnections = 0,
): DisconnectConnectionStore & {
  deletions: Array<{ workspaceId: string; connectionId: string }>;
} {
  let row: DisconnectConnectionRecord | null = initial;
  const deletions: Array<{ workspaceId: string; connectionId: string }> = [];
  return {
    deletions,
    async findOwnedConnection(workspaceId, connectionId) {
      return row?.workspaceId === workspaceId && row.id === connectionId ? row : null;
    },
    async countSiblingGrantConnections() {
      return siblingGrantConnections;
    },
    async deleteOwnedConnection(workspaceId, connectionId) {
      deletions.push({ workspaceId, connectionId });
      if (row?.workspaceId !== workspaceId || row.id !== connectionId) return false;
      row = null;
      return true;
    },
  };
}

test("Google-family revocation sends the refresh token in a form body, never the URL", async () => {
  const requests: Array<{ url: string; init?: RequestInit }> = [];
  const fetchMock = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    requests.push({ url, init });
    return new Response(JSON.stringify({ ignored: ACCESS_TOKEN }), { status: 200 });
  }) as typeof fetch;

  const status = await revokeProviderAccess(connection("ga4"), { fetchImpl: fetchMock });

  assert.equal(status, "confirmed");
  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, "https://oauth2.googleapis.com/revoke");
  assert.equal(requests[0].url.includes(ACCESS_TOKEN), false);
  assert.equal(requests[0].url.includes(REFRESH_TOKEN), false);
  assert.equal(requests[0].init?.method, "POST");
  assert.equal(
    new Headers(requests[0].init?.headers).get("content-type"),
    "application/x-www-form-urlencoded",
  );
  assert.equal(new URLSearchParams(String(requests[0].init?.body)).get("token"), REFRESH_TOKEN);
  assert.ok(requests[0].init?.signal instanceof AbortSignal);
});

test("Meta revocation uses a bearer header and the pinned permissions endpoint", async () => {
  let request: { url: string; init?: RequestInit } | undefined;
  const fetchMock = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    request = { url, init };
    return new Response(null, { status: 200 });
  }) as typeof fetch;

  const status = await revokeProviderAccess(connection("meta_ads"), { fetchImpl: fetchMock });

  assert.equal(status, "confirmed");
  assert.match(request?.url ?? "", /^https:\/\/graph\.facebook\.com\/v\d+\.\d+\/me\/permissions$/);
  assert.equal(request?.url.includes(ACCESS_TOKEN), false);
  assert.equal(request?.init?.method, "DELETE");
  assert.equal(new Headers(request?.init?.headers).get("authorization"), `Bearer ${ACCESS_TOKEN}`);
  assert.equal(request?.init?.body, undefined);
});

test("workspace deletion revokes one distinct grant for Google, Meta, and TikTok", async () => {
  const calls: string[] = [];
  const fetchMock = (async (input: string | URL | Request) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    calls.push(url);
    return url.includes("/oauth2/revoke_token/")
      ? new Response(JSON.stringify({ code: 0 }), { status: 200 })
      : new Response(null, { status: 200 });
  }) as typeof fetch;

  const outcomes = await withTikTokCredentials(() =>
    revokeWorkspaceProviderGrants(
      [
        connection("ga4", "ga4-one"),
        connection("search_console", "search-one"),
        connection("google_ads", "ads-one"),
        connection("meta_ads", "meta-one"),
        connection("tiktok_ads", "tiktok-one"),
      ],
      { fetchImpl: fetchMock },
    ),
  );

  assert.deepEqual(outcomes, [
    { provider: "google", status: "confirmed" },
    { provider: "meta", status: "confirmed" },
    { provider: "tiktok", status: "confirmed" },
  ]);
  assert.equal(calls.length, 3);
  assert.equal(calls.filter((url) => url.includes("oauth2.googleapis.com/revoke")).length, 1);
  assert.equal(calls.filter((url) => url.includes("/me/permissions")).length, 1);
  assert.equal(calls.filter((url) => url.includes("/oauth2/revoke_token/")).length, 1);
});

test("TikTok revocation uses the configured app credentials in a JSON body", async () => {
  let request: { url: string; init?: RequestInit } | undefined;
  const fetchMock = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    request = { url, init };
    return new Response(JSON.stringify({ code: 0, message: "OK" }), { status: 200 });
  }) as typeof fetch;

  const status = await withTikTokCredentials(() =>
    revokeProviderAccess(connection("tiktok_ads"), { fetchImpl: fetchMock }),
  );

  assert.equal(status, "confirmed");
  assert.equal(request?.url, "https://business-api.tiktok.com/open_api/v1.3/oauth2/revoke_token/");
  assert.equal(request?.url.includes(ACCESS_TOKEN), false);
  assert.equal(request?.init?.method, "POST");
  assert.equal(new Headers(request?.init?.headers).get("content-type"), "application/json");
  assert.deepEqual(JSON.parse(String(request?.init?.body)), {
    app_id: "tiktok-app-id-private",
    secret: "tiktok-app-secret-private",
    access_token: ACCESS_TOKEN,
  });
});

test("TikTok revocation only confirms TikTok's successful response code", async () => {
  const fetchMock = (async () => new Response(
    JSON.stringify({ code: 40100, message: `invalid ${ACCESS_TOKEN}` }),
    { status: 200 },
  )) as typeof fetch;

  const status = await withTikTokCredentials(() =>
    revokeProviderAccess(connection("tiktok_ads"), { fetchImpl: fetchMock }),
  );

  assert.equal(status, "failed");
  assert.equal(JSON.stringify(status).includes(ACCESS_TOKEN), false);
});

test("provider bodies, token-bearing errors, and tokens never reach a failure result", async () => {
  const store = memoryStore(connection("meta_ads"));
  const fetchMock = (async () => {
    assert.equal(store.deletions.length, 0, "provider revocation must run while the token is recoverable");
    throw new Error(`provider rejected ${ACCESS_TOKEN} with ${REFRESH_TOKEN}`);
  }) as typeof fetch;

  const result = await disconnectConnection({
    workspaceId: "workspace-1",
    connectionId: "meta_ads-connection",
    store,
    fetchImpl: fetchMock,
  });

  const serialized = JSON.stringify(result);
  assert.equal(result.providerRevocation, "failed");
  assert.equal(result.disconnected, true);
  assert.equal(serialized.includes(ACCESS_TOKEN), false);
  assert.equal(serialized.includes(REFRESH_TOKEN), false);
  assert.equal(serialized.includes("provider rejected"), false);
  assert.deepEqual(store.deletions, [
    { workspaceId: "workspace-1", connectionId: "meta_ads-connection" },
  ]);
});

test("a sibling Google account retains the shared grant and receives no revocation call", async () => {
  const store = memoryStore(connection("ga4"), 1);
  let called = false;
  const fetchMock = (async () => {
    called = true;
    return new Response(null, { status: 200 });
  }) as typeof fetch;

  const result = await disconnectConnection({
    workspaceId: "workspace-1",
    connectionId: "ga4-connection",
    store,
    fetchImpl: fetchMock,
  });

  assert.equal(result.providerRevocation, "retained");
  assert.match(result.message, /another account/i);
  assert.equal(called, false);
  assert.equal(store.deletions.length, 1);
});

test("a sibling Meta account retains the shared grant and receives no revocation call", async () => {
  const store = memoryStore(connection("meta_ads"), 2);
  let called = false;
  const fetchMock = (async () => {
    called = true;
    return new Response(null, { status: 200 });
  }) as typeof fetch;

  const result = await disconnectConnection({
    workspaceId: "workspace-1",
    connectionId: "meta_ads-connection",
    store,
    fetchImpl: fetchMock,
  });

  assert.equal(result.providerRevocation, "retained");
  assert.equal(called, false);
  assert.equal(store.deletions.length, 1);
});

test("a sibling TikTok account retains the shared grant and receives no revocation call", async () => {
  const store = memoryStore(connection("tiktok_ads"), 1);
  let called = false;
  const fetchMock = (async () => {
    called = true;
    return new Response(null, { status: 200 });
  }) as typeof fetch;

  const result = await disconnectConnection({
    workspaceId: "workspace-1",
    connectionId: "tiktok_ads-connection",
    store,
    fetchImpl: fetchMock,
  });

  assert.equal(result.providerRevocation, "retained");
  assert.equal(called, false);
  assert.equal(store.deletions.length, 1);
});

test("a non-success provider response is sanitized and still deletes locally", async () => {
  const store = memoryStore(connection("google_ads"));
  const fetchMock = (async () => new Response(
    JSON.stringify({ error: `raw provider payload ${ACCESS_TOKEN}` }),
    { status: 503 },
  )) as typeof fetch;

  const result = await disconnectConnection({
    workspaceId: "workspace-1",
    connectionId: "google_ads-connection",
    store,
    fetchImpl: fetchMock,
  });

  assert.equal(result.providerRevocation, "failed");
  assert.match(result.message, /provider settings/i);
  assert.equal(JSON.stringify(result).includes("raw provider payload"), false);
  assert.equal(store.deletions.length, 1);
});

test("unsupported providers report unavailable without sending or decrypting a token", async () => {
  const unsupported: DisconnectConnectionRecord = {
    ...connection("linkedin_ads"),
    encAccessToken: "not-valid-ciphertext",
    encRefreshToken: null,
  };
  let called = false;
  const fetchMock = (async () => {
    called = true;
    return new Response(null, { status: 200 });
  }) as typeof fetch;

  assert.equal(
    await revokeProviderAccess(unsupported, { fetchImpl: fetchMock }),
    "unavailable",
  );
  assert.equal(called, false);
});

test("TikTok reports unavailable for manual revocation when app credentials are absent", async () => {
  const previousAppId = process.env.TIKTOK_APP_ID;
  const previousAppSecret = process.env.TIKTOK_APP_SECRET;
  delete process.env.TIKTOK_APP_ID;
  delete process.env.TIKTOK_APP_SECRET;
  try {
    const unsupported: DisconnectConnectionRecord = {
      ...connection("tiktok_ads"),
      encAccessToken: "not-valid-ciphertext",
      encRefreshToken: null,
    };
    let called = false;
    const fetchMock = (async () => {
      called = true;
      return new Response(null, { status: 200 });
    }) as typeof fetch;

    assert.equal(await revokeProviderAccess(unsupported, { fetchImpl: fetchMock }), "unavailable");
    assert.equal(called, false);
  } finally {
    if (previousAppId === undefined) delete process.env.TIKTOK_APP_ID;
    else process.env.TIKTOK_APP_ID = previousAppId;
    if (previousAppSecret === undefined) delete process.env.TIKTOK_APP_SECRET;
    else process.env.TIKTOK_APP_SECRET = previousAppSecret;
  }
});

test("provider timeout is bounded and local deletion still completes", async () => {
  const store = memoryStore(connection("meta_ads"));
  const fetchMock = (() => new Promise<Response>(() => undefined)) as typeof fetch;
  const started = Date.now();

  const result = await disconnectConnection({
    workspaceId: "workspace-1",
    connectionId: "meta_ads-connection",
    store,
    fetchImpl: fetchMock,
    timeoutMs: 10,
  });

  assert.equal(result.providerRevocation, "failed");
  assert.ok(Date.now() - started < 1_000);
  assert.equal(store.deletions.length, 1);
});

test("tenant-scoped lookup makes missing and cross-tenant connections indistinguishable", async () => {
  const crossTenantStore = memoryStore(connection("ga4"));
  await assert.rejects(
    () => disconnectConnection({
      workspaceId: "workspace-2",
      connectionId: "ga4-connection",
      store: crossTenantStore,
    }),
    ConnectionNotFoundError,
  );
  assert.equal(crossTenantStore.deletions.length, 0);

  const missingStore = memoryStore(connection("ga4"));
  await assert.rejects(
    () => disconnectConnection({
      workspaceId: "workspace-1",
      connectionId: "missing-connection",
      store: missingStore,
    }),
    ConnectionNotFoundError,
  );
  assert.equal(missingStore.deletions.length, 0);
});

test("repeat deletion returns the same not-found error and never deletes twice", async () => {
  const store = memoryStore(connection("linkedin_ads"));
  const first = await disconnectConnection({
    workspaceId: "workspace-1",
    connectionId: "linkedin_ads-connection",
    store,
  });
  assert.equal(first.providerRevocation, "unavailable");

  await assert.rejects(
    () => disconnectConnection({
      workspaceId: "workspace-1",
      connectionId: "linkedin_ads-connection",
      store,
    }),
    ConnectionNotFoundError,
  );
  assert.equal(store.deletions.length, 1);
});
