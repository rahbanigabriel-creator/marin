import assert from "node:assert/strict";
import test from "node:test";

import { coalesceConnectionToken } from "../clients";
import { addMetricRows } from "../paid-clients";
import { WorkspaceAuthorizationError } from "../../auth";
import { paidSyncAuthFailure } from "../paid-http";
import { PaidProviderError, providerHttpError } from "../paid-errors";
import { boundedPages, parseProviderNumber } from "../paid-parsing";

test("paid numeric parsing preserves explicit zero and rejects missing values", () => {
  assert.equal(parseProviderNumber(0), 0);
  assert.equal(parseProviderNumber("0"), 0);
  assert.equal(parseProviderNumber("12.5"), 12.5);
  assert.equal(parseProviderNumber(undefined), null);
  assert.equal(parseProviderNumber(null), null);
  assert.equal(parseProviderNumber(""), null);
  assert.equal(parseProviderNumber("not-a-number"), null);
});

test("canonical paid rows omit missing values but retain zero", () => {
  const rows = addMetricRows({
    platform: "google_ads",
    date: new Date("2026-07-01T00:00:00.000Z"),
    campaignExternalId: "campaign-1",
    campaignName: "Same name",
    spend: 0,
    revenue: null,
    conversions: 0,
    clicks: null,
    impressions: 0,
  });
  assert.deepEqual(rows.map((row) => [row.metric, row.value]), [
    ["spend", 0],
    ["conversions", 0],
    ["impressions", 0],
  ]);
});

test("bounded provider pagination returns every page and rejects loops", async () => {
  const visited: string[] = [];
  const rows = await boundedPages({
    platform: "meta_ads",
    first: "https://provider.test/page-1",
    fetchPage: async (url) => {
      visited.push(url);
      return url.endsWith("page-1")
        ? { items: [1, 2], next: "https://provider.test/page-2" }
        : { items: [3], next: null };
    },
  });
  assert.deepEqual(rows, [1, 2, 3]);
  assert.equal(visited.length, 2);

  await assert.rejects(
    () => boundedPages({
      platform: "meta_ads",
      first: "https://provider.test/loop",
      fetchPage: async (url) => ({ items: [], next: url }),
    }),
    (error: unknown) => error instanceof PaidProviderError && error.code === "pagination_incomplete",
  );
});

test("provider HTTP failures expose safe categories only", () => {
  assert.equal(providerHttpError("tiktok_ads", 401).code, "authentication");
  assert.equal(providerHttpError("tiktok_ads", 403).code, "permission");
  assert.equal(providerHttpError("tiktok_ads", 429).code, "rate_limit");
  const error = providerHttpError("tiktok_ads", 500);
  assert.equal(error.code, "provider");
  assert.doesNotMatch(error.message, /500|token|response body/i);
});

test("paid sync rejects a workspace member with HTTP 403", () => {
  assert.deepEqual(paidSyncAuthFailure(new WorkspaceAuthorizationError()), {
    status: 403,
    error: "forbidden",
  });
});

test("concurrent paid phases share one token acquisition", async () => {
  let calls = 0;
  let release: ((value: string) => void) | undefined;
  const load = () => {
    calls += 1;
    return new Promise<string>((resolve) => { release = resolve; });
  };
  const pending = [
    coalesceConnectionToken("google_ads:connection-1", load),
    coalesceConnectionToken("google_ads:connection-1", load),
    coalesceConnectionToken("google_ads:connection-1", load),
  ];
  assert.equal(calls, 1);
  release?.("access-token");
  assert.deepEqual(await Promise.all(pending), ["access-token", "access-token", "access-token"]);
  assert.equal(await coalesceConnectionToken("google_ads:connection-1", async () => {
    calls += 1;
    return "next-token";
  }), "next-token");
  assert.equal(calls, 2, "a later sync may acquire a fresh token");
});
