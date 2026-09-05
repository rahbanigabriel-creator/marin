import assert from "node:assert/strict";
import test from "node:test";

import {
  buildAuthorizeUrl,
  exchangeCodeForTokens,
  OAuthError,
  parseConnectorOAuthIntent,
  type ConnectorOAuthIntent,
} from "../oauth";
import { CONNECTORS } from "../registry";

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function metaAuthorize(intent?: ConnectorOAuthIntent): URL {
  return new URL(buildAuthorizeUrl({
    config: CONNECTORS.meta_ads,
    clientId: "meta-client-id",
    redirectUri: "https://www.marpin.ai/api/connect/meta_ads/callback",
    state: "csrf-state",
    intent,
  }));
}

test("default Meta OAuth stays read-only and the registry is never mutated by a step-up", () => {
  const before = [...CONNECTORS.meta_ads.scopes];
  const url = metaAuthorize();
  assert.deepEqual(before, ["ads_read", "business_management"]);
  assert.equal(url.searchParams.get("scope"), "ads_read business_management");
  assert.equal(url.searchParams.has("auth_type"), false);
  metaAuthorize("paid_write");
  assert.deepEqual(CONNECTORS.meta_ads.scopes, before);
  assert.equal(metaAuthorize().searchParams.get("scope"), "ads_read business_management");
});

test("explicit Meta paid_write intent requests only the fixed additional publishing scopes", () => {
  const intent = parseConnectorOAuthIntent("meta_ads", new URLSearchParams("intent=paid_write"));
  const url = metaAuthorize(intent);
  assert.equal(intent, "paid_write");
  assert.equal(url.searchParams.get("scope"), "ads_read business_management ads_management pages_show_list pages_read_engagement");
  assert.equal(url.searchParams.get("auth_type"), "rerequest");
  assert.equal(url.searchParams.get("client_id"), "meta-client-id");
  assert.equal(url.searchParams.get("redirect_uri"), "https://www.marpin.ai/api/connect/meta_ads/callback");
  assert.equal(url.searchParams.get("state"), "csrf-state");
  assert.equal(url.searchParams.get("response_type"), "code");
  assert.equal(url.searchParams.has("intent"), false);
  assert.equal(url.searchParams.has("code_challenge"), false);
});

test("OAuth intent rejects unknown values, duplicate values, non-Meta step-up and caller-supplied scopes", () => {
  for (const platform of ["meta_ads", "google_ads", "ga4"]) {
    assert.equal(parseConnectorOAuthIntent(platform, new URLSearchParams()), undefined);
  }
  for (const [platform, query] of [
    ["meta_ads", "intent="], ["meta_ads", "intent=read"], ["meta_ads", "intent=paid_write%20"],
    ["meta_ads", "intent=paid_write&intent=paid_write"], ["meta_ads", "intent=paid_write&intent=anything"],
    ["google_ads", "intent=paid_write"], ["ga4", "intent=paid_write"],
    ["meta_ads", "scope=ads_management"], ["meta_ads", "scopes=pages_manage_posts"],
    ["meta_ads", "intent=paid_write&scope=pages_manage_posts"],
  ]) {
    assert.throws(() => parseConnectorOAuthIntent(platform, new URLSearchParams(query)),
      (error: unknown) => error instanceof OAuthError && error.message === "OAuth exchange error: invalid_oauth_intent");
  }
});

test("authorize URL construction revalidates step-up even when a caller skips request parsing", () => {
  assert.throws(() => metaAuthorize("pages_manage_posts" as ConnectorOAuthIntent), OAuthError);
  assert.throws(() => buildAuthorizeUrl({
    config: CONNECTORS.google_ads,
    clientId: "google-client", redirectUri: "https://www.marpin.ai/api/connect/google_ads/callback",
    state: "csrf-state", intent: "paid_write",
  }), OAuthError);
});

test("Google authorization carries exact redirect, state, offline access, and PKCE", () => {
  const url = new URL(buildAuthorizeUrl({
    config: CONNECTORS.google_ads,
    clientId: "google-client-id",
    redirectUri: "https://www.marpin.ai/api/connect/google_ads/callback",
    state: "csrf-state",
    codeChallenge: "pkce-challenge",
  }));

  assert.equal(url.origin, "https://accounts.google.com");
  assert.equal(url.searchParams.get("client_id"), "google-client-id");
  assert.equal(url.searchParams.get("redirect_uri"), "https://www.marpin.ai/api/connect/google_ads/callback");
  assert.equal(url.searchParams.get("scope"), "https://www.googleapis.com/auth/adwords");
  assert.equal(url.searchParams.get("state"), "csrf-state");
  assert.equal(url.searchParams.get("access_type"), "offline");
  assert.equal(url.searchParams.get("prompt"), "consent");
  assert.equal(url.searchParams.get("code_challenge"), "pkce-challenge");
  assert.equal(url.searchParams.get("code_challenge_method"), "S256");
});

test("Meta authorization code is upgraded to a long-lived token before persistence", async () => {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const fetchMock = (async (request: string | URL | Request, init?: RequestInit) => {
    const url = typeof request === "string" ? request : request instanceof URL ? request.toString() : request.url;
    calls.push({ url, init });
    if (calls.length === 1) {
      const form = new URLSearchParams(String(init?.body));
      assert.equal(init?.method, "POST");
      assert.equal(form.get("grant_type"), "authorization_code");
      assert.equal(form.get("code"), "provider-code");
      assert.equal(form.get("redirect_uri"), "https://www.marpin.ai/api/connect/meta_ads/callback");
      return json({ access_token: "short-token", expires_in: 3600, token_type: "bearer" });
    }
    const exchange = new URL(url);
    assert.equal(init?.method, "GET");
    assert.equal(exchange.searchParams.get("grant_type"), "fb_exchange_token");
    assert.equal(exchange.searchParams.get("client_id"), "meta-client-id");
    assert.equal(exchange.searchParams.get("client_secret"), "meta-client-secret");
    assert.equal(exchange.searchParams.get("fb_exchange_token"), "short-token");
    return json({ access_token: "long-token", expires_in: 5_184_000, token_type: "bearer" });
  }) as typeof fetch;

  const before = Date.now();
  const tokens = await exchangeCodeForTokens({
    config: CONNECTORS.meta_ads,
    clientId: "meta-client-id",
    clientSecret: "meta-client-secret",
    redirectUri: "https://www.marpin.ai/api/connect/meta_ads/callback",
    code: "provider-code",
    fetchImpl: fetchMock,
  });

  assert.equal(calls.length, 2);
  assert.equal(tokens.accessToken, "long-token");
  assert.ok(tokens.expiresAt && tokens.expiresAt.getTime() >= before + 5_183_000_000);
  assert.equal(tokens.refreshToken, undefined);
});

test("Meta connection fails closed when the long-lived exchange fails", async () => {
  let call = 0;
  const fetchMock = (async () => {
    call += 1;
    return call === 1
      ? json({ access_token: "short-token", expires_in: 3600 })
      : json({ error: "invalid_grant", error_description: "sensitive provider detail" }, 400);
  }) as typeof fetch;

  await assert.rejects(
    () => exchangeCodeForTokens({
      config: CONNECTORS.meta_ads,
      clientId: "meta-client-id",
      clientSecret: "meta-client-secret",
      redirectUri: "https://www.marpin.ai/api/connect/meta_ads/callback",
      code: "provider-code",
      fetchImpl: fetchMock,
    }),
    (error: unknown) => error instanceof OAuthError && !error.message.includes("sensitive provider detail"),
  );
  assert.equal(call, 2);
});
