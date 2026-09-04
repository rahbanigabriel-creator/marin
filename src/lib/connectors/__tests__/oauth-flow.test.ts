import assert from "node:assert/strict";
import test from "node:test";

import {
  buildAuthorizeUrl,
  exchangeCodeForTokens,
  OAuthError,
} from "../oauth";
import { CONNECTORS } from "../registry";

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

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
