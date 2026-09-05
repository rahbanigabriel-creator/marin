import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import { NextRequest } from "next/server";

import { GET } from "./[platform]/route";

test("OAuth start rejects invalid intents and arbitrary scopes without starting a transaction", async () => {
  for (const [platform, query] of [
    ["meta_ads", "intent=anything"], ["meta_ads", "intent=paid_write&intent=paid_write"],
    ["meta_ads", "intent="], ["meta_ads", "scope=pages_manage_posts"],
    ["meta_ads", "intent=paid_write&scopes=anything"], ["google_ads", "intent=paid_write"],
  ]) {
    const response = await GET(new NextRequest(`https://www.marpin.ai/api/connect/${platform}?${query}`), {
      params: Promise.resolve({ platform }),
    });
    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), { error: "invalid_oauth_intent" });
    assert.equal(response.headers.get("Cache-Control"), "no-store");
    assert.equal(response.headers.get("Set-Cookie"), null);
    assert.equal(response.headers.get("Location"), null);
  }
});

test("Meta OAuth step-up still passes through workspace authorization and signed actor binding", () => {
  const source = readFileSync(path.join(process.cwd(), "src/app/api/connect/[platform]/route.ts"), "utf8");
  const parse = source.indexOf("intent = parseConnectorOAuthIntent(config.id, req.nextUrl.searchParams)");
  const authorize = source.indexOf('requireWorkspaceRole(["owner", "admin"])');
  const transaction = source.indexOf("const signedTx = signTransaction({");
  const build = source.indexOf("const authorizeUrl = buildAuthorizeUrl({");
  assert.ok(parse > 0 && parse < authorize && authorize < transaction && transaction < build);
  assert.match(source.slice(transaction, build), /workspaceId: workspace.id,\s+clerkUserId,/);
  assert.match(source.slice(build), /buildAuthorizeUrl\(\{\s+config,\s+intent,/);
});
