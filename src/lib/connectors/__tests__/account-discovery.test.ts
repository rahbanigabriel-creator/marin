import assert from "node:assert/strict";
import test from "node:test";

import { listOAuthAccounts } from "../clients";
import { ConnectorNotReadyError } from "../types";
import { GOOGLE_ADS_API_VERSION, META_GRAPH_VERSION } from "../registry";

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const originalDeveloperToken = process.env.GOOGLE_ADS_DEVELOPER_TOKEN;
const originalLoginCustomer = process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID;
const originalMetaSecret = process.env.META_APP_SECRET;

test.before(() => {
  process.env.GOOGLE_ADS_DEVELOPER_TOKEN = "developer-token";
  process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID = "999-999-9999";
  process.env.META_APP_SECRET = "meta-app-secret";
});

test.after(() => {
  if (originalDeveloperToken === undefined) delete process.env.GOOGLE_ADS_DEVELOPER_TOKEN;
  else process.env.GOOGLE_ADS_DEVELOPER_TOKEN = originalDeveloperToken;
  if (originalLoginCustomer === undefined) delete process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID;
  else process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID = originalLoginCustomer;
  if (originalMetaSecret === undefined) delete process.env.META_APP_SECRET;
  else process.env.META_APP_SECRET = originalMetaSecret;
});

test("Google account discovery uses the current API and excludes manager-only choices", async () => {
  const requests: Array<{ url: string; headers: Headers }> = [];
  const fetchMock = (async (request: string | URL | Request, init?: RequestInit) => {
    const url = typeof request === "string" ? request : request instanceof URL ? request.toString() : request.url;
    const headers = new Headers(init?.headers);
    requests.push({ url, headers });
    if (url.endsWith("customers:listAccessibleCustomers")) {
      return json({ resourceNames: ["customers/1111111111", "customers/2222222222"] });
    }
    const customerId = /customers\/(\d+)\//.exec(url)?.[1];
    return json([{
      results: [{
        customer: {
          id: customerId,
          descriptiveName: customerId === "1111111111" ? "Marpin Manager" : "Fitura",
          manager: customerId === "1111111111",
        },
      }],
    }]);
  }) as typeof fetch;

  const accounts = await listOAuthAccounts("google_ads", "google-access-token", fetchMock);
  assert.deepEqual(accounts, [{ externalAccountId: "2222222222", displayName: "Fitura" }]);
  assert.ok(requests.every((request) => request.url.includes(`/${GOOGLE_ADS_API_VERSION}/`)));
  assert.ok(requests.every((request) => request.headers.get("developer-token") === "developer-token"));
  assert.ok(requests.every((request) => request.headers.get("login-customer-id") === null));
});

test("Google account discovery rejects a manager-only result", async () => {
  const fetchMock = (async (request: string | URL | Request) => {
    const url = typeof request === "string" ? request : request instanceof URL ? request.toString() : request.url;
    return url.endsWith("customers:listAccessibleCustomers")
      ? json({ resourceNames: ["customers/1111111111"] })
      : json([{ results: [{ customer: { descriptiveName: "Manager", manager: true } }] }]);
  }) as typeof fetch;

  await assert.rejects(
    () => listOAuthAccounts("google_ads", "google-access-token", fetchMock),
    (error: unknown) => error instanceof ConnectorNotReadyError && /manager accounts/.test(error.message),
  );
});

test("Google account discovery never assumes a failed customer lookup is an advertiser", async () => {
  const fetchMock = (async (request: string | URL | Request) => {
    const url = typeof request === "string" ? request : request instanceof URL ? request.toString() : request.url;
    return url.endsWith("customers:listAccessibleCustomers")
      ? json({ resourceNames: ["customers/1111111111"] })
      : json({ error: { status: "PERMISSION_DENIED" } }, 403);
  }) as typeof fetch;

  await assert.rejects(
    () => listOAuthAccounts("google_ads", "google-access-token", fetchMock),
    (error: unknown) =>
      error instanceof ConnectorNotReadyError
      && /could not inspect/.test(error.message),
  );
});

test("Meta account discovery paginates without putting its bearer token in a URL", async () => {
  const requests: Array<{ url: string; authorization: string | null }> = [];
  const fetchMock = (async (request: string | URL | Request, init?: RequestInit) => {
    const url = typeof request === "string" ? request : request instanceof URL ? request.toString() : request.url;
    requests.push({ url, authorization: new Headers(init?.headers).get("authorization") });
    if (requests.length === 1) {
      return json({
        data: [{ id: "act_123", account_id: "123", name: "Fitura" }],
        paging: {
          next: `https://graph.facebook.com/${META_GRAPH_VERSION}/me/adaccounts?after=next&access_token=provider-echo`,
        },
      });
    }
    return json({
      data: [
        { id: "act_123", account_id: "123", name: "Fitura" },
        { id: "act_456", account_id: "456", name: "Second account" },
      ],
    });
  }) as typeof fetch;

  const accounts = await listOAuthAccounts("meta_ads", "meta-access-token", fetchMock);
  assert.deepEqual(accounts, [
    { externalAccountId: "123", displayName: "Fitura" },
    { externalAccountId: "456", displayName: "Second account" },
  ]);
  assert.equal(requests.length, 2);
  assert.ok(requests.every((request) => !request.url.includes("access_token")));
  assert.ok(requests.every((request) => new URL(request.url).searchParams.has("appsecret_proof")));
  assert.ok(requests.every((request) => request.authorization === "Bearer meta-access-token"));
});

test("Meta account discovery never forwards a bearer token to an untrusted next page", async () => {
  const requests: string[] = [];
  const fetchMock = (async (request: string | URL | Request) => {
    const url = typeof request === "string" ? request : request instanceof URL ? request.toString() : request.url;
    requests.push(url);
    return json({
      data: [{ id: "act_123", name: "Fitura" }],
      paging: { next: "https://attacker.example/steal" },
    });
  }) as typeof fetch;

  await assert.rejects(
    () => listOAuthAccounts("meta_ads", "meta-access-token", fetchMock),
    (error: unknown) => error instanceof ConnectorNotReadyError && /untrusted/.test(error.message),
  );
  assert.equal(requests.length, 1);
  const onlyRequest = new URL(requests[0]);
  assert.equal(onlyRequest.origin, "https://graph.facebook.com");
  assert.equal(onlyRequest.pathname, `/${META_GRAPH_VERSION}/me/adaccounts`);
  assert.equal(onlyRequest.searchParams.has("access_token"), false);
  assert.equal(onlyRequest.searchParams.has("appsecret_proof"), true);
});
